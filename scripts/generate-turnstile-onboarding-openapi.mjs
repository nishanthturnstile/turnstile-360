import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';
import {
  CONFIGURATION_LIMITS,
  onboardingJsonSchemas,
  onboardingSchemas,
  PEOPLE_PERMISSIONS,
} from '../packages/turnstile-contracts/dist/index.js';

const auth = parse(readFileSync('docs/api/turnstile-auth.openapi.yaml', 'utf8'));
assert.deepEqual(
  auth.components.schemas.UserSession.properties.permissions.items.enum,
  [...PEOPLE_PERMISSIONS],
  'Align the auth document with canonical session permissions',
);
assert.ok(auth.components.schemas.UserSession.required.includes('access'));
assert.equal(
  auth.components.schemas.UserSession.properties.access.$ref,
  'turnstile-people.openapi.json#/components/schemas/UserAccessContext',
);
const rootId = '11111111-1111-4111-8111-111111111111';
const requirements = (satisfied, version = 1) =>
  [
    'organization_name',
    'time_zone',
    'organization_root',
    ...(version === 2 ? ['first_unit'] : []),
    'configuration_manager',
  ].map((id) => ({
    id,
    satisfied,
  }));
const complete = {
  revision: 2,
  organization: { name: 'Example Company', timeZone: 'UTC', rootId },
  units: [
    { id: rootId, type: 'organization', parentId: null, name: 'Example Company', ancestorIds: [] },
  ],
  setup: {
    state: 'completed',
    requirementVersion: 1,
    revision: 2,
    requirements: requirements(true),
    nextStep: null,
    completion: {
      completedAt: '2026-11-01T12:00:00Z',
      completedBy: 'example-user',
      requirementVersion: 1,
    },
  },
};
const completeV2 = {
  ...complete,
  revision: 3,
  organization: { ...complete.organization, timeZone: 'Asia/Kolkata' },
  units: [
    ...complete.units,
    {
      id: '22222222-2222-4222-8222-222222222222',
      type: 'department',
      parentId: rootId,
      name: 'Operations',
      ancestorIds: [rootId],
    },
  ],
  setup: {
    ...complete.setup,
    requirementVersion: 2,
    revision: 3,
    requirements: requirements(true, 2),
    completion: { ...complete.setup.completion, requirementVersion: 2 },
  },
};
const needsFirstUnit = {
  ...completeV2,
  revision: 1,
  units: complete.units,
  setup: {
    ...completeV2.setup,
    state: 'in_progress',
    revision: 1,
    requirements: requirements(true, 2).map((item) => ({
      ...item,
      satisfied: item.id !== 'first_unit',
    })),
    nextStep: 'structure',
    completion: null,
  },
};
const examples = {
  OrganizationPatch: { expectedRevision: 0, name: 'Example Company', timeZone: 'UTC' },
  UnitCreate: { expectedRevision: 2, type: 'department', parentId: rootId, name: 'Operations' },
  UnitRename: { expectedRevision: 3, name: 'Engineering' },
  UnitMove: { expectedRevision: 4, parentId: rootId },
  RevisionMutation: { expectedRevision: 1 },
  WorkspaceStatus: { status: 'incomplete', canManageConfiguration: false },
  Setup: complete.setup,
  OrganizationResponse: { revision: 2, organization: complete.organization },
  OrganizationUnitsResponse: { revision: 2, units: complete.units },
  ConfigurationSnapshot: complete,
  UnitCreateResponse: {
    configuration: complete,
    unitId: '22222222-2222-4222-8222-222222222222',
    replayed: true,
  },
  ConfigurationInvalid: {
    code: 'CONFIGURATION_INVALID',
    fieldErrors: [{ field: 'name', reason: 'invalid' }],
  },
  ConfigurationConflict: { code: 'CONFIGURATION_CONFLICT', reason: 'revision', revision: 2 },
  ConfigurationNotFound: { code: 'CONFIGURATION_NOT_FOUND' },
  SetupRequired: { code: 'SETUP_REQUIRED' },
  ConfigurationTooLarge: { code: 'CONFIGURATION_TOO_LARGE' },
  ConfigurationMediaType: { code: 'CONFIGURATION_MEDIA_TYPE_UNSUPPORTED' },
  ConfigurationUnavailable: { code: 'CONFIGURATION_UNAVAILABLE' },
};
for (const [name, value] of Object.entries(examples)) onboardingSchemas[name].parse(value);
const namedExamples = {
  ConfigurationSnapshot: {
    completedV1: { summary: 'Preserved legacy root-only completion', value: complete },
    firstUnitRequiredV2: { summary: 'V2 profile saved; resume First unit', value: needsFirstUnit },
    completedV2: { summary: 'V2 completed with a direct-child Department', value: completeV2 },
  },
  Setup: {
    completedV1: { summary: 'Completed v1 retains four requirements', value: complete.setup },
    firstUnitRequiredV2: {
      summary: 'V2 resumes Structure until first unit is saved',
      value: needsFirstUnit.setup,
    },
    completedV2: {
      summary: 'V2 completed with five satisfied requirements',
      value: completeV2.setup,
    },
  },
};
for (const [name, values] of Object.entries(namedExamples))
  for (const example of Object.values(values)) onboardingSchemas[name].parse(example.value);
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const schemas = onboardingJsonSchemas();
// Keep one generated zone enum while preserving every executable schema's allowed values.
function shareTimeZone(value) {
  if (!value || typeof value !== 'object') return value;
  if (
    Array.isArray(value.enum) &&
    value.enum.length === schemas.TimeZone.enum.length &&
    value.enum.every((zone, index) => zone === schemas.TimeZone.enum[index])
  )
    return ref('TimeZone');
  for (const [key, nested] of Object.entries(value)) value[key] = shareTimeZone(nested);
  return value;
}
for (const [name, schema] of Object.entries(schemas))
  if (name !== 'TimeZone') shareTimeZone(schema);
