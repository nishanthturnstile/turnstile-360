import { DMS_ERROR_STATUS, DMS_PUBLIC_ROUTES, dmsPublicJsonSchemas } from './public.js';

const applicationId = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';
export const dmsPublicExamples = {
  AuditEvent: {
    id: applicationId,
    applicationId,
    resourceType: 'application',
    resourceId: applicationId,
    action: 'application.enrolled',
    actor: { kind: 'machine', id: 'independent-backend' },
    assertedHuman: null,
    requestId: applicationId,
    createdAt: '2026-11-05T12:00:00Z',
  },
  AuditPage: { items: [], nextCursor: null },
  AuditQuery: { limit: '50' },
  ServiceInfo: { name: 'Thaarei DMS API' },
  EnrollmentRequest: { name: 'Independent backend' },
  EnrollmentResponse: {
    applicationId,
    tenantId,
    status: 'active',
    receiptId: '33333333-3333-4333-8333-333333333333',
    replayUntil: '2026-11-05T12:00:00Z',
  },
  CapabilitiesResponse: {
    contractVersion: 1,
    applicationId,
    tenantId,
    operations: ['application-enrollment', 'capabilities:read'],
    formats: [],
    profiles: [],
    languages: [],
    limits: { accessTokenSeconds: 300, idempotencyWindowSeconds: 86400 },
  },
  DmsError: { code: 'MACHINE_TOKEN_REQUIRED', requestId: applicationId, retryable: false },
  IdempotencyKey: applicationId,
  ResourceETag: '"1"',
  RetryAfterSeconds: 2,
  RequestId: applicationId,
};
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const commonHeaders = {
  'X-Request-Id': {
    description: 'Server-generated UUID; untrusted caller IDs are not reflected.',
    schema: ref('RequestId'),
    example: applicationId,
  },
  'Cache-Control': {
    description: 'Sensitive control responses are never cached.',
    schema: { type: 'string', const: 'private, no-store' },
    example: 'private, no-store',
  },
};
const retryHeader = {
  description:
    'Seconds before retry. Present on temporary unavailability and ENROLLMENT_IN_PROGRESS; other conflicts are not automatically retryable.',
  schema: ref('RetryAfterSeconds'),
  example: 1,
};

export const dmsPublicOpenApi = {
  openapi: '3.1.0',
  jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
  info: {
    title: 'Thaarei DMS consumer API',
    version: '1.2.0',
    description:
      'Implemented consumer control routes only. Obtain short-lived machine tokens outside the browser. Identity sessions do not authorize DMS calls. Enrollment is CLI/backend-only; no document or processing feature is advertised before implementation.',
  },
  servers: [{ url: '/' }],
  paths: Object.fromEntries(
    DMS_PUBLIC_ROUTES.map((route) => [
      route.path,
      {
        [route.method.toLowerCase()]: {
          operationId: route.operationId,
          summary:
            route.operationId === 'getDmsServiceInfo'
              ? 'Read service identity'
              : route.operationId === 'getDmsAudit'
                ? 'Read own application audit'
                : route.policy === 'enrollment'
                  ? 'Enroll a privately registered consumer (CLI/backend only)'
                  : 'Read implemented capabilities',
          'x-dms-policy': route.policy,
          'x-required-scopes': route.scopes,
          'x-browser-execution': route.policy !== 'enrollment',
          description:
            route.policy === 'public'
              ? 'Unauthenticated service identity only; no registration or scope is required. This endpoint does not claim dependency readiness.'
              : route.policy === 'enrollment'
                ? 'Same Idempotency-Key and body replay the same receipt for 24 hours, after reauthorization. Different bodies conflict. Concurrent work returns ENROLLMENT_IN_PROGRESS with Retry-After: 1. A private enrollment key is required only here. Do not enter it in Swagger.'
                : 'Authorization always uses current registration and scope policy. Cookies and explorer access credentials grant no machine access.',
          security:
            route.policy === 'public'
              ? []
              : route.policy === 'enrollment'
                ? [{ MachineBearer: [], EnrollmentKey: [] }]
                : [{ MachineBearer: [] }],
          ...('request' in route
            ? {
                parameters: [
                  {
                    in: 'header',
                    name: 'Idempotency-Key',
                    required: true,
                    schema: ref('IdempotencyKey'),
                    example: applicationId,
                  },
                ],
                requestBody: {
                  required: true,
                  content: {
                    'application/json': {
                      schema: ref(route.request),
                      example: dmsPublicExamples[route.request],
                    },
                  },
                },
              }
            : {}),
          ...(route.operationId === 'getDmsAudit'
            ? {
                parameters: [
                  {
                    in: 'query',
                    name: 'limit',
                    required: false,
                    schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
                  },
                  {
                    in: 'query',
                    name: 'cursor',
                    required: false,
                    schema: { type: 'string', maxLength: 2048 },
                    description:
                      'Opaque signed keyset cursor, bound to current tenant/principal/filter; every page reauthorizes.',
                  },
                ],
              }
            : {}),
          responses: Object.fromEntries(
            route.statuses.map((status) => {
              const success = status < 300;
              const code = Object.entries(DMS_ERROR_STATUS).find(([, statuses]) =>
                (statuses as readonly number[]).includes(status),
              )?.[0];
              return [
                status,
                {
                  description: success
                    ? route.policy === 'public'
                      ? 'Service identity; available independently of consumer registration.'
                      : route.operationId === 'getDmsAudit'
                        ? 'Bounded owner-only application audit page; no document resources exist yet.'
                        : route.policy === 'machine'
                          ? 'Implemented capabilities and verified application context for the active consumer.'
                          : status === 201
                            ? 'Enrollment activation and receipt committed atomically.'
                            : 'Authenticated identical enrollment replay; no reactivation of a disabled consumer.'
                    : `Controlled DMS error (${status}). See the finite DmsError codes and retryable flag.`,
                  headers: {
                    ...commonHeaders,
                    ...(status === 401
                      ? {
                          'WWW-Authenticate': {
                            schema: { type: 'string', const: 'Bearer realm="dms"' },
                          },
                        }
                      : {}),
                    ...(status === 503 || status === 409 ? { 'Retry-After': retryHeader } : {}),
                  },
                  content: {
                    'application/json': {
                      schema: ref(success ? route.response : 'DmsError'),
                      example: success
                        ? dmsPublicExamples[route.response]
                        : { code, requestId: applicationId, retryable: status === 503 },
                    },
                  },
                },
              ];
            }),
          ),
        },
      },
    ]),
  ),
  components: {
    securitySchemes: {
      MachineBearer: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'RS256 at+jwt',
        description:
          'Backend client-credentials token for the exact DMS audience, lasting at most 300 seconds. Never enter a machine client secret here.',
      },
      EnrollmentKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Thaarei-Enrollment-Key',
        description:
          'Private CLI/backend enrollment only. Browser execution is disabled for enrollment.',
      },
    },
    schemas: dmsPublicJsonSchemas,
    headers: {
      ResourceETag: {
        description:
          'Future resource revisions use strong quoted positive decimal ETags. No current route emits one.',
        schema: ref('ResourceETag'),
      },
      RetryAfter: retryHeader,
      OperationLocation: {
        description:
          'Future 202 operations provide a same-origin status URL and Retry-After. No asynchronous operation is currently implemented.',
        schema: { type: 'string', format: 'uri-reference' },
      },
    },
  },
};
