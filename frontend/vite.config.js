import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, /api and /uploads are proxied to the Express backend (same-origin => cookies just work).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000', '/uploads': 'http://localhost:4000' } },
});
