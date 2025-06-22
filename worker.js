const { parentPort, workerData } = require("worker_threads");
const fs = require("fs").promises;
const path = require("path");

// Import the C++ addon
let imageProcessor;
try {
  imageProcessor = require("./build/Release/image_processor");
} catch (error) {
  // Fallback to Sharp if C++ addon is not available
  console.warn("C++ addon not available, falling back to Sharp");
  const sharp = require("sharp");

  // Create a Sharp-based fallback that mimics our C++ addon interface
  imageProcessor = {
    processImage: async (buffer, maxWidth, maxHeight) => {
      try {
        const processed = await sharp(buffer)
          .resize(maxWidth, maxHeight, {
            fit: "inside",
            withoutEnlargement: true,
          })
          .grayscale()
          .jpeg({ quality: 85 })
          .toBuffer();

        return processed;
      } catch (error) {
        throw new Error(`Sharp processing failed: ${error.message}`);
      }
    },
  };
}

class ImageWorker {
  constructor(options) {
    this.maxWidth = options.maxWidth || 800;
    this.maxHeight = options.maxHeight || 600;
    this.processedCount = 0;
  }

  async processImage(imageData) {
    try {
      // Read the image file
      const inputBuffer = await fs.readFile(imageData.inputPath);

      let processedBuffer;

      if (imageProcessor.processImage.toString().includes("Sharp")) {
        // Using Sharp fallback
        processedBuffer = await imageProcessor.processImage(
          inputBuffer,
          this.maxWidth,
          this.maxHeight
        );
      } else {
        // Using C++ addon - decode with Sharp first, then use C++ for processing
        const sharp = require("sharp");

        // Decode the input image to raw RGB data using Sharp
        const metadata = await sharp(inputBuffer).metadata();
        const rawInputData = await sharp(inputBuffer).raw().toBuffer();

        // Create a simple header + raw data format for C++ addon
        const headerBuffer = Buffer.alloc(12);
        headerBuffer.writeInt32BE(metadata.width, 0);
        headerBuffer.writeInt32BE(metadata.height, 4);
        headerBuffer.writeInt32BE(metadata.channels, 8);

        const inputForCpp = Buffer.concat([headerBuffer, rawInputData]);

        // Process with C++ addon
        const rawBuffer = await imageProcessor.processImage(
          inputForCpp,
          this.maxWidth,
          this.maxHeight
        );

        // Parse the custom format from C++ addon
        if (rawBuffer.length < 12) {
          throw new Error("Invalid processed data from C++ addon");
        }

        // Read header: width (4 bytes), height (4 bytes), channels (4 bytes)
        const width =
          (rawBuffer[0] << 24) |
          (rawBuffer[1] << 16) |
          (rawBuffer[2] << 8) |
          rawBuffer[3];
        const height =
          (rawBuffer[4] << 24) |
          (rawBuffer[5] << 16) |
          (rawBuffer[6] << 8) |
          rawBuffer[7];
        const channels =
          (rawBuffer[8] << 24) |
          (rawBuffer[9] << 16) |
          (rawBuffer[10] << 8) |
          rawBuffer[11];

        // Extract raw image data
        const imageData = rawBuffer.slice(12);

        // Convert to proper JPEG using Sharp
        processedBuffer = await sharp(imageData, {
          raw: {
            width: width,
            height: height,
            channels: channels,
          },
        })
          .jpeg({ quality: 85 })
          .toBuffer();
      }

      // Write the processed image
      await fs.writeFile(imageData.outputPath, processedBuffer);

      this.processedCount++;

      return {
        success: true,
        inputPath: imageData.inputPath,
        outputPath: imageData.outputPath,
        filename: imageData.filename,
        inputSize: inputBuffer.length,
        outputSize: processedBuffer.length,
        compressionRatio: (
          ((inputBuffer.length - processedBuffer.length) / inputBuffer.length) *
          100
        ).toFixed(1),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        inputPath: imageData.inputPath,
        filename: imageData.filename,
      };
    }
  }
}

// Worker main logic
async function main() {
  const worker = new ImageWorker(
    workerData || { maxWidth: 800, maxHeight: 600 }
  );

  // Listen for messages from the main thread
  parentPort.on("message", async (imageData) => {
    try {
      const result = await worker.processImage(imageData);
      parentPort.postMessage(result);
    } catch (error) {
      parentPort.postMessage({
        success: false,
        error: error.message,
        inputPath: imageData.inputPath,
        filename: imageData.filename,
      });
    }
  });

  // Handle worker shutdown
  parentPort.on("close", () => {
    console.log(
      `Worker shutting down after processing ${worker.processedCount} images`
    );
    process.exit(0);
  });
}

// Error handling
process.on("uncaughtException", (error) => {
  console.error("Worker uncaught exception:", error);
  parentPort.postMessage({
    success: false,
    error: `Worker crashed: ${error.message}`,
  });
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Worker unhandled rejection at:", promise, "reason:", reason);
  parentPort.postMessage({
    success: false,
    error: `Worker unhandled rejection: ${reason}`,
  });
});

// Start the worker
main().catch((error) => {
  console.error("Worker initialization failed:", error);
  process.exit(1);
});
