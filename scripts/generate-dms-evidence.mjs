import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ledger } from './dms-evidence.mjs';

const report = 'docs/qualification/dms-i20-release.json',
  path = 'docs/qualification/dms-i20-ledger.json';
const value = ledger(existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : undefined);
const formatted = spawnSync('pnpm', ['exec', 'biome', 'format', `--stdin-file-path=${path}`], {
  input: JSON.stringify(value),
  encoding: 'utf8',
});
assert.equal(formatted.status, 0);
if (process.argv.includes('--check'))
  assert.equal(
    readFileSync(path, 'utf8'),
    formatted.stdout,
    'DMS requirement evidence ledger drift',
  );
else writeFileSync(path, formatted.stdout);
console.log(
  `DMS evidence ledger: ${value.requirements.length} FR/NFR IDs, references and separate acceptance states verified.`,
);
