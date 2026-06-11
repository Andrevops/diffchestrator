import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../dist/webview-search",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "search.html"),
      output: {
        entryFileNames: "main.js",
        assetFileNames: "main.[ext]",
      },
    },
  },
});
