import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'

export default defineConfig({
  plugins: [react(), cesium()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3030',
        changeOrigin: true
      }
    }
  },
})
