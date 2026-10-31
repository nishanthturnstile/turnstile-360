import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3002',
      '/identity': 'http://127.0.0.1:3001',
      '/.well-known/oauth-authorization-server/identity': 'http://127.0.0.1:3001',
    },
  },
});
