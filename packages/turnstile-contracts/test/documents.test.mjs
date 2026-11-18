import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DMS_PUBLIC_ROUTES } from '@thaarei/dms-contracts/public';
import { documentsExamples } from '../../../scripts/fixtures/documents.mjs';
import {
  DOCUMENTS_ACCESS_GATED_ROUTES,
  DOCUMENTS_BATCH_ITEM_OPERATIONS,
  DOCUMENTS_ERROR_STATUS,
  DOCUMENTS_LIMITS,
  DOCUMENTS_PERMISSIONS,
  DOCUMENTS_ROUTES,
  documentsAccessWireVersion,
  documentsCommandPermissions,
  documentsCommandSchema,
  documentsDraftRequestSchema,
  documentsExecuteRequestSchema,
  documentsForwardedBodyFits,
  documentsJsonBytes,
  documentsReconciliationUntil,
  documentsSchemas,
  documentsValidatorCommandSchema,
  v3PeopleContracts,
} from '../dist/documents.js';
import {
  PEOPLE_PERMISSIONS,
  PEOPLE_ROUTES,
  peopleJsonSchemas,
  peopleSchemas,
  SYSTEM_ROLE_TEMPLATES,
} from '../dist/index.js';

const legacy = JSON.parse(
  readFileSync(new URL('./documents-legacy-v2.fixture.json', import.meta.url)),
);
const clone = structuredClone;
const id = documentsExamples.DocumentsIntentReceipt.id;

