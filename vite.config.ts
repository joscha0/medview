import react from "@vitejs/plugin-react";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "script-defer",
      manifest: false,
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{js,css,html,wasm,woff2,svg,webmanifest}"],
        globIgnores: [
          "**/example-series/**",
          "**/anatomy-layers/**",
          "**/anatomy-optimized.glb",
          "**/*.dcm",
          "**/*.glb",
        ],
        // The application bundle and some DICOM codecs exceed Workbox's 2 MiB
        // default. They are required for opening local studies while offline.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            urlPattern: ({ sameOrigin, url }) =>
              sameOrigin &&
              (url.pathname.includes("/anatomy-layers/") ||
                url.pathname.endsWith("/anatomy-optimized.glb")),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "medview-anatomy-layers",
              cacheableResponse: {
                statuses: [200],
              },
              expiration: {
                maxEntries: 64,
                purgeOnQuotaError: true,
              },
            },
          },
        ],
      },
    }),
  ],
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
