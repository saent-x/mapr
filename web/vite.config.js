import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// React + Vite. Maps use MapLibre GL (via the vendored mapcn component);
// Tailwind v4 supplies utilities for the mapcn chrome only (no preflight).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 5173 },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Split the heavy map stack into its own cacheable vendor chunk so the
        // landing route (cold-open + composer) no longer carries maplibre. The
        // map component is React.lazy()'d, so this chunk only downloads once the
        // map mounts. React/router/convex go in a stable vendor chunk too — this
        // also anchors shared interop helpers there (not in the maplibre chunk),
        // so the eager index chunk keeps no static edge to maplibre.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("maplibre-gl") || id.includes("topojson")) return "maplibre";
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/react-router") ||
            id.includes("/scheduler/") ||
            id.includes("/convex/") ||
            id.includes("/@convex-dev/")
          ) {
            return "vendor-react";
          }
          return undefined;
        },
      },
    },
  },
});