test('RF-01: every active v2 schema matches the installed bundle and retains its synthetic payload', () => {
  assert.deepEqual(PEOPLE_PERMISSIONS, legacy.permissions);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(peopleJsonSchemas()).map(([k, v]) => [
        k,
        createHash('sha256').update(JSON.stringify(v)).digest('hex'),
      ]),
    ),
    legacy.schemas,
  );
  for (const [name, value] of Object.entries(legacy.examples)) peopleSchemas[name].parse(value);
  for (const role of SYSTEM_ROLE_TEMPLATES)
    assert.equal(
      role.permissions.some((p) => p.startsWith('turnstile:documents:')),
      false,
    );
});
function withDocuments(value) {
  if (Array.isArray(value)) return value.map(withDocuments);
  if (!value || typeof value !== 'object') return value;
  const result = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withDocuments(v)]));
  if (result.catalogVersion !== undefined) result.catalogVersion = 3;
  if (result.systemKey === null && result.permissions)
    result.permissions.push('turnstile:documents:edit');
  if (result.role?.systemKey === null && result.scope) result.scope = { kind: 'company' };
  if (result.role?.systemKey === null && result.allowedScopes) result.allowedScopes = ['company'];
  if (result.scopeContext)
    result.scopeContext = result.scopeContext.filter((context) =>
      result.assignments.some(
        (a) => a.scope.kind === 'units' && a.scope.unitIds.includes(context.unit.id),
      ),
    );
  return result;
}
test('RF-01: v3 nested role, member, invitation, import, impact and receipt contracts preserve new rights', () => {
  const names = [
    'RoleDefinition',
    'Member',
    'MemberListResponse',
    'RoleListResponse',
    'EligibleRolesResponse',
    'Invitation',
    'InvitationListResponse',
    'ImportJob',
    'ImportDetail',
    'ImportList',
    'ImpactReview',
    'PeopleCommandResult',
    'RecipientReview',
    'RestrictedInvitationContext',
  ];
  for (const name of names) {
    const payload = withDocuments(clone(legacy.examples[name]));
    assert.match(JSON.stringify(payload), /turnstile:documents:edit/, name);
    assert.deepEqual(v3PeopleContracts.peopleSchemas[name].parse(payload), payload, name);
    assert.equal(peopleSchemas[name].safeParse(payload).success, false, name);
  }
  const session = clone(legacy.examples.AccessAwareUserSession);
  session.access.catalogVersion = 3;
  session.access.grants[0].scope = { kind: 'company' };
  session.access.grants[0].permissions.push('turnstile:documents:edit');
  session.permissions.push('turnstile:documents:edit');
  v3PeopleContracts.peopleSchemas.AccessAwareUserSession.parse(session);
  session.access.grants[0].scope = { kind: 'units', unitIds: [id], includeChildren: false };
  assert.equal(
    v3PeopleContracts.peopleSchemas.AccessAwareUserSession.safeParse(session).success,
    false,
  );
  const catalog = clone(legacy.examples.PermissionCatalog);
  catalog.catalogVersion = 3;
  catalog.permissions.push(
    ...DOCUMENTS_PERMISSIONS.map((id) => ({ id, applicability: 'company_only', implies: [] })),
  );
  v3PeopleContracts.peopleSchemas.PermissionCatalog.parse(catalog);
  catalog.permissions.at(-1).implies.push('turnstile:documents:read');
  assert.equal(v3PeopleContracts.peopleSchemas.PermissionCatalog.safeParse(catalog).success, false);
  for (const route of PEOPLE_ROUTES.filter(
    (r) => r.path.startsWith('/api/people/') || r.path.startsWith('/api/invitations/'),
  ))
    assert.ok(
      DOCUMENTS_ACCESS_GATED_ROUTES.some((r) => r.method === route.method && r.path === route.path),
    );
  assert.equal(
    documentsAccessWireVersion(undefined, { state: 'dual', documentsGrantsEnabled: false }),
    2,
  );
  assert.equal(
    documentsAccessWireVersion(undefined, { state: 'v3_required', minimumContract: 3 }),
    'LOGIN_REQUIRED',
  );
  assert.equal(documentsAccessWireVersion('3', { state: 'v3_required', minimumContract: 3 }), 3);
});
test('RF-02: private reviewed company grants require proofs, revision, explicit shell and v3 activation', () => {
  const valid = documentsExamples.DocumentsValidatorCommand;
  documentsValidatorCommandSchema.parse(valid);
  for (const patch of [
    { permissions: ['turnstile:documents:read'] },
    { permissions: ['turnstile:access', 'turnstile:people:manage'] },
    { activateV3Barrier: false },
    { scope: 'units' },
    { targetCookie: '' },
    { operatorCookie: '\r\n' },
    { expectedAccessRevision: -1 },
    { systemKey: 'workspace_administrator' },
  ])
    assert.equal(documentsValidatorCommandSchema.safeParse({ ...valid, ...patch }).success, false);
  assert.equal(
    documentsValidatorCommandSchema.safeParse({
      ...valid,
      action: 'handover',
      fromUserId: valid.targetUserId,
    }).success,
    false,
  );
});
test('RF-03: scoped UTF-8 envelope and forwarded actor bytes remain independently bounded', () => {
  for (const text of ['ascii', 'é', '😀', '\ud800'])
    assert.equal(documentsJsonBytes({ text }), Buffer.byteLength(JSON.stringify({ text })));
  const body = { text: '' };
  body.text = 'a'.repeat(DOCUMENTS_LIMITS.upstreamControlBytes - documentsJsonBytes(body));
  assert.equal(documentsForwardedBodyFits('upload.begin', body), true);
  assert.equal(
    documentsForwardedBodyFits('upload.begin', {
      ...body,
      assertedHuman: { source: 'application-asserted', subject: 'example' },
    }),
    false,
  );
  assert.equal(documentsForwardedBodyFits('upload.begin', { text: `${body.text}é` }), false);
  assert.equal(DOCUMENTS_ERROR_STATUS.DOCUMENTS_TOO_LARGE, 413);
  assert.equal(DOCUMENTS_ERROR_STATUS.DOCUMENTS_MEDIA_TYPE_UNSUPPORTED, 415);
  const manifest = {
    kind: 'batch.create',
    payload: {
      items: [
        {
          itemId: 'same',
          operation: 'create',
          descriptor: documentsExamples.DocumentsCommand.payload,
        },
        {
          itemId: 'same',
          operation: 'create',
          descriptor: documentsExamples.DocumentsCommand.payload,
        },
      ],
    },
  };
  assert.equal(documentsCommandSchema.safeParse(manifest).success, false);
});
test('RF-04: execution names only an existing intent; replay deadline never exceeds upstream safety window', () => {
  documentsExecuteRequestSchema.parse({ digest: 'a'.repeat(64) });
  assert.equal(
    documentsExecuteRequestSchema.safeParse({
      digest: 'a'.repeat(64),
      command: documentsExamples.DocumentsCommand,
    }).success,
    false,
  );
  const first = Date.parse('2026-11-17T10:00:00Z');
  assert.equal(documentsReconciliationUntil(first), first + 23 * 3600_000);
  assert.equal(documentsReconciliationUntil(first, first + 600_000), first + 540_000);
  assert.throws(() => documentsReconciliationUntil(Number.NaN));
  assert.equal(DOCUMENTS_ERROR_STATUS.DOCUMENTS_INTENT_GONE, 410);
});
test('RF-05/06: no-READ contribution uses finite commands and every public mutation requires both products full', () => {
  const draft = {
    mode: 'contribute',
    command: {
      kind: 'document.edit',
      documentId: id,
      expectedRevision: '1',
      payload: { title: 'Intended edit' },
    },
  };
  documentsDraftRequestSchema.parse(draft);
  const version = {
    mode: 'contribute',
    command: {
      kind: 'version.begin',
      documentId: id,
      expectedRevision: '1',
      payload: structuredClone(documentsExamples.DocumentsCommand.payload),
    },
  };
  documentsDraftRequestSchema.parse(version);
  assert.deepEqual(documentsCommandPermissions('version.begin', 'contribute'), [
    'turnstile:access',
    'turnstile:documents:upload',
    'turnstile:documents:validate',
  ]);
  delete version.command.payload.sha256;
  assert.equal(documentsDraftRequestSchema.safeParse(version).success, false);
  assert.equal(
    DOCUMENTS_ROUTES.find((route) => route.operationId === 'getDmsUpload').action,
    'turnstile:documents:read',
  );

  assert.deepEqual(documentsCommandPermissions('document.edit', 'contribute'), [
    'turnstile:access',
    'turnstile:documents:edit',
    'turnstile:documents:validate',
  ]);
  assert.equal(
    documentsDraftRequestSchema.safeParse({
      ...draft,
      command: {
        kind: 'permissions.replace',
        documentId: id,
        expectedRevision: '1',
        payload: { grants: [] },
      },
    }).success,
    false,
  );
  for (const patch of [
    { tenantId: id },
    { applicationId: id },
    { actor: { subject: 'owner' } },
    { url: 'https://example.test' },
    { method: 'PUT' },
  ])
    assert.equal(
      documentsCommandSchema.safeParse({ ...documentsExamples.DocumentsCommand, ...patch }).success,
      false,
    );
  for (const route of DOCUMENTS_ROUTES.filter((r) => r.product && 'command' in r.product))
    assert.equal(route.mode, 'full_both_products');
  assert.equal(
    DOCUMENTS_ROUTES.find((r) => r.operationId === 'searchDmsDocuments').product.method,
    'GET',
  );
  assert.equal(
    DOCUMENTS_ROUTES.find((r) => r.operationId === 'enrollDmsApplication').product,
    null,
  );
  assert.deepEqual(
    DOCUMENTS_ROUTES.map((r) => r.operationId).sort(),
    DMS_PUBLIC_ROUTES.map((r) => r.operationId).sort(),
  );
  assert.equal(new Set(DOCUMENTS_ROUTES.map((r) => r.evidenceId)).size, 34);
  assert.deepEqual(
    new Set(documentsCommandSchema.options.map((o) => o.shape.kind.value)),
    new Set([
      'batch.item',
      ...DOCUMENTS_ROUTES.filter((r) => r.product && 'command' in r.product).map(
        (r) => r.product.command,
      ),
    ]),
  );
  for (const operationId of Object.values(DOCUMENTS_BATCH_ITEM_OPERATIONS))
    assert.equal(
      DOCUMENTS_ROUTES.find((r) => r.operationId === operationId)?.action,
      'turnstile:documents:upload',
    );
  assert.deepEqual(
    documentsCommandPermissions('batch.item', 'ordinary'),
    documentsCommandPermissions('upload.begin', 'ordinary'),
  );
  for (const [name, value] of Object.entries(documentsExamples))
    documentsSchemas[name].parse(value);
});
