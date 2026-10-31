import swc from '@swc/core';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      name: 'nest-decorator-metadata',
      enforce: 'pre',
      async transform(code, id) {
        if (!/\.[cm]?ts$/.test(id) || id.includes('node_modules')) return;
        return swc.transform(code, {
          filename: id,
          sourceMaps: true,
          jsc: {
            target: 'es2023',
            parser: { syntax: 'typescript', decorators: true },
            transform: { legacyDecorator: true, decoratorMetadata: true },
          },
          module: { type: 'es6' },
        });
      },
    },
  ],
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
  },
});