const headers = {
  'Cache-Control': { schema: { type: 'string', const: 'private, no-store' } },
  'Referrer-Policy': { schema: { type: 'string', const: 'no-referrer' } },
};
const response = (name, description) => ({
  description,
  headers,
  content: {
    'application/json': {
      schema: ref(name),
      ...(namedExamples[name]
        ? { examples: namedExamples[name] }
        : examples[name]
          ? { example: examples[name] }
          : {}),
    },
  },
});
const authErrors = {
  401: {
    ...response('AuthError', 'Existing identity/session error; login is required.'),
    headers: { ...headers, 'Cache-Control': { schema: { type: 'string', const: 'no-store' } } },
  },
  403: {
    ...response(
      'AuthError',
      'Existing local access, route permission or CSRF denial. No setup details are disclosed.',
    ),
    headers: { ...headers, 'Cache-Control': { schema: { type: 'string', const: 'no-store' } } },
  },
};
const common = {
  ...authErrors,
  409: response(
    'AccessContextChanged',
    'Access context changed. Fetch current session/CSRF and deliberately resubmit; keep drafts.',
  ),
  503: {
    ...response(
      'ConfigurationUnavailable',
      'Configuration unavailable without revoking a valid session. Live identity verification can independently fail with AUTH_UNAVAILABLE or REFRESH_IN_PROGRESS.',
    ),
    content: {
      'application/json': {
        schema: { oneOf: [ref('ConfigurationUnavailable'), ref('AuthError')] },
      },
    },
    headers: {
      ...headers,
      'Cache-Control': { schema: { type: 'string', enum: ['no-store', 'private, no-store'] } },
    },
  },
};
common[400] = response(
  'ConfigurationInvalid',
  'Strict input/query validation failed; caller-selected identity fields are unsupported.',
);
const errors = {
  ...common,
  400: response(
    'ConfigurationInvalid',
    'Invalid strict JSON input; finite safe field errors without rejected values.',
  ),
  409: {
    ...response(
      'ConfigurationConflict',
      'Current configuration or access context changed. Refetch/reconcile before explicitly resubmitting.',
    ),
    content: {
      'application/json': {
        schema: { oneOf: [ref('ConfigurationConflict'), ref('AccessContextChanged')] },
      },
    },
  },
  413: response(
    'ConfigurationTooLarge',
    `Body exceeds ${CONFIGURATION_LIMITS.bodyBytes} UTF-8 bytes.`,
  ),
  415: response('ConfigurationMediaType', 'Mutation requires application/json.'),
};
const security = (mutation) => [
  { ProductCookie: [], ...(mutation ? { CsrfToken: [] } : {}) },
  { LocalProductCookie: [], ...(mutation ? { CsrfToken: [] } : {}) },
];
const origin = {
  in: 'header',
  name: 'Origin',
  required: true,
  schema: { type: 'string', format: 'uri' },
  description:
    'Must exactly equal the configured application origin. Same-origin Fetch Metadata is required when supplied.',
};
const unitId = {
  in: 'path',
  name: 'id',
  required: true,
  schema: schemas.UnitPath.properties.id,
};
function operation(
  operationId,
  summary,
  result,
  {
    input,
    unit = false,
    create = false,
    accessOnly = false,
    implementation = 'implemented in ONB-I03–04 with ONB-RD03 version-aware projections, initialization/upgrade and first-unit enforcement; readiness-exempt',
  } = {},
) {
  const mutation = !!input;
  return {
    operationId,
    summary,
    description: `${accessOnly ? 'Requires current turnstile:access; returns the same minimal projection to managers and ordinary users.' : 'Requires current turnstile:access and turnstile:configuration:manage; never grants account, access, DMS operator or approval authority.'} Readiness-exempt only; authentication, local access, route permissions and mutation CSRF remain enforced. No query parameters or caller-supplied tenant/application/actor selectors.`,
    'x-implementation-status': implementation,
    security: security(mutation),
    ...(mutation || unit
      ? {
          parameters: [
            ...(unit ? [unitId] : []),
            ...(mutation ? [origin] : []),
            ...(create
              ? [
                  {
                    in: 'header',
                    name: 'Idempotency-Key',
                    required: true,
                    schema: schemas.UnitCreateHeaders.properties['idempotency-key'],
                    description:
                      'One UUID per intended create. Retain exact body and key for explicit retries for 24 hours. Current authorization is rechecked before receipt lookup; mismatch conflicts. Replay returns original unitId plus current configuration, even if the unit was later deleted. Never resurrect or blindly retry with a fresh key.',
                  },
                ]
              : []),
          ],
        }
      : {}),
    ...(mutation
      ? {
          'x-max-body-bytes': CONFIGURATION_LIMITS.bodyBytes,
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref(input), example: examples[input] } },
          },
        }
      : {}),
    responses: {
      ...(mutation ? errors : common),
      ...(unit
        ? {
            404: response(
              'ConfigurationNotFound',
              'Addressed unit is not available in this installation.',
            ),
          }
        : {}),
      200: response(
        result,
        create
          ? 'Authorized identical replay; same unitId and current configuration with replayed=true.'
          : 'Authoritative current state. Mutations return the committed configuration revision.',
      ),
      ...(create
        ? {
            201: {
              ...response(
                result,
                'First unit creation committed with revision, audit and receipt; replayed=false.',
              ),
              content: { 'application/json': { schema: ref(result) } },
            },
          }
        : {}),
    },
  };
}
const completeOperation = operation(
  'completeWorkspaceSetup',
  'Atomically activate or read back the completed workspace',
  'ConfigurationSnapshot',
  { input: 'RevisionMutation' },
);
completeOperation.description +=
  ' Validate persisted name, confirmed zone, root and current manager at one revision; v2 additionally requires a saved direct-child Site or Department, otherwise 400 CONFIGURATION_INVALID with body/required. Completed v1 remains valid without first_unit. Concurrent or lost-response repeats return the same completion actor/time/version after current authorization; a syntactically valid stale expectedRevision is ignored only after completion. One lifecycle audit outcome. No DMS HTTP call or automatic activation.';
