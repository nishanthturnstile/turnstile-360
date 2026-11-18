import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { openApi } from '../packages/control-plane-contracts/dist/index.js';

const path = new URL('../docs/api/control-plane.openapi.json', import.meta.url);
const formatted = spawnSync(
  'pnpm',
  ['exec', 'biome', 'format', '--stdin-file-path=docs/api/control-plane.openapi.json'],
  { input: JSON.stringify(openApi), encoding: 'utf8' },
);
assert.equal(formatted.status, 0, 'OpenAPI formatting failed');
const content = formatted.stdout;
if (process.argv.includes('--check'))
  assert.equal(readFileSync(path, 'utf8'), content, 'Regenerate control-plane OpenAPI');
else writeFileSync(path, content);
