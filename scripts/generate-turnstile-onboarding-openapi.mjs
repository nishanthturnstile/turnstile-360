import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';
import {
  CONFIGURATION_LIMITS,
  onboardingJsonSchemas,
  onboardingSchemas,
  TURNSTILE_PERMISSIONS,
} from '../packages/turnstile-contracts/dist/index.js';

const auth = parse(readFileSync('docs/api/turnstile-auth.openapi.yaml', 'utf8'));
assert.deepEqual(
  auth.components.schemas.UserSession.properties.permissions.items.enum,
  [...TURNSTILE_PERMISSIONS],
  'Align the auth document permission catalog without changing the session DTO/protocol',
);
const rootId = '11111111-1111-4111-8111-111111111111';
const requirements = (satisfied) =>
  ['organization_name', 'time_zone', 'organization_root', 'configuration_manager'].map((id) => ({
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
const examples = {
  OrganizationPatch: { expectedRevision: 0, name: 'Example Company', timeZone: 'UTC' },
  UnitCreate: { expectedRevision: 2, type: 'department', parentId: rootId, name: 'Operations' },
  UnitRename: { expectedRevision: 3, name: 'Engineering' },
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
      ...(examples[name] ? { example: examples[name] } : {}),
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
  409: response(
    'ConfigurationConflict',
    'Current revision conflict or other safe configuration conflict. Refetch/reconcile rather than overwriting.',
  ),
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
  { input, unit = false, create = false, accessOnly = false } = {},
) {
  const mutation = !!input;
  return {
    operationId,
    summary,
    description: `${accessOnly ? 'Requires current turnstile:access; returns the same minimal projection to managers and ordinary users.' : 'Requires current turnstile:access and turnstile:configuration:manage; never grants account, access, DMS operator or approval authority.'} Readiness-exempt only; authentication, local access, route permissions and mutation CSRF remain enforced. No query parameters or caller-supplied tenant/application/actor selectors.`,
    'x-implementation-status':
      'implemented in ONB-I03–04; authenticated configuration handlers are explicitly readiness-exempt',
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
  ' Validate persisted name, confirmed zone, root and current manager at one revision. Concurrent or lost-response repeats return the same completion actor/time/version after current authorization; a syntactically valid stale expectedRevision is ignored only after completion. One lifecycle audit outcome. No DMS HTTP call or automatic activation.';
const spec = {
  openapi: '3.1.0',
  info: {
    title: 'Turnstile organization configuration and onboarding',
    version: '1.0.0',
    description:
      'ONB-I03 implements canonical configuration persistence, audited domain operations and these authenticated HTTP handlers. ONB-I04 implements private manager grants and backend readiness enforcement; ONB-I05–06 implement onboarding/waiting and Settings UI; ONB-I07 adds complete-chain verification; ONB-I08 supplies upgrade/recovery procedures and selected local-installation verification. Production target acceptance remains deployment-specific. Same-origin BFF; credentials stay server-side. Generated from shared Zod contracts. JSON Schema captures structural constraints; descriptions record normalization and cross-field invariants enforced by executable schemas/backend services. See architecture.md for limits, authorization and upgrade sequencing.',
  },
  servers: [{ url: '/' }],
  'x-configuration-limits': CONFIGURATION_LIMITS,
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
        'Create a supported optional unit with bounded retry identity',
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
      delete: operation(
        'deleteOrganizationUnit',
        'Remove an unused non-root leaf at the expected revision',
        'ConfigurationSnapshot',
        { input: 'RevisionMutation', unit: true },
      ),
    },
  },
  components: {
    securitySchemes: {
      ProductCookie: auth.components.securitySchemes.ProductCookie,
      LocalProductCookie: auth.components.securitySchemes.LocalProductCookie,
      CsrfToken: auth.components.securitySchemes.CsrfToken,
    },
    schemas: { ...schemas, AuthError: auth.components.schemas.AuthError },
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
