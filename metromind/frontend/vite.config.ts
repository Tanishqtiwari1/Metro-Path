/// <reference types="vitest/config" />
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Dev-only proxy target; production builds call VITE_API_BASE_URL (or the same origin).
  const proxyTarget = env.VITE_DEV_API_PROXY || 'http://127.0.0.1:8000'
  return {
    base: env.VITE_BASE || '/',
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
    server: {
      proxy: { '/api': { target: proxyTarget, changeOrigin: true } },
      // Some sandboxed/networked filesystems block native file watching; opt into polling there.
      watch: env.VITE_WATCH_POLLING === 'true' ? { usePolling: true, interval: 300 } : undefined,
    },
    build: {
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'charts'
            if (id.includes('node_modules/leaflet') || id.includes('node_modules/react-leaflet')) return 'map'
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  }
})
