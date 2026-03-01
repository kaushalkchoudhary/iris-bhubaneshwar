import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 8444,
    allowedHosts: ['demo2.magicboxhub.net'],
    proxy: {
      '/api/inference': {
        target: 'http://localhost:8001',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/inference/, ''),
      },
      '/api': {
        // Keep API proxy overridable per deployment while defaulting to local backend.
        target: process.env.VITE_BACKEND_URL || 'http://localhost:3002',
        changeOrigin: true,
        secure: false,
      },
      '/heatmaps': {
        target: process.env.VITE_BACKEND_URL || 'http://localhost:3002',
        changeOrigin: true,
        secure: false,
      },
      '/uploads': {
        target: process.env.VITE_BACKEND_URL || 'http://localhost:3002',
        changeOrigin: true,
        secure: false,
      },
      '/media': {
        target: 'http://localhost:8888',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/media/, ''),
      },
      '/wasender': {
        target: 'https://www.wasenderapi.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/wasender/, ''),
      },
    },
  },
  build: {
    sourcemap: false
  }
})
