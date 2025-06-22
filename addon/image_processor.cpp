#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <napi.h>
#include <stdexcept>
#include <vector>

namespace ImageProcessor {

struct ImageData {
  std::vector<uint8_t> data;
  int width;
  int height;
  int channels;
};

// Simple bilinear interpolation for image resizing
uint8_t bilinearInterpolate(const std::vector<uint8_t> &data, int width,
                            int height, int channels, float x, float y,
                            int channel) {
  int x1 = static_cast<int>(std::floor(x));
  int y1 = static_cast<int>(std::floor(y));
  int x2 = std::min(x1 + 1, width - 1);
  int y2 = std::min(y1 + 1, height - 1);

  float dx = x - x1;
  float dy = y - y1;

  auto getPixel = [&](int px, int py, int ch) -> uint8_t {
    if (px < 0 || px >= width || py < 0 || py >= height)
      return 0;
    return data[(py * width + px) * channels + ch];
  };

  float top =
      getPixel(x1, y1, channel) * (1 - dx) + getPixel(x2, y1, channel) * dx;
  float bottom =
      getPixel(x1, y2, channel) * (1 - dx) + getPixel(x2, y2, channel) * dx;

  return static_cast<uint8_t>(top * (1 - dy) + bottom * dy);
}

// Resize image using bilinear interpolation
ImageData resizeImage(const ImageData &input, int newWidth, int newHeight) {
  ImageData output;
  output.width = newWidth;
  output.height = newHeight;
  output.channels = input.channels;
  output.data.resize(newWidth * newHeight * input.channels);

  float xRatio = static_cast<float>(input.width) / newWidth;
  float yRatio = static_cast<float>(input.height) / newHeight;

  for (int y = 0; y < newHeight; y++) {
    for (int x = 0; x < newWidth; x++) {
      float srcX = x * xRatio;
      float srcY = y * yRatio;

      for (int c = 0; c < input.channels; c++) {
        uint8_t value =
            bilinearInterpolate(input.data, input.width, input.height,
                                input.channels, srcX, srcY, c);
        output.data[(y * newWidth + x) * input.channels + c] = value;
      }
    }
  }

  return output;
}

// Convert image to grayscale
ImageData convertToGrayscale(const ImageData &input) {
  ImageData output;
  output.width = input.width;
  output.height = input.height;
  output.channels = 1; // Grayscale has 1 channel
  output.data.resize(input.width * input.height);

  for (int i = 0; i < input.width * input.height; i++) {
    if (input.channels >= 3) {
      // RGB to grayscale using standard luminance formula
      uint8_t r = input.data[i * input.channels];
      uint8_t g = input.data[i * input.channels + 1];
      uint8_t b = input.data[i * input.channels + 2];

      // Weighted average: 0.299*R + 0.587*G + 0.114*B
      uint8_t gray = static_cast<uint8_t>(0.299f * r + 0.587f * g + 0.114f * b);
      output.data[i] = gray;
    } else {
      // Already grayscale or single channel
      output.data[i] = input.data[i * input.channels];
    }
  }

  return output;
}

// Simple JPEG-like encoding (simplified for demonstration)
std::vector<uint8_t> encodeAsJPEG(const ImageData &image) {
  // This is a simplified encoding - in reality, you'd use a proper JPEG library
  // For this demo, we'll create a simple format with a header and raw data

  std::vector<uint8_t> encoded;

  // Simple header: width (4 bytes), height (4 bytes), channels (4 bytes)
  auto writeInt = [&encoded](int value) {
    encoded.push_back((value >> 24) & 0xFF);
    encoded.push_back((value >> 16) & 0xFF);
    encoded.push_back((value >> 8) & 0xFF);
    encoded.push_back(value & 0xFF);
  };

  writeInt(image.width);
  writeInt(image.height);
  writeInt(image.channels);

  // Add the image data
  for (const auto &byte : image.data) {
    encoded.push_back(byte);
  }

  return encoded;
}

// Parse simple image format (for demonstration - normally you'd use a proper
// image library)
ImageData parseSimpleImage(const uint8_t *data, size_t size) {
  ImageData image;

  if (size < 12) {
    throw std::runtime_error("Invalid image data: too small");
  }

  // Read header
  auto readInt = [](const uint8_t *data, size_t offset) -> int {
    return (data[offset] << 24) | (data[offset + 1] << 16) |
           (data[offset + 2] << 8) | data[offset + 3];
  };

  image.width = readInt(data, 0);
  image.height = readInt(data, 4);
  image.channels = readInt(data, 8);

  // Basic validation
  if (image.width <= 0 || image.height <= 0 || image.channels <= 0 ||
      image.channels > 4) {
    // Try to interpret as raw image data with assumed dimensions
    // This is a fallback for when we receive actual image files
    image.width = 100; // Default assumption
    image.height = static_cast<int>(size / (image.width * 3)); // Assume RGB
    image.channels = 3;

    if (image.height <= 0) {
      image.height = 100;
      image.width = static_cast<int>(size / (image.height * 3));
    }
  }

  size_t expectedSize = 12 + image.width * image.height * image.channels;
  if (size >= expectedSize) {
    // Read image data from after header
    image.data.assign(data + 12, data + expectedSize);
  } else {
    // Use all available data as image data (fallback)
    image.data.assign(data, data + size);
  }

  return image;
}

// Main processing function
Napi::Value ProcessImage(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 3) {
    Napi::TypeError::New(env,
                         "Expected 3 arguments: buffer, maxWidth, maxHeight")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  if (!info[0].IsBuffer()) {
    Napi::TypeError::New(env, "First argument must be a Buffer")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  if (!info[1].IsNumber() || !info[2].IsNumber()) {
    Napi::TypeError::New(env, "maxWidth and maxHeight must be numbers")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  try {
    // Get input data
    Napi::Buffer<uint8_t> inputBuffer = info[0].As<Napi::Buffer<uint8_t>>();
    int maxWidth = info[1].As<Napi::Number>().Int32Value();
    int maxHeight = info[2].As<Napi::Number>().Int32Value();

    // Parse the input image
    ImageData inputImage =
        parseSimpleImage(inputBuffer.Data(), inputBuffer.Length());

    // Calculate new dimensions maintaining aspect ratio
    float aspectRatio =
        static_cast<float>(inputImage.width) / inputImage.height;
    int newWidth = inputImage.width;
    int newHeight = inputImage.height;

    if (inputImage.width > maxWidth) {
      newWidth = maxWidth;
      newHeight = static_cast<int>(maxWidth / aspectRatio);
    }

    if (newHeight > maxHeight) {
      newHeight = maxHeight;
      newWidth = static_cast<int>(maxHeight * aspectRatio);
    }

    // Resize if necessary
    ImageData resizedImage = inputImage;
    if (newWidth != inputImage.width || newHeight != inputImage.height) {
      resizedImage = resizeImage(inputImage, newWidth, newHeight);
    }

    // Convert to grayscale
    ImageData grayscaleImage = convertToGrayscale(resizedImage);

    // Encode the result
    std::vector<uint8_t> encoded = encodeAsJPEG(grayscaleImage);

    // Return as Node.js Buffer
    return Napi::Buffer<uint8_t>::Copy(env, encoded.data(), encoded.size());

  } catch (const std::exception &e) {
    Napi::Error::New(env, std::string("Image processing failed: ") + e.what())
        .ThrowAsJavaScriptException();
    return env.Null();
  }
}

} // namespace ImageProcessor

// Initialize the addon with proper signature for NAPI_MODULE
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "processImage"),
              Napi::Function::New(env, ImageProcessor::ProcessImage));
  return exports;
}

// C-style wrapper function for NAPI_MODULE
napi_value init_module(napi_env env, napi_value exports) {
  return Init(Napi::Env(env), Napi::Object(env, exports));
}

// Use NAPI_MODULE with C-style function signature
NAPI_MODULE(NODE_GYP_MODULE_NAME, init_module);