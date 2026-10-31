import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dmsAuthJsonSchemas } from '../packages/dms-contracts/dist/index.js';

const error = (description) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/DmsError' } } },
});
const response = (schema, description) => ({
  description,
  content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } },
});
const spec = {
  openapi: '3.1.0',
  info: {
    title: 'Thaarei DMS machine authentication and enrollment',
    version: '1.0.0',
    description:
      'Backend machine credentials only. Local registration is authoritative; identity sessions do not grant DMS access. Document/upload/processing capabilities are not implemented.',
  },
  servers: [{ url: '/v1' }],
  security: [{ MachineBearer: [] }],
  paths: {
    '/capabilities': {
      get: {
        operationId: 'getDmsCapabilities',
        summary: 'Read implemented capabilities for the current active consumer',
        description:
          'Requires dms:capabilities:read in the verified token and current local ceiling. No format, extraction or business capability is advertised before implementation.',
        responses: {
          200: response(
            'CapabilitiesResponse',
            'Current verified application context and supported operations',
          ),
          400: error('Caller-supplied tenant/application selectors are rejected'),
          401: error('Missing/invalid machine access JWT'),
          403: error(
            'Registration inactive, unsupported principal category, insufficient scope or operation denied',
          ),
          503: error('Verification keys or persistence unavailable'),
        },
      },
    },
    '/application-enrollments': {
      post: {
        operationId: 'enrollDmsApplication',
        summary: 'Activate one bound pending consumer',
        description:
          'Requires a provisioned machine token, matching enrollment key and Idempotency-Key. The body name must match the operator-approved registration. Identical authenticated retries return the same nonsecret receipt within 24 hours; replay rechecks local state/scopes and explicit key revocation. Tenant/application selectors are never authority. Concurrent work returns retryable conflict. No secrets appear in the response.',
        security: [{ MachineBearer: [], EnrollmentKey: [] }],
        parameters: [
          {
            in: 'header',
            name: 'Idempotency-Key',
            required: true,
            schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{16,128}$' },
            example: 'e937818d-c78a-48c0-b747-e083f7468b30',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/EnrollmentRequest' },
              example: { name: 'Turnstile 360' },
            },
          },
        },
        responses: {
          201: response(
            'EnrollmentResponse',
            'Key consumption, activation, receipt and audit committed atomically',
          ),
          200: response('EnrollmentResponse', 'Authenticated identical replay; no reactivation'),
          400: error('Invalid input, tenant selector or registration name mismatch'),
          401: error('Missing/invalid machine access JWT'),
          403: error(
            'Invalid/revoked/used key, wrong binding, disabled application, principal category or scope',
          ),
          409: {
            ...error('IDEMPOTENCY_CONFLICT or retryable ENROLLMENT_IN_PROGRESS'),
            headers: {
              'Retry-After': {
                description: 'One second for ENROLLMENT_IN_PROGRESS',
                schema: { type: 'integer', const: 1 },
              },
            },
          },
          410: error('Unused key expired or receipt replay window expired'),
          503: error('Verification keys, persistence or mandatory audit unavailable'),
        },
      },
    },
  },
  components: {
    securitySchemes: {
      MachineBearer: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'RS256 at+jwt',
        description:
          'Client-credentials JWT; exact configured issuer/DMS audience, client_id=sub, maximum five-minute lifetime. Cookies, ID/user tokens, opaque tokens and DPoP are unsupported.',
      },
      EnrollmentKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Thaarei-Enrollment-Key',
        description:
          'High-entropy bound one-time secret from the private issuance file. Never place in browser code or URLs; not required on ordinary requests.',
      },
    },
    schemas: dmsAuthJsonSchemas,
  },
};
const destination = 'docs/api/dms-auth.openapi.json';
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
    'Regenerate the DMS authentication contract',
  );
  console.log('DMS auth OpenAPI matches shared request/response schemas.');
} else {
  writeFileSync(destination, formatted.stdout);
  console.log(`Generated ${destination} from shared contracts.`);
}
