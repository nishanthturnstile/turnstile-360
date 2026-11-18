import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  EXTRACTION_FORMATS,
  EXTRACTION_LIMITS,
  OCR_RUNTIME,
  STRUCTURE_RUNTIME,
  WORK_LIMITS,
  WORK_PRIVATE_ROUTES,
  WORK_ROLE_SCOPE,
  WORK_TASK_ROLE,
  workJsonSchemas,
} from '../packages/dms-contracts/dist/private.js';
import { DMS_PUBLIC_ROUTES, dmsPublicJsonSchemas } from '../packages/dms-contracts/dist/public.js';

const artifact = {
  version: 1,
  audience: '{canonical-authority-issuer}/services/work',
  roles: WORK_ROLE_SCOPE,
  tasks: WORK_TASK_ROLE,
  limits: WORK_LIMITS,
  extraction: {
    limits: EXTRACTION_LIMITS,
    formats: EXTRACTION_FORMATS,
    ocr: OCR_RUNTIME,
    structure: STRUCTURE_RUNTIME,
  },
  routes: WORK_PRIVATE_ROUTES,
  schemas: workJsonSchemas,
};
assert.ok(!('Envelope' in dmsPublicJsonSchemas));
assert.ok(DMS_PUBLIC_ROUTES.every((r) => !r.path.includes('/internal/')));
for (const path of [
  'docs/api/dms-work.contract.json',
  'apps/dms-processing/src/turnstile_processing/work-contract.json',
]) {
  const formatted = spawnSync('pnpm', ['exec', 'biome', 'format', `--stdin-file-path=${path}`], {
    input: JSON.stringify(artifact),
    encoding: 'utf8',
  });
  assert.equal(formatted.status, 0);
  if (process.argv.includes('--check'))
    assert.equal(readFileSync(path, 'utf8'), formatted.stdout, 'Regenerate private work contract');
  else writeFileSync(path, formatted.stdout);
}
console.log('Versioned private work contracts generated separately from consumer OpenAPI.');
