import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      // Proxy API calls to backend during dev if needed
      // '/api': 'http://localhost:3000',
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
});

