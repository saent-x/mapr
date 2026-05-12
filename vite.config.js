import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Replace the `__CACHE_VERSION__` placeholder in the built sw.js with a
// content-derived hash so each deploy busts users out of the previous SW
// cache. Without this, every deploy reuses the same cache name and users
// stay pinned to a stale index.html.
function swCacheVersionPlugin() {
  return {
    name: 'mapr-sw-cache-version',
    apply: 'build',
    closeBundle() {
      const swPath = path.resolve(__dirname, 'dist', 'sw.js')
      if (!fs.existsSync(swPath)) return
      const contents = fs.readFileSync(swPath, 'utf8')
      // Hash of all built JS/CSS chunk names so each release invalidates.
      const hashInput = fs.readdirSync(path.resolve(__dirname, 'dist', 'assets')).sort().join(',')
      const hash = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 12)
      const version = `mapr-${hash}`
      fs.writeFileSync(swPath, contents.replace(/__CACHE_VERSION__/g, version))
    },
  }
}

export default defineConfig({
  plugins: [react(), swCacheVersionPlugin()],
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
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('react-router')) return 'vendor-react';
            if (id.includes('maplibre-gl')) return 'vendor-map';
            if (id.includes('zustand')) return 'vendor-store';
          }
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
})
