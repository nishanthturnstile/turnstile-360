import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Compose owns development. Browser requests keep the public origin; only the
// development server uses private container DNS to reach the APIs.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://turnstile-api:3002',
      '/identity': 'http://dms-api:3001',
      '/.well-known/oauth-authorization-server/identity': 'http://dms-api:3001',
    },
  },
});
