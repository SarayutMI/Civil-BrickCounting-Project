import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// CIVIL front-end — Vite + plain JS/React.
// Dev server proxies /api and /snapshots to the Node/Express backend (server.js) on :3000,
// so `npm run dev` here can be used against the real backend during development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/snapshots': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
