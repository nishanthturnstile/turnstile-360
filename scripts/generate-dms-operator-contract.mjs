import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  DMS_OPERATOR_COMMANDS,
  dmsOperatorCommandSchema,
  dmsOperatorJsonSchema,
} from '../packages/dms-contracts/dist/private.js';
import { dmsPublicJsonSchemas } from '../packages/dms-contracts/dist/public.js';

const artifact = {
  interface: 'private-process-json-stdin',
  command: 'dms:manage-operator',
  commands: DMS_OPERATOR_COMMANDS,
  description:
    'Fresh verified authority credentials on every invocation. Explicit tenant-bound DMS grant for audit reads. No HTTP operator route. Bootstrap/recovery require explicit maintenance authority and administrator self proof; assign/revoke require current operator grant. Never enter credentials in argv or consumer Swagger.',
  input: dmsOperatorJsonSchema,
  auditReadOutput: dmsPublicJsonSchemas.AuditPage,
};
const identity = {
  operatorEmail: 'operator@example.test',
  operatorPassword: 'example-only-not-a-real-password',
};
for (const action of DMS_OPERATOR_COMMANDS)
  assert.ok(
    dmsOperatorCommandSchema.safeParse({
      ...identity,
      action,
      ...(['assign', 'revoke'].includes(action) ? { subjectId: 'authority-subject' } : {}),
    }).success,
  );
assert.equal(
  dmsOperatorCommandSchema.safeParse({ ...identity, action: 'audit-read', subjectId: 'untrusted' })
    .success,
  false,
);
assert.equal(
  dmsOperatorCommandSchema.safeParse({ ...identity, action: 'assign', limit: 100 }).success,
  false,
);
assert.equal(
  dmsOperatorCommandSchema.safeParse({ action: 'audit-read', token: 'browser-token' }).success,
  false,
);
const path = 'docs/api/dms-operator.contract.json';
const formatted = spawnSync('pnpm', ['exec', 'biome', 'format', `--stdin-file-path=${path}`], {
  input: JSON.stringify(artifact),
  encoding: 'utf8',
});
assert.equal(formatted.status, 0, 'Private contract formatting failed');
const output = formatted.stdout;
if (process.argv.includes('--check'))
  assert.equal(readFileSync(path, 'utf8'), output, 'Private DMS operator contract drift');
else writeFileSync(path, output);
console.log('Private DMS operator registry/schema verified separately from consumer OpenAPI.');
