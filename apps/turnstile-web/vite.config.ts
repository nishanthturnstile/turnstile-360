import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Compose owns development. Browser requests keep the public origin; only the
// development server uses private container DNS to reach the APIs.
export default defineConfig({
  build: {
    manifest: true,
    rollupOptions: {
      input: [
        'index.html',
        ...(existsSync('module-build-inputs.json')
          ? JSON.parse(readFileSync('module-build-inputs.json', 'utf8'))
          : []),
      ],
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'selected-module-ownership',
      generateBundle(_options, bundle) {
        const chunks = Object.values(bundle)
          .filter((item) => item.type === 'chunk')
          .map((chunk) => ({
            file: chunk.fileName,
            modules: Object.keys(chunk.modules)
              .map((id) =>
                id
                  .replaceAll('\\', '/')
                  .replace(/^.*?\/workspace\//, '')
                  .replace(`${process.cwd().replaceAll('\\', '/')}/`, 'apps/turnstile-web/'),
              )
              .sort(),
          }));
        this.emitFile({
          type: 'asset',
          fileName: '.vite/module-ownership.json',
          source: JSON.stringify(chunks),
        });
      },
    },
  ],
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
