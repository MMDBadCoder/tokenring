import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.TOKENRING_DEV_API ?? 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4001,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/v1': { target: API_TARGET, changeOrigin: true },
      '/health': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
