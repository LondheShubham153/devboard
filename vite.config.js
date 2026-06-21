import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Fundamentals build is UI-only — no backend, no proxy. Data comes from the
// in-memory mock store (src/mock/store.js).
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
  },
});
