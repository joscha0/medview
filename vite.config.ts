import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    // Keep the loader as source so Vite can resolve its import.meta.url worker.
    exclude: ["@cornerstonejs/dicom-image-loader"],
    // Its Emscripten codec factories are CommonJS and still need interop.
    include: [
      "@cornerstonejs/metadata",
      "@cornerstonejs/dicom-image-loader > @cornerstonejs/codec-charls/decodewasmjs",
      "@cornerstonejs/dicom-image-loader > @cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs",
      "@cornerstonejs/dicom-image-loader > @cornerstonejs/codec-openjpeg/decodewasmjs",
      "@cornerstonejs/dicom-image-loader > @cornerstonejs/codec-openjph/wasmjs",
      "@cornerstonejs/dicom-image-loader > dicom-parser",
      "@cornerstonejs/dicom-image-loader > jpeg-lossless-decoder-js",
      "@cornerstonejs/dicom-image-loader > pako",
    ],
  },
  resolve: {
    dedupe: ["@cornerstonejs/core", "@cornerstonejs/metadata"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
