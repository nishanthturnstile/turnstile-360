import { z } from 'zod';

// Extend this ceiling only alongside the capability that implements the scope.
export const DMS_MACHINE_SCOPES = ['dms:capabilities:read', 'dms:audit:read'] as const;
export type DmsMachineScope = (typeof DMS_MACHINE_SCOPES)[number];

export const enrollmentRequestSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[\p{L}\p{N} ._'()-]+$/u),
  })
  .strict();
export const enrollmentResponseSchema = z
  .object({
    applicationId: z.uuid(),
    tenantId: z.uuid(),
    status: z.literal('active'),
    receiptId: z.uuid(),
    replayUntil: z.iso.datetime(),
  })
  .strict();
export type EnrollmentRequest = z.infer<typeof enrollmentRequestSchema>;
export type EnrollmentResponse = z.infer<typeof enrollmentResponseSchema>;
export const capabilitiesResponseSchema = z
  .object({
    contractVersion: z.literal(1),
    applicationId: z.uuid(),
    tenantId: z.uuid(),
    operations: z.array(z.enum(['application-enrollment', 'capabilities:read', 'audit:read'])),
    formats: z.array(z.never()),
    profiles: z.array(z.never()),
    languages: z.array(z.never()),
    limits: z
      .object({ accessTokenSeconds: z.literal(300), idempotencyWindowSeconds: z.literal(86400) })
      .strict(),
  })
  .strict();
export const dmsErrorSchema = z
  .object({
    code: z.enum([
      'INVALID_REQUEST',
      'MACHINE_TOKEN_REQUIRED',
      'INVALID_MACHINE_TOKEN',
      'MACHINE_TOKEN_EXPIRED',
      'APPLICATION_DENIED',
      'SCOPE_DENIED',
      'OPERATION_DENIED',
      'TENANT_INPUT_REJECTED',
      'ENROLLMENT_KEY_INVALID',
      'ENROLLMENT_KEY_EXPIRED',
      'ENROLLMENT_KEY_REVOKED',
      'ENROLLMENT_KEY_USED',
      'ENROLLMENT_NAME_MISMATCH',
      'IDEMPOTENCY_CONFLICT',
      'REPLAY_WINDOW_EXPIRED',
      'ENROLLMENT_IN_PROGRESS',
      'DMS_UNAVAILABLE',
    ]),
    requestId: z.string(),
    retryable: z.boolean(),
  })
  .strict();
export type DmsErrorCode = z.infer<typeof dmsErrorSchema>['code'];
export type CapabilitiesResponse = z.infer<typeof capabilitiesResponseSchema>;

// Application-asserted human context is attribution only, never a DMS identity.
export const assertedHumanSchema = z
  .object({
    source: z.literal('application-asserted'),
    subject: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_.:@-]+$/),
  })
  .strict();
