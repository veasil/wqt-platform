import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 4173,
    strictPort: true,
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/game-review.js': 'http://127.0.0.1:8080',
      '/cards-pdf-map.js': 'http://127.0.0.1:8080',
      '/cards-pdf': 'http://127.0.0.1:8080',
      '/brand': 'http://127.0.0.1:8080',
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
