import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync } from 'node:fs';

assert.ok(
  existsSync('/.thaarei-module-build') && process.cwd() === '/workspace',
  'Isolated build stage required',
);
mkdirSync('/runtime');
// pnpm deploy may include README/lock/workspace files despite package files. Only these owned roots ship.
for (const path of ['dist', 'database', 'node_modules', 'package.json'])
  cpSync(`/runtime-source/${path}`, `/runtime/${path}`, {
    recursive: true,
    verbatimSymlinks: true,
  });
cpSync('apps/turnstile-api/module-selection.json', '/runtime/module-selection.json');