export const auditEventSchema = z
  .object({
    id: z.uuid(),
    applicationId: z.uuid(),
    resourceType: z.literal('application'),
    resourceId: z.uuid(),
    action: z.literal('application.enrolled'),
    actor: z.object({ kind: z.literal('machine'), id: z.string().min(1).max(200) }).strict(),
    assertedHuman: assertedHumanSchema.nullable(),
    requestId: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const auditPageSchema = z
  .object({
    items: z.array(auditEventSchema).max(100),
    nextCursor: z.string().max(2048).nullable(),
  })
  .strict();
export const auditQuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^(?:[1-9]|[1-9][0-9]|100)$/)
      .optional(),
    cursor: z
      .string()
      .min(1)
      .max(2048)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict();
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type AuditPage = z.infer<typeof auditPageSchema>;

export const dmsAuthJsonSchemas = {
  EnrollmentRequest: z.toJSONSchema(enrollmentRequestSchema),
  EnrollmentResponse: z.toJSONSchema(enrollmentResponseSchema),
  CapabilitiesResponse: z.toJSONSchema(capabilitiesResponseSchema),
  DmsError: z.toJSONSchema(dmsErrorSchema),
};

// Conventions for control routes. Future owning features implement revision/polling
// behavior when their resources ship; these schemas do not create feature endpoints.
export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
export const resourceEtagSchema = z.string().regex(/^"[1-9][0-9]{0,18}"$/);
export const retryAfterSecondsSchema = z.number().int().min(1).max(3600);
export const requestIdSchema = z.uuid();
export const serviceInfoSchema = z.object({ name: z.literal('Thaarei DMS API') }).strict();
export const DMS_HTTP_CONVENTIONS = {
  idempotencyWindowSeconds: 86400,
  initialPollSeconds: 2,
  maxRetryAfterSeconds: 3600,
  revisionHeader: 'ETag',
  revisionPrecondition: 'If-Match',
  asynchronousHeaders: ['Location', 'Retry-After'],
} as const;

export const DMS_ERROR_STATUS = {
  INVALID_REQUEST: [400, 404, 405, 413, 415],
  MACHINE_TOKEN_REQUIRED: [401],
  INVALID_MACHINE_TOKEN: [401],
  MACHINE_TOKEN_EXPIRED: [401],
  APPLICATION_DENIED: [403],
  SCOPE_DENIED: [403],
  OPERATION_DENIED: [403],
  TENANT_INPUT_REJECTED: [400],
  ENROLLMENT_KEY_INVALID: [403],
  ENROLLMENT_KEY_EXPIRED: [410],
  ENROLLMENT_KEY_REVOKED: [403],
  ENROLLMENT_KEY_USED: [403],
  ENROLLMENT_NAME_MISMATCH: [400],
  IDEMPOTENCY_CONFLICT: [409],
  REPLAY_WINDOW_EXPIRED: [410],
  ENROLLMENT_IN_PROGRESS: [409],
  DMS_UNAVAILABLE: [503],
} as const satisfies Record<DmsErrorCode, readonly number[]>;

export const dmsPublicSchemas = {
  EnrollmentRequest: enrollmentRequestSchema,
  EnrollmentResponse: enrollmentResponseSchema,
  CapabilitiesResponse: capabilitiesResponseSchema,
  DmsError: dmsErrorSchema,
  ServiceInfo: serviceInfoSchema,
  IdempotencyKey: idempotencyKeySchema,
  ResourceETag: resourceEtagSchema,
  RetryAfterSeconds: retryAfterSecondsSchema,
  RequestId: requestIdSchema,
  AuditEvent: auditEventSchema,
  AuditPage: auditPageSchema,
  AuditQuery: auditQuerySchema,
};
export const dmsPublicJsonSchemas = Object.fromEntries(
  Object.entries(dmsPublicSchemas).map(([name, schema]) => [name, z.toJSONSchema(schema)]),
);

export const DMS_PUBLIC_ROUTES = [
  {
    method: 'GET',
    path: '/v1/audit',
    operationId: 'getDmsAudit',
    policy: 'machine',
    scopes: ['dms:audit:read'],
    response: 'AuditPage',
    statuses: [200, 400, 401, 403, 503],
  },
  {
    method: 'GET',
    path: '/v1',
    operationId: 'getDmsServiceInfo',
    policy: 'public',
    scopes: [],
    response: 'ServiceInfo',
    statuses: [200],
  },
  {
    method: 'GET',
    path: '/v1/capabilities',
    operationId: 'getDmsCapabilities',
    policy: 'machine',
    scopes: ['dms:capabilities:read'],
    response: 'CapabilitiesResponse',
    statuses: [200, 400, 401, 403, 503],
  },
  {
    method: 'POST',
    path: '/v1/application-enrollments',
    operationId: 'enrollDmsApplication',
    policy: 'enrollment',
    scopes: [],
    request: 'EnrollmentRequest',
    response: 'EnrollmentResponse',
    statuses: [200, 201, 400, 401, 403, 409, 410, 413, 415, 503],
  },
] as const;
export type DmsOperationId = (typeof DMS_PUBLIC_ROUTES)[number]['operationId'];
