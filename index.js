#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { Worker } = require("worker_threads");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

class ImageProcessor {
  constructor(workerCount = 4) {
    this.workerCount = workerCount;
    this.workers = [];
    this.activeJobs = 0;
    this.completedJobs = 0;
    this.totalJobs = 0;
    this.startTime = null;
    this.processedImages = [];
    this.pendingQueue = [];
    this.isProcessing = false;
  }

  async initialize() {
    console.log(`Initializing ${this.workerCount} worker threads...`);

    for (let i = 0; i < this.workerCount; i++) {
      const worker = new Worker(path.join(__dirname, "worker.js"));
      this.workers.push(worker);
    }

    console.log(`Worker threads initialized successfully`);
  }

  async processImageQueue(imageFiles, outputDir) {
    this.totalJobs = imageFiles.length;
    this.startTime = Date.now();
    this.isProcessing = true;

    console.log(
      `Processing ${this.totalJobs} images with ${this.workerCount} workers...`
    );

    // Queue all images for processing
    this.pendingQueue = [...imageFiles];

    // Start processing with all workers
    const workerPromises = this.workers.map((worker, index) =>
      this.processWorkerQueue(worker, index, outputDir)
    );

    // Wait for all workers to complete
    await Promise.all(workerPromises);

    this.isProcessing = false;
    return this.processedImages;
  }

  async processWorkerQueue(worker, workerIndex, outputDir) {
    while (this.pendingQueue.length > 0) {
      const imageFile = this.pendingQueue.shift();
      if (!imageFile) break;

      try {
        await this.processImageWithWorker(
          worker,
          workerIndex,
          imageFile,
          outputDir
        );
      } catch (error) {
        console.error(`Error processing ${imageFile}:`, error.message);
      }
    }
  }

  async processImageWithWorker(worker, workerIndex, imageFile, outputDir) {
    return new Promise((resolve, reject) => {
      this.activeJobs++;

      const imageData = {
        inputPath: imageFile,
        outputPath: path.join(outputDir, path.basename(imageFile)),
        workerIndex,
      };

      const timeout = setTimeout(() => {
        reject(
          new Error(`Worker ${workerIndex} timeout processing ${imageFile}`)
        );
      }, 30000);

      const messageHandler = (result) => {
        clearTimeout(timeout);
        worker.off("message", messageHandler);
        worker.off("error", errorHandler);

        this.activeJobs--;
        this.completedJobs++;

        if (result.success) {
          this.processedImages.push(result.outputPath);
          this.logProgress();
          resolve(result);
        } else {
          reject(new Error(result.error));
        }
      };

      const errorHandler = (error) => {
        clearTimeout(timeout);
        worker.off("message", messageHandler);
        worker.off("error", errorHandler);

        this.activeJobs--;
        reject(error);
      };

      worker.on("message", messageHandler);
      worker.on("error", errorHandler);
      worker.postMessage(imageData);
    });
  }

  logProgress() {
    const elapsed = Date.now() - this.startTime;
    const rate = this.completedJobs / (elapsed / 1000);
    const remaining = this.totalJobs - this.completedJobs;
    const eta = remaining / rate;

    console.log(
      `Progress: ${this.completedJobs}/${this.totalJobs} (${(
        (this.completedJobs / this.totalJobs) *
        100
      ).toFixed(1)}%) | ` +
        `Rate: ${rate.toFixed(1)} img/s | ` +
        `Active: ${this.activeJobs} | ` +
        `ETA: ${eta.toFixed(0)}s`
    );
  }

  async cleanup() {
    console.log("Cleaning up worker threads...");
    await Promise.all(
      this.workers.map(
        (worker) =>
          new Promise((resolve) => {
            worker.terminate().then(() => resolve());
          })
      )
    );
    console.log("Cleanup completed");
  }
}

function getImageFiles(sourceDir) {
  const supportedExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".bmp",
    ".tiff",
    ".webp",
  ];

  console.log(`Scanning directory: ${sourceDir}`);

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source directory does not exist: ${sourceDir}`);
  }

  const files = fs.readdirSync(sourceDir);
  const imageFiles = files
    .filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return supportedExtensions.includes(ext);
    })
    .map((file) => path.join(sourceDir, file));

  console.log(`Found ${imageFiles.length} supported image files`);
  return imageFiles;
}

async function ensureOutputDir(outputDir) {
  if (!fs.existsSync(outputDir)) {
    console.log(`Creating output directory: ${outputDir}`);
    fs.mkdirSync(outputDir, { recursive: true });
  }
}

async function run() {
  const argv = yargs(hideBin(process.argv))
    .option("source", {
      alias: "s",
      type: "string",
      demandOption: true,
      description: "Source directory containing images",
    })
    .option("output", {
      alias: "o",
      type: "string",
      demandOption: true,
      description: "Output directory for processed images",
    })
    .option("workers", {
      alias: "w",
      type: "number",
      default: 4,
      description: "Number of worker threads",
    })
    .help().argv;

  const sourceDir = path.resolve(argv.source);
  const outputDir = path.resolve(argv.output);
  const workerCount = argv.workers;

  console.log("Image Processing Pipeline Starting");
  console.log(`Source: ${sourceDir}`);
  console.log(`Output: ${outputDir}`);
  console.log(`Workers: ${workerCount}`);

  const processor = new ImageProcessor(workerCount);

  try {
    await processor.initialize();
    await ensureOutputDir(outputDir);

    const imageFiles = getImageFiles(sourceDir);
    if (imageFiles.length === 0) {
      console.log("No supported image files found");
      return;
    }

    const startTime = Date.now();
    const processedImages = await processor.processImageQueue(
      imageFiles,
      outputDir
    );
    const endTime = Date.now();

    const duration = (endTime - startTime) / 1000;
    const rate = processedImages.length / duration;

    console.log("\nProcessing completed!");
    console.log(
      `Processed: ${processedImages.length}/${imageFiles.length} images`
    );
    console.log(`Duration: ${duration.toFixed(2)}s`);
    console.log(`Rate: ${rate.toFixed(2)} images/second`);
  } catch (error) {
    console.error("Pipeline error:", error.message);
    process.exit(1);
  } finally {
    await processor.cleanup();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

module.exports = { ImageProcessor };
