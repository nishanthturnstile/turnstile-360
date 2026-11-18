import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  authorityKeyCommandJsonSchema,
  backupManifestJsonSchema,
  DMS_OPERATOR_COMMANDS,
  dmsOperatorCommandSchema,
  dmsOperatorJsonSchema,
  operationsSnapshotJsonSchema,
  operatorBatchInspectionJsonSchema,
  operatorUploadInspectionJsonSchema,
  recoveryCommandJsonSchema,
} from '../packages/dms-contracts/dist/private.js';
import { dmsPublicJsonSchemas } from '../packages/dms-contracts/dist/public.js';

const artifact = {
  interface: 'private-process-json-stdin',
  command: 'dms:manage-operator',
  commands: DMS_OPERATOR_COMMANDS,
  description:
    'Fresh verified authority credentials on every invocation. Explicit tenant-bound DMS grant for audit reads. No HTTP operator route. Bootstrap/recovery require explicit maintenance authority and administrator self proof; assign/revoke require current operator grant. Never enter credentials in argv or consumer Swagger.',
  input: dmsOperatorJsonSchema,
  authorityKeys: {
    command: 'auth:manage-keys',
    input: authorityKeyCommandJsonSchema,
    prepublicationSeconds: 60,
    verificationGraceSeconds: 86400,
  },
  recovery: {
    command: 'dms:manage-recovery',
    input: recoveryCommandJsonSchema,
    manifest: backupManifestJsonSchema,
  },
  operationsOutput: operationsSnapshotJsonSchema,
  reprocessOutput: dmsPublicJsonSchemas.ReprocessResponse,
  documentInspectOutput: dmsPublicJsonSchemas.Document,
  effectivePolicyOutput: dmsPublicJsonSchemas.AdmissionPolicy,
  uploadInspectOutput: operatorUploadInspectionJsonSchema,
  batchInspectOutput: operatorBatchInspectionJsonSchema,
  documentLifecycleOutput: dmsPublicJsonSchemas.DocumentLifecycle,
  documentPermissionsOutput: dmsPublicJsonSchemas.DocumentPermissionsResponse,
  auditReadOutput: dmsPublicJsonSchemas.AuditPage,
};
const policy = {
  enabled: false,
  storageBudgetBytes: 1073741824,
  applicationBudgetBytes: 536870912,
  scratchBudgetBytes: 1073741824,
  maxFileBytes: 52428800,
  activePerApplication: 4,
  activePerTenant: 16,
  queuedWork: 100,
  profiles: [],
  contentTypes: [],
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
      ...(action === 'admission-policy-set' ? { expectedRevision: '0', policy } : {}),
      ...(action === 'document-reprocess'
        ? {
            documentId: '11111111-1111-4111-8111-111111111111',
            versionId: '22222222-2222-4222-8222-222222222222',
            profile: 'searchable',
            idempotencyKey: '11111111-1111-4111-8111-111111111111',
          }
        : {}),
      ...(action === 'work-redrive'
        ? {
            jobId: '11111111-1111-4111-8111-111111111111',
            idempotencyKey: '11111111-1111-4111-8111-111111111111',
          }
        : {}),
      ...(action === 'operations-backup-report'
        ? { completedAt: '2026-11-06T12:00:00Z', manifestSha256: 'a'.repeat(64) }
        : {}),
      ...(action === 'work-inspect' ? { jobId: '11111111-1111-4111-8111-111111111111' } : {}),
      ...(action === 'work-authorize' ? { clientId: 'private-scanner', role: 'scanner' } : {}),
      ...(action === 'work-disable' ? { clientId: 'private-scanner' } : {}),
      ...(action === 'upload-inspect' ? { uploadId: '11111111-1111-4111-8111-111111111111' } : {}),
      ...(action === 'batch-inspect' ? { batchId: '11111111-1111-4111-8111-111111111111' } : {}),
      ...(['document-delete', 'document-restore'].includes(action)
        ? { expectedRevision: '1' }
        : {}),
      ...(action === 'document-restore'
        ? { idempotencyKey: '11111111-1111-4111-8111-111111111111' }
        : {}),
      ...(action === 'document-permissions-set'
        ? { expectedRevision: '1', permissions: { grants: [] } }
        : {}),
      ...([
        'document-inspect',
        'document-permissions-read',
        'document-permissions-set',
        'document-lifecycle-read',
        'document-delete',
        'document-restore',
      ].includes(action)
        ? { documentId: '11111111-1111-4111-8111-111111111111' }
        : {}),
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
