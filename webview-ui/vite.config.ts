import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

/**
 * Single multi-entry build for all three webviews (diff, dashboard, search).
 * React/ReactDOM land once in a shared `vendor.js` chunk instead of being
 * bundled into every panel. The extension reads `manifest.json` to emit each
 * panel's entry script, its imported chunks (modulepreload) and its CSS.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../dist/webview",
    emptyOutDir: true,
    manifest: "manifest.json",
    // The polyfill only matters for browsers without modulepreload support;
    // VS Code's Chromium has it.
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        diff: resolve(__dirname, "index.html"),
        dashboard: resolve(__dirname, "dashboard.html"),
        search: resolve(__dirname, "search.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name].[ext]",
        manualChunks(id) {
          // React + the tiny modules every panel shares (vscode API handle,
          // keyboard helpers) go into one chunk loaded by all panels.
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return "vendor";
          }
          if (/[\\/]webview-ui[\\/]src[\\/](vscode|keyboard)\.ts$/.test(id)) {
            return "vendor";
          }
          return undefined;
        },
      },
    },
  },
});
