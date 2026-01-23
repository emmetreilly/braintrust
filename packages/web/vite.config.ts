import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        // Use production worker for now (local wrangler requires additional setup)
        // Change back to 'http://localhost:8787' when running worker locally
        target: 'https://brain-trust-worker.e-caa.workers.dev',
        changeOrigin: true,
        secure: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
