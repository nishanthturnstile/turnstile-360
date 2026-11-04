import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';
import {
  IDENTITY_SERVICE_AUDIENCE_PATH,
  IDENTITY_SERVICE_CLIENT_PURPOSE,
  IDENTITY_SERVICE_ERROR_STATUS,
  IDENTITY_SERVICE_ROUTES,
  IDENTITY_SERVICE_SCOPES,
  identityServiceJsonSchemas,
  identityServiceSchemas,
} from '../packages/dms-contracts/dist/index.js';
import {
  PEOPLE_API_VERSION,
  PEOPLE_ERROR_STATUS,
  PEOPLE_LIMITS,
  PEOPLE_ROUTES,
  peopleJsonSchemas,
  peopleSchemas,
} from '../packages/turnstile-contracts/dist/index.js';
import {
  identityExamples,
  peopleExamples,
  peopleNamedExamples,
} from './fixtures/user-management.mjs';

for (const [name, value] of Object.entries(peopleExamples)) peopleSchemas[name].parse(value);
for (const [name, examples] of Object.entries(peopleNamedExamples))
  for (const { value } of Object.values(examples)) peopleSchemas[name].parse(value);
for (const [name, value] of Object.entries(identityExamples))
  identityServiceSchemas[name].parse(value);
assert.deepEqual(
  Object.keys(peopleExamples).sort(),
  Object.keys(peopleSchemas).sort(),
  'Every product contract needs a checked example',
);
assert.deepEqual(
  Object.keys(identityExamples).sort(),
  Object.keys(identityServiceSchemas).sort(),
  'Every authority contract needs a checked example',
);
const installedAuth = parse(readFileSync('docs/api/turnstile-auth.openapi.yaml', 'utf8'));
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const safeHeaders = {
  'Cache-Control': { schema: { type: 'string', const: 'private, no-store' } },
  'Referrer-Policy': { schema: { type: 'string', const: 'no-referrer' } },
};
function content(name, examples, named = {}) {
  return {
    'application/json': {
      schema: ref(name),
      ...(named[name]
        ? { examples: named[name] }
        : examples[name]
          ? { example: examples[name] }
          : {}),
    },
  };
}
function response(name, examples, named, description = 'Validated safe current projection') {
  return { description, headers: safeHeaders, content: content(name, examples, named) };
}
// Split executable error unions by their frozen HTTP status, rather than documenting
// e.g. a 410 bearer result as a valid 200/401 payload.
function errorsByStatus(schema, statuses, prefix) {
  const schemas = {};
  for (const status of new Set(Object.values(statuses))) {
    const branches = (schema.anyOf ?? [schema]).flatMap((source) => {
      const value = structuredClone(source);
      delete value.$schema;
      const code = value.properties.code;
      const codes = (code.enum ?? [code.const]).filter(
        (candidate) => statuses[candidate] === status,
      );
      if (!codes.length) return [];
      delete code.const;
      code.enum = codes;
      if (prefix === 'IdentityServiceError') {
        if (status === 429) value.required.push('retryAfterSeconds');
        else delete value.properties.retryAfterSeconds;
      }
      return [value];
    });
    assert.ok(branches.length);
    schemas[`${prefix}${status}`] = branches.length === 1 ? branches[0] : { anyOf: branches };
  }
  return schemas;
}
const policies = {
  normal_people:
    'Live normal shell session; completed workspace; company turnstile:people:manage. Mutations recheck action/scope ceiling, references, protected counts and versions under owning transaction locks.',
  normal_roles:
    'Live normal shell session; completed workspace; company turnstile:roles:manage. Referenced permission changes additionally require people authority and every affected grant ceiling; system definitions stay read-only.',
  normal_catalog:
    'Live normal shell session; completed workspace; company people OR role management. Catalog availability requires owning backend implementation.',
  normal_impact:
    'Live normal shell session; completed workspace; authorize the discriminated command/current receipt operation. Referenced role permission impact needs both role and people powers. Definition-only visibility never includes member identities.',
  normal_unit_read:
    'Live normal shell session; completed workspace; matching unit read/manage coverage or company configuration authority. Apply scope before list/count/pagination and safe readback. Breadcrumb context is display-only.',
  normal_unit_write:
    'Live normal shell session; completed workspace; operation-specific current unit and relationship coverage. Exact-only parent management cannot create an inaccessible child. Preserve hierarchy/reference/setup rules.',
  normal_unit_move:
    'Live normal shell session; completed workspace; source/source-parent/destination/resulting-subtree coverage. Cross-boundary moves require company structure authority; access-changing moves additionally require company people authority, grant ceilings and confirmed impact.',
  invitation_credential:
    'No ordinary session authority. Exact Origin/Fetch Metadata plus bounded opaque current invitation credential. Establish restricted continuation/CSRF only; no membership, verification or account creation.',
  invitation_continuation:
    'Purpose-bound pre-identity or verified restricted continuation; never ordinary productUser or a broad public/readiness exemption. Revalidate current generation/expiry/approval. GET performs no consumption, provisioning or acceptance.',
  invitation_verified:
    'Purpose-bound restricted matching verified live authority identity, current generation/expiry/approval/review, membership and unit policy. Explicit protected acceptance commits membership/receipt/audit once, before separate ordinary-session establishment. Replay reads current membership, never restores grants.',
  invitation_parent_logout:
    'Restricted continuation/logout receipt and explicit consent to end the exact current authority parent. A changed browser parent invalidates the attempt. Cancel/sign-out cannot change other application memberships or credentials.',
};
function errorResponses(statuses, prefix, named) {
  return Object.fromEntries(
    [...new Set(Object.values(statuses))].map((status) => {
      const allowedExamples = Object.fromEntries(
        Object.entries(named?.[prefix] ?? {}).filter(
          ([, example]) => statuses[example.value.code] === status,
        ),
      );
      return [
        status,
        {
          description: `Finite ${status} error; no raw inputs, credentials, provider errors or hidden resources.`,
          headers: {
            ...safeHeaders,
            ...(status === 429
              ? { 'Retry-After': { schema: { type: 'integer', minimum: 1, maximum: 3600 } } }
              : {}),
          },
          content: {
            'application/json': {
              schema: ref(`${prefix}${status}`),
              ...(Object.keys(allowedExamples).length ? { examples: allowedExamples } : {}),
            },
          },
        },
      ];
    }),
  );
}
function errorResponseRefs(statuses, prefix) {
  return Object.fromEntries(
    [...new Set(Object.values(statuses))].map((status) => [
      status,
      { $ref: `#/components/responses/${prefix}${status}` },
    ]),
  );
}
function sharedResponses(routes, examples, named, statuses, prefix) {
  return {
    ...Object.fromEntries(
      [...new Set(routes.map((route) => route.response))].map((name) => [
        name,
        response(name, examples, named),
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(errorResponses(statuses, prefix, named)).map(([status, value]) => [
        `${prefix}${status}`,
        value,
      ]),
    ),
  };
}
function assertReferences(document) {
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      assert.ok(value.$ref.startsWith('#/'));
      const target = value.$ref
        .slice(2)
        .split('/')
        .reduce((row, part) => row?.[part.replaceAll('~1', '/').replaceAll('~0', '~')], document);
      assert.ok(target, `Unresolved reference ${value.$ref}`);
    }
    for (const nested of Object.values(value)) visit(nested);
  };
  visit(document);
}
const productSchemas = peopleJsonSchemas();
const productPaths = {};
const implementedStructureRoutes = new Set(
  PEOPLE_ROUTES.filter((route) => route.path.startsWith('/api/structure/')).map(
    (route) => `${route.method} ${route.path}`,
  ),
);
for (const route of PEOPLE_ROUTES) {
  const normal = route.policy.startsWith('normal_');
  const credential = route.policy === 'invitation_credential';
  const mutation = route.method !== 'GET';
  const security = credential
    ? []
    : normal
      ? [
          { ProductCookie: [], ...(mutation ? { CsrfToken: [] } : {}) },
          { LocalProductCookie: [], ...(mutation ? { CsrfToken: [] } : {}) },
        ]
      : [
          { InvitationContinuation: [], ...(mutation ? { CsrfToken: [] } : {}) },
          { LocalInvitationContinuation: [], ...(mutation ? { CsrfToken: [] } : {}) },
        ];
  const parameters = [];
  if (route.path.includes('{id}'))
    parameters.push({
      name: 'id',
      in: 'path',
      required: true,
      schema: productSchemas.PeoplePath.properties.id,
    });
  if (route.query) {
    const schema = productSchemas[route.query];
    for (const [name, property] of Object.entries(schema.properties))
      parameters.push({
        name,
        in: 'query',
        required: (schema.required ?? []).includes(name),
        schema: property,
      });
  }
  if (route.idempotency)
    parameters.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: true,
      schema: productSchemas.PeopleMutationHeaders.properties['idempotency-key'],
      description:
        'Command UUID, unique per installation/actor. Different operation or canonical payload with this key conflicts. Replay returns current safe state, never new mail or restored grants.',
    });
  const operation = {
    operationId: `${route.method.toLowerCase()}${route.path.replace(/[^A-Za-z0-9]/g, '_')}`,
    summary: `${route.method} ${route.path}`,
    description: `${policies[route.policy]} Cookie mutations require current synchronizer CSRF, exact Origin and Fetch Metadata. No arbitrary callback or browser service credentials. Route path IDs and discriminated command targets must agree. Runtime reference, grant-ceiling and transactional checks remain mandatory after structural validation.`,
    'x-implementation-status': implementedStructureRoutes.has(`${route.method} ${route.path}`)
      ? 'implemented; scoped writers release-gated; isolated verification; rollout pending'
      : route.path.startsWith('/api/invitations/')
        ? 'implemented (UM-I08); restricted recipient policy; isolated verification; rollout pending'
        : 'implemented (UM-I09); administration writers release-gated; isolated verification; rollout pending',
    ...(route.path.includes('/people/invitations')
      ? {
          'x-domain-implementation-status':
            'UM-I07 invitation lifecycle and durable mail; UM-I09 administration HTTP handlers implemented; public writers closed',
        }
      : {}),
    'x-authentication-policy': route.policy,
    'x-workspace-readiness-required': normal,
    'x-csrf-required': mutation && !credential,
    'x-origin-required': mutation,
    'x-same-actor-required': route.sameActor ?? false,
    'x-query-contract': route.query ?? 'PeopleEmpty',
    'x-body-limit-bytes': PEOPLE_LIMITS.bodyBytes,
    'x-response-limit-bytes': PEOPLE_LIMITS.responseBytes,
    'x-deadline-ms': PEOPLE_LIMITS.requestTimeoutMs,
    ...(normal
      ? {
          'x-deadline-enforcement':
            'Server response deadline and transaction connection cancellation; command readback reconciles uncertain commit',
          'x-release-gate':
            route.path === '/api/people/impact'
              ? 'authorized impact preview; no writer opening'
              : mutation
                ? 'public_writes_enabled'
                : 'read-only current authorized projection',
        }
      : {}),
    ...(route.operation ? { 'x-command-operation': route.operation } : {}),
    security,
    parameters,
    ...(route.request
      ? {
          requestBody: {
            required: true,
            content: content(route.request, peopleExamples, peopleNamedExamples),
          },
        }
      : {}),
    responses: {
      200: { $ref: `#/components/responses/${route.response}` },
      ...errorResponseRefs(PEOPLE_ERROR_STATUS, 'PeopleError'),
    },
  };
  if (
    route.method === 'POST' &&
    ['/api/people/roles', '/api/people/invitations', '/api/structure/units'].includes(route.path)
  )
    operation.responses[201] = response(
      route.response,
      peopleExamples,
      peopleNamedExamples,
      'First committed creation. A receipt replay returns 200 with current state.',
    );
  productPaths[route.path] ??= {};
  productPaths[route.path][route.method.toLowerCase()] = operation;
}
const product = {
  openapi: '3.1.0',
  info: {
    title: 'Turnstile 360 People and Scoped Access',
    version: PEOPLE_API_VERSION,
    description:
      'Executable user-management contracts. UM-I04 supplies canonical access consumers; UM-I05 implements scoped structure operations; UM-I08 implements restricted recipients; UM-I09 implements ordinary administration reads, impact, commands and current readback. Authority integration is implemented in UM-I06. Ordinary writers remain closed behind the coordinated release gate. This document does not deploy or open capabilities. Semantic Zod refinements, including normalization/applicability/versions, are normative beyond structural JSON Schema.',
  },
  servers: [{ url: '/' }],
  'x-implementation-status':
    'UM-I05 structure, UM-I08 recipient and UM-I09 administration operations implemented; ordinary feature writers gated',
  'x-existing-auth-contract': 'turnstile-auth.openapi.yaml',
  'x-access-aware-session-target': '#/components/schemas/AccessAwareUserSession',
  paths: productPaths,
  components: {
    responses: sharedResponses(
      PEOPLE_ROUTES,
      peopleExamples,
      peopleNamedExamples,
      PEOPLE_ERROR_STATUS,
      'PeopleError',
    ),
    securitySchemes: {
      ...installedAuth.components.securitySchemes,
      LocalInvitationContinuation: {
        type: 'apiKey',
        in: 'cookie',
        name: installedAuth.components.securitySchemes.LocalProductCookie.name,
        description: 'Explicit loopback-only development cookie policy; never used in production.',
      },
      InvitationContinuation: {
        type: 'apiKey',
        in: 'cookie',
        name: installedAuth.components.securitySchemes.ProductCookie.name,
        description:
          'Restricted purpose state uses the product session cookie transport but grants no ordinary session authority. Loopback development uses the explicit local product cookie policy.',
      },
    },
    schemas: {
      ...productSchemas,
      ...errorsByStatus(productSchemas.PeopleError, PEOPLE_ERROR_STATUS, 'PeopleError'),
    },
  },
};
const authoritySchemas = identityServiceJsonSchemas();
const authorityPaths = {};
for (const route of IDENTITY_SERVICE_ROUTES) {
  const service = route.policy.startsWith('service_');
  const receipt = route.policy === 'setup_receipt';
  const mutation = route.method === 'POST';
  const scope =
    route.policy === 'service_prepare' ? IDENTITY_SERVICE_SCOPES[0] : IDENTITY_SERVICE_SCOPES[1];
  const operation = {
    operationId: `${route.method.toLowerCase()}${route.path.replace(/[^A-Za-z0-9]/g, '_')}`,
    summary: `${route.method} ${route.path}`,
    description: service
      ? 'Private ingress only. Fixed registered installation/application and distinct confidential service client/audience; live client/scope checks. No login/DMS token, admin cookie, general directory query or credential-changing fields. The trusted owning product constructs bounded membership assertions after people authorization.'
      : 'Authority-owned receipt/continuation surface; exact Origin/Fetch Metadata on POST, synchronizer CSRF after exchange. Only this authority accepts the recipient password. New accounts remain ordinary and unverified; existing account collisions use generic guided sign-in/recovery without overwriting any credential/profile/ban. Fixed /sign-in callback.',
    'x-implementation-status': 'implemented; separate-process HTTP verified in UM-I06',
    'x-authentication-policy': route.policy,
    'x-private-ingress-only': service,
    'x-csrf-required': !service && !receipt && mutation,
    'x-origin-required': !service && mutation,
    ...(service ? { 'x-required-scope': scope } : {}),
    security: service
      ? [{ IdentityServiceOAuth: [scope] }]
      : receipt
        ? []
        : [
            { IdentitySetupContinuation: [], ...(mutation ? { CsrfToken: [] } : {}) },
            { LocalIdentitySetupContinuation: [], ...(mutation ? { CsrfToken: [] } : {}) },
          ],
    parameters: route.path.includes('{id}')
      ? [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: authoritySchemas.IdentityPreparationPath.properties.id,
          },
        ]
      : [],
    ...(route.request
      ? { requestBody: { required: true, content: content(route.request, identityExamples) } }
      : {}),
    responses: {
      200: { $ref: `#/components/responses/${route.response}` },
      ...errorResponseRefs(IDENTITY_SERVICE_ERROR_STATUS, 'IdentityServiceError'),
    },
  };
  authorityPaths[route.path] ??= {};
  authorityPaths[route.path][route.method.toLowerCase()] = operation;
}
const authority = {
  openapi: '3.1.0',
  info: {
    title: 'Thaarei Narrow Invitation Identity Service',
    version: PEOPLE_API_VERSION,
    description:
      'Authority-owned service and setup handlers implemented in UM-I06. Product invitation lifecycle, restricted acceptance and browser invitation resume are implemented in UM-I07/I08. Existing public signup remains disabled. All example credentials are synthetic and grant no authority.',
  },
  servers: [{ url: '/' }],
  'x-implementation-status':
    'implemented (UM-I06); product lifecycle and restricted acceptance composed in UM-I07/I08; installation rollout pending',
  'x-client-purpose': IDENTITY_SERVICE_CLIENT_PURPOSE,
  'x-resource-audience': `AUTH_PUBLIC_ORIGIN + ${IDENTITY_SERVICE_AUDIENCE_PATH}`,
  paths: authorityPaths,
  components: {
    responses: sharedResponses(
      IDENTITY_SERVICE_ROUTES,
      identityExamples,
      {},
      IDENTITY_SERVICE_ERROR_STATUS,
      'IdentityServiceError',
    ),
    securitySchemes: {
      IdentityServiceOAuth: {
        type: 'oauth2',
        flows: {
          clientCredentials: {
            tokenUrl: '/identity/oauth2/token',
            scopes: {
              [IDENTITY_SERVICE_SCOPES[0]]: 'Prepare a generation-bound recipient setup receipt',
              [IDENTITY_SERVICE_SCOPES[1]]: 'Project explicitly product-linked subjects only',
            },
          },
        },
        description: `Separate private confidential client, client_credentials only, fixed installation/application, exact audience AUTH_PUBLIC_ORIGIN + ${IDENTITY_SERVICE_AUDIENCE_PATH}; no DMS/login trust.`,
      },
      LocalIdentitySetupContinuation: {
        type: 'apiKey',
        in: 'cookie',
        name: 'identity-setup',
        description: 'Explicit loopback-only development cookie policy; never used in production.',
      },
      IdentitySetupContinuation: {
        type: 'apiKey',
        in: 'cookie',
        name: '__Host-identity-setup',
        description:
          'Authority-owned HttpOnly purpose continuation; never the service client secret.',
      },
      CsrfToken: installedAuth.components.securitySchemes.CsrfToken,
    },
    schemas: {
      ...authoritySchemas,
      ...errorsByStatus(
        authoritySchemas.IdentityServiceError,
        IDENTITY_SERVICE_ERROR_STATUS,
        'IdentityServiceError',
      ),
    },
  },
};
for (const [destination, document] of [
  ['docs/api/turnstile-people.openapi.json', product],
  ['docs/api/identity-invitations.openapi.json', authority],
]) {
  assertReferences(document);
  const formatted = spawnSync(
    'pnpm',
    ['exec', 'biome', 'format', `--stdin-file-path=${destination}`],
    { input: JSON.stringify(document), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  assert.equal(formatted.status, 0, `Formatting failed: ${formatted.stderr}`);
  if (process.argv.includes('--check'))
    assert.equal(readFileSync(destination, 'utf8'), formatted.stdout, `Regenerate ${destination}`);
  else writeFileSync(destination, formatted.stdout);
  console.log(
    `${process.argv.includes('--check') ? 'Verified' : 'Generated'} ${destination}: executable schemas, examples, policy and local references.`,
  );
}
