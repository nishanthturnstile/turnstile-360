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
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
  },
});
