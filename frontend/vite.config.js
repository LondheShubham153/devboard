import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev mode uses a local proxy; production (docker + nginx gateway) needs no proxy
// since nginx rewrites /api requests to the backend.
//
//   Dev (npm run dev)    → vite :5173 with proxy → localhost:8080 backend
//   Docker (npm run preview) → served via nginx gateway → backend by service name
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
  },
});
