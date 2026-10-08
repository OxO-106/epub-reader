import { fileURLToPath } from "node:url";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL("./src/web", import.meta.url));
const outDir = fileURLToPath(new URL("./dist/web", import.meta.url));

export default defineConfig({
  root,
  plugins: [preact()],
  build: { outDir, emptyOutDir: true },
  server: {
    port: 5173,
    // In development the API runs separately (npm run dev starts both).
    proxy: { "/api": "http://127.0.0.1:5174" },
  },
});
