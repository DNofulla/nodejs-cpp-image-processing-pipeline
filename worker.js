const { parentPort, workerData } = require("worker_threads");
const fs = require("fs").promises;
const path = require("path");

let imageProcessor;
try {
  imageProcessor = require("./build/Release/image_processor");
} catch (error) {
  console.warn("C++ addon not available, falling back to Sharp");
  const sharp = require("sharp");

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
      const inputBuffer = await fs.readFile(imageData.inputPath);

      let processedBuffer;

      if (imageProcessor.processImage.toString().includes("Sharp")) {
        processedBuffer = await imageProcessor.processImage(
          inputBuffer,
          this.maxWidth,
          this.maxHeight
        );
      } else {
        const sharp = require("sharp");

        const metadata = await sharp(inputBuffer).metadata();
        const rawInputData = await sharp(inputBuffer).raw().toBuffer();

        const headerBuffer = Buffer.alloc(12);
        headerBuffer.writeInt32BE(metadata.width, 0);
        headerBuffer.writeInt32BE(metadata.height, 4);
        headerBuffer.writeInt32BE(metadata.channels, 8);

        const inputForCpp = Buffer.concat([headerBuffer, rawInputData]);

        const rawBuffer = await imageProcessor.processImage(
          inputForCpp,
          this.maxWidth,
          this.maxHeight
        );

        if (rawBuffer.length < 12) {
          throw new Error("Invalid processed data from C++ addon");
        }

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

        const imageData = rawBuffer.slice(12);

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

async function main() {
  const worker = new ImageWorker(
    workerData || { maxWidth: 800, maxHeight: 600 }
  );

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

  parentPort.on("close", () => {
    console.log(
      `Worker shutting down after processing ${worker.processedCount} images`
    );
    process.exit(0);
  });
}

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

main().catch((error) => {
  console.error("Worker initialization failed:", error);
  process.exit(1);
});
