import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Lean React + Vite. No tile CDN, no proxy — the SVG map needs no external
// network at runtime (world-atlas TopoJSON is bundled under src/data).
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173 },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 700 },
});
