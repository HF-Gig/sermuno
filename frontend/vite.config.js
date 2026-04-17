import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

process.env.NODE_ENV = 'production';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  esbuild: {
    jsx: 'automatic',
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    cssCodeSplit: true,
    sourcemap: false,
    minify: 'esbuild',
  },
  server: {
    host: true,
    allowedHosts: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      'Cross-Origin-Embedder-Policy': 'unsafe-none',
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
    port: process.env.PORT ? parseInt(process.env.PORT) : 4173,
  },
})
