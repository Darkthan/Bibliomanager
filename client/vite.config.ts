import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      // Proxy backend routes to Node server during dev
      '/health': 'http://localhost:3000',
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
});
