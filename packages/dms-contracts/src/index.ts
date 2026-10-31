import { z } from 'zod';

// Extend this ceiling only alongside the capability that implements the scope.
export const DMS_MACHINE_SCOPES = ['dms:capabilities:read'] as const;
export type DmsMachineScope = (typeof DMS_MACHINE_SCOPES)[number];

export const DMS_PRINCIPAL_KINDS = ['consumer', 'publisher', 'scanner', 'extractor'] as const;
export type DmsPrincipalKind = (typeof DMS_PRINCIPAL_KINDS)[number];
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
    operations: z.array(z.enum(['application-enrollment', 'capabilities:read'])),
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

export const dmsAuthJsonSchemas = {
  EnrollmentRequest: z.toJSONSchema(enrollmentRequestSchema),
  EnrollmentResponse: z.toJSONSchema(enrollmentResponseSchema),
  CapabilitiesResponse: z.toJSONSchema(capabilitiesResponseSchema),
  DmsError: z.toJSONSchema(dmsErrorSchema),
};
