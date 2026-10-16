import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const backend = 'http://localhost:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': backend,
      // Không đặt changeOrigin: Socket.IO so Origin với Host, cả hai phải là địa chỉ của Vite.
      '/socket.io': { target: backend, ws: true },
    },
  },
  build: { outDir: '../backend/app/static', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
