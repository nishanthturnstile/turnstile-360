import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DMS_PUBLIC_ROUTES } from '../packages/dms-contracts/dist/public.js';
import {
  DOCUMENTS_ACCESS_GATED_ROUTES,
  DOCUMENTS_ACCESS_HEADER,
  DOCUMENTS_BATCH_ITEM_OPERATIONS,
  DOCUMENTS_FOUNDATION_OWNER,
  DOCUMENTS_INTENT_ROUTES,
  DOCUMENTS_LIMITS,
  DOCUMENTS_PERMISSIONS,
  DOCUMENTS_REQUEST_ID_HEADER,
  DOCUMENTS_ROUTES,
  documentsJsonSchemas,
  documentsSchemas,
  v3PeopleContracts,
} from '../packages/turnstile-contracts/dist/documents.js';
import { documentsExamples } from './fixtures/documents.mjs';

// Definitions only. Executable Zod refinements are normative beyond structural JSON Schema.
assert.deepEqual(
  DOCUMENTS_ROUTES.map((r) => r.operationId).sort(),
  DMS_PUBLIC_ROUTES.map((r) => r.operationId).sort(),
);
for (const route of DOCUMENTS_ROUTES) {
  const upstream = DMS_PUBLIC_ROUTES.find(
    (candidate) => candidate.operationId === route.operationId,
  );
  assert.deepEqual(
    route.dms,
    { method: upstream.method, path: upstream.path, scopes: upstream.scopes },
    `${route.evidenceId} upstream contract drift`,
  );
}
assert.deepEqual(Object.keys(documentsExamples).sort(), Object.keys(documentsSchemas).sort());
for (const [name, example] of Object.entries(documentsExamples))
  documentsSchemas[name].parse(example);
const schemas = documentsJsonSchemas();
const artifact = {
  version: 1,
  implementation:
    'DV-I01 contracts, DV-I02 guarded reads and validator adoption, DV-I03 secure-only text uploads, DV-I04 metadata, references and assessed versions, DV-I05 batch manifests and durable operations, DV-I06 lifecycle, sharing, Contribute and audit, DV-I07 processing, verified extraction and search, DV-I08 protected validation and diagnostics',
  owner: DOCUMENTS_FOUNDATION_OWNER,
  integration: 'turnstile-api/integrations/dms',
  architecture: '../../architecture.md#documents-validation-workspace-proposal',
  permissions: DOCUMENTS_PERMISSIONS,
  access: {
    header: DOCUMENTS_ACCESS_HEADER,
    version: 3,
    legacyVersion: 2,
    gatedRoutes: DOCUMENTS_ACCESS_GATED_ROUTES,
    legacyRecovery: { status: 401, body: { code: 'LOGIN_REQUIRED' } },
    activation:
      'private durable barrier serialized in the owning access transaction before any Documents role/grant; never reopened by rollback',
  },
  limits: DOCUMENTS_LIMITS,
  validation: {
    checklist: '/api/documents/validation',
    action: 'turnstile:documents:validate',
    responseCorrelationHeader: DOCUMENTS_REQUEST_ID_HEADER,
    observationFields: ['evidenceId', 'status', 'requestId', 'outcome'],
    retention: 'current_verified_documents_visit',
  },
  routes: DOCUMENTS_ROUTES,
  intentRoutes: DOCUMENTS_INTENT_ROUTES,
  batchItemOperations: DOCUMENTS_BATCH_ITEM_OPERATIONS,
  schemas,
  examples: documentsExamples,
  components: { schemas: v3PeopleContracts.peopleJsonSchemas() },
};
const path = fileURLToPath(
  new URL('../docs/api/turnstile-documents.contract.json', import.meta.url),
);
// Every schema reference must resolve inside the generated artifact.
function validateReferences(value) {
  if (!value || typeof value !== 'object') return;
  if (typeof value.$ref === 'string') {
    assert.ok(value.$ref.startsWith('#/'), 'External schema reference');
    let target = artifact;
    for (const part of value.$ref.slice(2).split('/'))
      target = target?.[part.replaceAll('~1', '/').replaceAll('~0', '~')];
    assert.ok(target, `Unresolved reference ${value.$ref}`);
  }
  for (const child of Object.values(value)) validateReferences(child);
}
validateReferences(artifact);
const formatted = spawnSync('pnpm', ['exec', 'biome', 'format', `--stdin-file-path=${path}`], {
  input: JSON.stringify(artifact),
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
assert.equal(formatted.status, 0, `Formatting failed: ${formatted.stderr}`);
const content = formatted.stdout;
if (process.argv.includes('--check'))
  assert.equal(
    readFileSync(path, 'utf8'),
    content,
    'Documents generated contract drift; run pnpm docs:documents',
  );
else writeFileSync(path, content);
const coverage = JSON.parse(
  readFileSync(
    new URL('../docs/turnstile/documents/documents_validation_coverage.json', import.meta.url),
    'utf8',
  ),
);
const checklistPath = fileURLToPath(
  new URL(
    '../apps/turnstile-api/src/modules/documents/documents-validation-outcomes.ts',
    import.meta.url,
  ),
);
const outcomes = Object.fromEntries(
  coverage.operations.map((row) => [row.evidenceId, row.readback]),
);
const checklist = spawnSync(
  'pnpm',
  ['exec', 'biome', 'format', `--stdin-file-path=${checklistPath}`],
  {
    input: `// Generated from the Documents coverage register by pnpm docs:documents.\nexport const validationOutcomes = ${JSON.stringify(outcomes)} as const;\n`,
    encoding: 'utf8',
  },
);
assert.equal(checklist.status, 0, 'Could not format validation expectations');
if (process.argv.includes('--check'))
  assert.equal(
    readFileSync(checklistPath, 'utf8'),
    checklist.stdout,
    'Validation expectations drift',
  );
else writeFileSync(checklistPath, checklist.stdout);
assert.deepEqual(
  coverage.operations.map((row) => row.evidenceId).sort(),
  DOCUMENTS_ROUTES.map((row) => row.evidenceId).sort(),
);
for (const route of DOCUMENTS_ROUTES) {
  const row = coverage.operations.find((row) => row.evidenceId === route.evidenceId);
  assert.equal(row.operationId, route.operationId);
  assert.deepEqual(row.dms, route.dms);
  assert.deepEqual(row.product, route.product);
  assert.equal(row.action, route.action);
  assert.equal(row.mode, route.mode);
  for (const key of [
    'owner',
    'ui',
    'readback',
    'failurePath',
    'automatedTest',
    'sourceEvidence',
    'imageEvidence',
    'targetEvidence',
  ])
    assert.ok(row[key], `${route.evidenceId} missing ${key}`);
}
assert.deepEqual(
  coverage.requirements.map((row) => row.id).sort(),
  Array.from({ length: 20 }, (_, i) => `DV-R${String(i + 1).padStart(2, '0')}`),
);
assert.deepEqual(
  coverage.reviewGates.map((row) => row.id),
  ['RF-01', 'RF-02', 'RF-03', 'RF-04', 'RF-05', 'RF-06'],
);
console.log(
  `Verified Documents schemas/examples, 34-operation coverage, 20 requirements and six review gates (${process.argv.includes('--check') ? 'drift check' : 'generated'}).`,
);
