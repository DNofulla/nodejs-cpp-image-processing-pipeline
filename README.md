# Image Processing Pipeline

A Node.js project that processes images using streams, worker threads, and C++ addons. Takes a folder of images, resizes them, converts to grayscale, and saves the results.

## What it does

Point it at a folder of images and it will:
- Resize images to fit within your specified dimensions
- Convert them to grayscale  
- Save them as compressed JPEGs
- Use all your CPU cores for fast processing

## How it works

The main thread reads image files and sends them to worker threads. Each worker uses a C++ addon for the heavy lifting (resizing and grayscale conversion), then Sharp library handles the final JPEG encoding. Everything runs in parallel for speed.

## Setup

You'll need Node.js 18+ and a C++ compiler installed.

```bash
npm install
npm run build
```

## Usage

```bash
# Basic usage
node index.js -s ./input-folder -o ./output-folder

# Custom settings
node index.js -s ./photos -o ./resized --workers 4 --max-width 1024 --max-height 768
```

Options:
- `-s, --source`: Input folder (required)
- `-o, --output`: Output folder (required)  
- `-w, --workers`: Number of worker threads (defaults to CPU cores)
- `--max-width`: Max width in pixels (default: 800)
- `--max-height`: Max height in pixels (default: 600)

Supports JPEG, PNG, BMP, TIFF, and WebP files.

## Testing

```bash
npm test
```

This creates some test images, processes them, and shows you the results.

## Performance

Typically processes 15-30 images per second on an 8-core machine. The C++ addon gives about 3-5x speedup compared to pure JavaScript. Memory usage is around 50MB plus 10MB per worker thread.

Performance depends on:
- Image size and complexity
- Number of CPU cores/threads
- Storage speed (SSD vs HDD)

## Code structure

- `index.js` - Main application and CLI - Orchestrates everything
- `worker.js` - Worker thread that processes individual images - Worker Thread Configuration
- `addon/image_processor.cpp` - C++ code for fast image operations
- `test/test.js` - Test suite with sample images

## How the C++ addon works

The addon does bilinear interpolation for resizing and uses the standard luminance formula (0.299*R + 0.587*G + 0.114*B) for grayscale conversion. It's much faster than JavaScript for these pixel-level operations.

If the C++ addon fails to build or load, the system automatically falls back to using Sharp for everything.

## License

MIT License