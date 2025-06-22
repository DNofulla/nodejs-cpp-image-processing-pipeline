const fs = require("fs").promises;
const path = require("path");
const sharp = require("sharp");
const { ImageProcessor } = require("../index");

// Create a simple test image buffer (2x2 RGB image)
function createTestImageBuffer() {
  const width = 2;
  const height = 2;
  const channels = 3;

  // Create header
  const header = Buffer.alloc(12);
  header.writeInt32BE(width, 0);
  header.writeInt32BE(height, 4);
  header.writeInt32BE(channels, 8);

  // Create image data (2x2 RGB pixels)
  const imageData = Buffer.from([
    255,
    0,
    0, // Red pixel
    0,
    255,
    0, // Green pixel
    0,
    0,
    255, // Blue pixel
    255,
    255,
    0, // Yellow pixel
  ]);

  return Buffer.concat([header, imageData]);
}

// Create a more realistic test image (64x64 gradient)
function createGradientImageBuffer() {
  const width = 64;
  const height = 64;
  const channels = 3;

  // Create header
  const header = Buffer.alloc(12);
  header.writeInt32BE(width, 0);
  header.writeInt32BE(height, 4);
  header.writeInt32BE(channels, 8);

  // Create gradient image data
  const imageData = Buffer.alloc(width * height * channels);
  let offset = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = Math.floor((x / width) * 255);
      const g = Math.floor((y / height) * 255);
      const b = Math.floor(((x + y) / (width + height)) * 255);

      imageData[offset++] = r;
      imageData[offset++] = g;
      imageData[offset++] = b;
    }
  }

  return Buffer.concat([header, imageData]);
}

// Create real test images using Sharp
async function createSharpTestImages(testDir) {
  const images = [
    {
      name: "red-gradient.jpg",
      create: async () => {
        const width = 300,
          height = 200;
        const data = Buffer.alloc(width * height * 3);
        let offset = 0;

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const intensity = Math.floor((x / width) * 255);
            data[offset++] = intensity; // R
            data[offset++] = 0; // G
            data[offset++] = 0; // B
          }
        }

        return sharp(data, { raw: { width, height, channels: 3 } })
          .jpeg({ quality: 90 })
          .toBuffer();
      },
    },
    {
      name: "blue-pattern.jpg",
      create: async () => {
        const width = 400,
          height = 300;
        const data = Buffer.alloc(width * height * 3);
        let offset = 0;

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const checker = (Math.floor(x / 20) + Math.floor(y / 20)) % 2 === 0;
            const blue = checker ? 255 : 100;
            data[offset++] = 0; // R
            data[offset++] = 0; // G
            data[offset++] = blue; // B
          }
        }

        return sharp(data, { raw: { width, height, channels: 3 } })
          .jpeg({ quality: 90 })
          .toBuffer();
      },
    },
    {
      name: "large-image.jpg",
      create: async () => {
        const width = 800,
          height = 600;
        const data = Buffer.alloc(width * height * 3);
        let offset = 0;

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const r = Math.floor((x / width) * 255);
            const g = Math.floor((y / height) * 255);
            const b = Math.floor(((x + y) / (width + height)) * 255);

            data[offset++] = r;
            data[offset++] = g;
            data[offset++] = b;
          }
        }

        return sharp(data, { raw: { width, height, channels: 3 } })
          .jpeg({ quality: 85 })
          .toBuffer();
      },
    },
  ];

  console.log(`Creating ${images.length} test images...`);

  for (const image of images) {
    console.log(`   Creating ${image.name}...`);
    const buffer = await image.create();
    const filePath = path.join(testDir, image.name);
    await fs.writeFile(filePath, buffer);
    console.log(`   ${image.name}: ${buffer.length} bytes`);
  }
}

async function runTests() {
  console.log("Running Image Processing Pipeline Tests\n");

  try {
    // Create test directories
    const testInputDir = path.join(__dirname, "input");
    const testOutputDir = path.join(__dirname, "output");

    await fs.mkdir(testInputDir, { recursive: true });
    await fs.mkdir(testOutputDir, { recursive: true });

    console.log("Created test directories");

    // Create test images using Sharp
    await createSharpTestImages(testInputDir);

    // Test the processing pipeline
    console.log("\nStarting image processing pipeline...\n");

    const processor = new ImageProcessor(3);

    await processor.initialize();
    const imageFiles = require("fs")
      .readdirSync(testInputDir)
      .filter((file) => /\.(jpg|jpeg|png|bmp|tiff|webp)$/i.test(file))
      .map((file) => path.join(testInputDir, file));

    await processor.processImageQueue(imageFiles, testOutputDir);
    await processor.cleanup();

    // Verify output files
    const outputFiles = await fs.readdir(testOutputDir);
    console.log(`\nTest completed successfully!`);
    console.log(`Output files: ${outputFiles.join(", ")}`);

    // Display file sizes and show what the processing actually does
    console.log(`\nProcessing Results:`);
    console.log(`   What the pipeline does: RESIZE + GRAYSCALE + COMPRESS`);

    for (const file of outputFiles) {
      const inputPath = path.join(testInputDir, file);
      const outputPath = path.join(testOutputDir, file);

      const inputStats = await fs.stat(inputPath);
      const outputStats = await fs.stat(outputPath);

      console.log(`   - ${file}:`);
      console.log(`     Input:  ${inputStats.size} bytes (color)`);
      console.log(
        `     Output: ${outputStats.size} bytes (grayscale, resized)`
      );
      console.log(
        `     Savings: ${(
          ((inputStats.size - outputStats.size) / inputStats.size) *
          100
        ).toFixed(1)}%`
      );
    }

    console.log("\nAll tests passed!");
    return { testInputDir, testOutputDir };
  } catch (error) {
    console.error("Test failed:", error.message);
    process.exit(1);
  }
}

// Main test execution
async function main() {
  console.log("High-Performance Image Processing Pipeline - Test Suite\n");

  const { testInputDir, testOutputDir } = await runTests();

  console.log("\nTest completed successfully!");
  console.log("\nTest directories used:");
  console.log(`   Input:  ${testInputDir}`);
  console.log(`   Output: ${testOutputDir}`);
  console.log(
    "\nThe pipeline transforms color images into grayscale, resized versions."
  );
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  runTests,
  createTestImageBuffer,
  createGradientImageBuffer,
  createSharpTestImages,
};
