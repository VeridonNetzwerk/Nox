import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(__dirname, ".."),
  base: "./",
  plugins: [react()],
  css: {
    postcss: resolve(__dirname, "postcss.config.js"),
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: resolve(__dirname, "..", "dist"),
    emptyOutDir: true,
  },
});