const deleteOperation = operation(
  'deleteOrganizationUnit',
  'Remove an unused non-root leaf at the expected revision',
  'ConfigurationSnapshot',
  { input: 'RevisionMutation', unit: true },
);
deleteOperation.description +=
  ' ONB-RD03: deleting the last qualifying direct-child unit before v2 completion returns setup to Structure. After v2 completion it returns 409 CONFIGURATION_CONFLICT/required_unit without a state, revision or audit change. Completed v1 retains its optional-unit policy. All versions retain leaf/reference and root-identity protection.';
const moveOperation = operation(
  'moveOrganizationUnit',
  'Move a non-root subtree to a saved parent at the current revision',
  'ConfigurationSnapshot',
  {
    input: 'UnitMove',
    unit: true,
    implementation:
      'implemented in ONB-RD04 with live manage/CSRF checks, guarded parent-column privileges, canonical subtree validation and atomic move audit/revision; readiness-exempt',
  },
);
moveOperation.description +=
  ' Lock canonical configuration and recheck live permissions/revision before source/destination validation. Reject missing units (404), root moves (id/unsupported), self/descendant/type relationships (parentId/invalid), subtree depth (parentId/limit_reached), duplicate siblings, implemented reference refusals (409 unit_in_use) and last-required-unit removal (409 required_unit). Existing root/parent references, create receipts, IDs/types, descendant links, completion and grants survive valid moves. Effective moves commit one revision and unit_moved audit atomically; same-parent/current-revision requests are no-ops. Canonical readback after lost responses precedes any explicit retry; no automatic write replay. The sole direct child cannot move below another node without creating a cycle under the current rooted model; the explicit v2 required-unit guard is retained as a backstop.';
