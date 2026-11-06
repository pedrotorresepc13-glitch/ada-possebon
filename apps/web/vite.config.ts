import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// A ADA é servida sob /ada/ (mesmo site do POSSEBON via proxy reverso).
export default defineConfig({
  base: '/ada/',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/ada/api': 'http://127.0.0.1:4800' }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900
  }
});
