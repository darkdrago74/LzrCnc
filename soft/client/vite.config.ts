/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
const API_TARGET = process.env.LZR_API_TARGET || 'http://localhost:3001'
const API_ROUTES = ['/api', '/cam', '/cnc', '/materials', '/status', '/connect', '/disconnect', '/command', '/jog', '/probe', '/job', '/ping']

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '2.0.0'),
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Keep the heavy 3D stack in its own cacheable chunk
        manualChunks: { three: ['three', '@react-three/fiber', '@react-three/drei'] },
      },
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    host: true,
    // The client calls relative URLs; in dev they are forwarded to the Fastify server.
    proxy: Object.fromEntries(API_ROUTES.map(r => [r, { target: API_TARGET, changeOrigin: true }])),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
  },
})