const spec = {
  openapi: '3.1.0',
  info: {
    title: 'Turnstile organization configuration and onboarding',
    version: '2.0.0',
    description:
      'ONB-RD02 supplies executable v1/v2 setup contracts and exact Kolkata/Calcutta/UTC support. ONB-RD03 implements v2 initialization, incomplete-only v1 upgrade, canonical readiness, first-unit activation and completed-v2 last-unit deletion protection. Completed v1 preserves version/revision/completion and optional-unit policy. ONB-RD04 implements the guarded, revision-checked parent-change handler and atomic move audit. ONB-RD05 implements dedicated resumable Organization/First unit/Review and ordinary waiting layouts. ONB-RD06 consumes parent changes in a shared visual editor with confirmed Move to/pointer/touch paths and explicit readback. ONB-RD07 supplies persistent responsive completed navigation and canonical ongoing Settings. ONB-RD08 verifies exact packaged migrations/contracts, version-aware archive preservation and the selected local release. Ship compatible migrations/API/web together after full verification; source implementation is not target rollout and old strict clients cannot be assumed to parse v2. Production acceptance is deployment-specific. Same-origin BFF; credentials stay server-side. Generated from shared Zod contracts; JSON Schema records structural rules and descriptions record executable normalization/cross-field rules. See architecture.md for limits, authorization and upgrade sequencing.',
  },
  servers: [{ url: '/' }],
  'x-configuration-limits': CONFIGURATION_LIMITS,
  'x-setup-policy': {
    contractVersions: [1, 2],
    targetInitializationVersion: 2,
    runtimeInitializationVersion: 2,
    description:
      'RD03 initializes v2 after the owning migrations and upgrades only incomplete v1 without changing business revision, saved data or zone. Completed v1 preserves version/revision/completion and optional-unit policy; completed v2 protects its final qualifying direct child. Time-zone-list provenance is independent of setup requirement version.',
  },
  'x-workspace-business-gate': {
    status: 409,
    schema: ref('SetupRequired'),
    description:
      'ONB-I04 enforces: otherwise permitted business operations, including /api/dms/capabilities, require completed setup. Explicit route permissions precede readiness. Auth/session/logout/health retain their established boundaries. Optional feature outages never undo completion.',
  },
  paths: {
    '/api/workspace/status': {
      get: operation('getWorkspaceStatus', 'Read minimal workspace readiness', 'WorkspaceStatus', {
        accessOnly: true,
      }),
    },
    '/api/setup': {
      get: operation('getWorkspaceSetup', 'Read manager-only requirements and completion', 'Setup'),
    },
    '/api/setup/complete': { post: completeOperation },
    '/api/organization': {
      get: operation(
        'getOrganization',
        'Read the canonical profile and current revision',
        'OrganizationResponse',
      ),
      patch: operation(
        'saveOrganization',
        'Explicitly save profile fields; omission retains current values',
        'ConfigurationSnapshot',
        { input: 'OrganizationPatch' },
      ),
    },
    '/api/organization/units': {
      get: operation(
        'listOrganizationUnits',
        'Read all bounded units with root-to-parent ancestry',
        'OrganizationUnitsResponse',
      ),
      post: operation(
        'createOrganizationUnit',
        'Create a supported unit with bounded retry identity',
        'UnitCreateResponse',
        { input: 'UnitCreate', create: true },
      ),
    },
    '/api/organization/units/{id}': {
      patch: operation(
        'renameOrganizationUnit',
        'Rename a non-root unit without changing identity, parent or type',
        'ConfigurationSnapshot',
        { input: 'UnitRename', unit: true },
      ),
      delete: deleteOperation,
    },
    '/api/organization/units/{id}/parent': { patch: moveOperation },
  },
  components: {
    securitySchemes: {
      ProductCookie: auth.components.securitySchemes.ProductCookie,
      LocalProductCookie: auth.components.securitySchemes.LocalProductCookie,
      CsrfToken: auth.components.securitySchemes.CsrfToken,
    },
    schemas: {
      ...schemas,
      AuthError: auth.components.schemas.AuthError,
      AccessContextChanged: auth.components.schemas.AccessContextChanged,
    },
  },
};
// Resolve every emitted local reference, including nested JSON Schema definitions.
function verifyReferences(value) {
  if (!value || typeof value !== 'object') return;
  if (typeof value.$ref === 'string') {
    assert.ok(value.$ref.startsWith('#/'), 'Only local OpenAPI references are supported');
    const target = value.$ref
      .slice(2)
      .split('/')
      .reduce((item, key) => item?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], spec);
    assert.ok(target, `Unresolved reference: ${value.$ref}`);
  }
  for (const nested of Object.values(value)) verifyReferences(nested);
}
verifyReferences(spec);
const destination = 'docs/api/turnstile-onboarding.openapi.json';
const formatted = spawnSync(
  'pnpm',
  ['exec', 'biome', 'format', `--stdin-file-path=${destination}`],
  { input: JSON.stringify(spec), encoding: 'utf8' },
);
assert.equal(formatted.status, 0, 'OpenAPI formatting failed');
if (process.argv.includes('--check')) {
  assert.equal(
    readFileSync(destination, 'utf8'),
    formatted.stdout,
    'Regenerate the Turnstile onboarding OpenAPI contract',
  );
  console.log(
    'Onboarding OpenAPI, references, examples and existing auth permission catalog are consistent.',
  );
} else {
  writeFileSync(destination, formatted.stdout);
  console.log(`Generated ${destination} from shared contracts.`);
}
