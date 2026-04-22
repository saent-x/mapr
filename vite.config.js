import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3030',
        changeOrigin: true
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Three.js + react-globe.gl in a separate chunk — only loaded when globe mode is selected
          if (id.includes('node_modules/three/') || id.includes('node_modules/react-globe.gl/')) {
            return 'vendor-globe';
          }
          // MapLibre GL in a separate chunk — only loaded when flat map is active
          if (id.includes('node_modules/maplibre-gl/') || id.includes('node_modules/react-map-gl/')) {
            return 'vendor-map';
          }
          // Leaflet in a separate chunk
          if (id.includes('node_modules/leaflet/') || id.includes('node_modules/react-leaflet')) {
            return 'vendor-leaflet';
          }
        },
      },
    },
  },
})
