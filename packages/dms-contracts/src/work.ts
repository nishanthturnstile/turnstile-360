import { z } from 'zod';
import {
  EXTRACTION_FORMATS,
  EXTRACTION_LIMITS,
  extractionArtifactSchema,
  extractionManifestSchema,
  extractionRequestSchema,
} from './extraction.js';
import { servicePresenceSchema } from './operations.js';

export const WORK_ROLES = ['publisher', 'scanner', 'extractor', 'heavy'] as const;
export const WORK_SCOPES = [
  'dms:work:publish',
  'dms:work:scan',
  'dms:work:extract',
  'dms:work:heavy',
] as const;
export const WORK_TASKS = ['document.scan', 'document.extract', 'document.heavy'] as const;
export const WORK_ROLE_SCOPE = {
  publisher: WORK_SCOPES[0],
  scanner: WORK_SCOPES[1],
  extractor: WORK_SCOPES[2],
  heavy: WORK_SCOPES[3],
} as const;
export const WORK_TASK_ROLE = {
  'document.scan': 'scanner',
  'document.extract': 'extractor',
  'document.heavy': 'heavy',
} as const;
export const WORK_LIMITS = {
  executions: 3,
  executionSeconds: 1800,
  attemptSeconds: 600,
  leaseSeconds: 90,
  recoveryGraceSeconds: 30,
  retryRecoveryGraceSeconds: 90,
  deliverySeconds: 600,
  dispatchLeaseSeconds: 30,
  recoveries: 3,
  batch: 10,
} as const;
export const workEnvelopeSchema = z
  .object({
    version: z.literal(1),
    jobId: z.uuid(),
    dispatchId: z.uuid(),
    generation: z.number().int().min(1).max(2147483647),
    task: z.enum(WORK_TASKS),
  })
  .strict();
export const workLeaseSchema = workEnvelopeSchema
  .extend({ attemptId: z.uuid(), leaseToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
export const assessmentEvidenceSchema = z
  .object({
    candidateId: z.uuid(),
    outcome: z.enum(['PASSED', 'REJECTED', 'INCONCLUSIVE']),
    code: z.enum([
      'OK',
      'MALWARE',
      'HASH_MISMATCH',
      'SIZE_MISMATCH',
      'TYPE_MISMATCH',
      'INVALID_TEXT',
      'UNSUPPORTED_FORMAT',
      'SCANNER_UNAVAILABLE',
      'SIGNATURE_STALE',
      'SANDBOX_UNAVAILABLE',
      'LIMIT_EXCEEDED',
    ]),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().min(1).max(52428800),
    contentType: z.enum(Object.keys(EXTRACTION_FORMATS) as [string, ...string[]]),
    policy: z.enum(['utf8-text-v1', 'format-security-v1']),
    engine: z.string().regex(/^[A-Za-z0-9 ._/-]{1,120}$/),
    signatures: z.string().regex(/^[0-9]{1,20}$/),
    signatureTime: z.iso.datetime(),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
    complete: z.boolean(),
    isolated: z.boolean(),
  })
  .strict();
export type AssessmentEvidence = z.infer<typeof assessmentEvidenceSchema>;
export const workResultSchema = z.discriminatedUnion('outcome', [
  workLeaseSchema
    .extend({
      outcome: z.literal('SUCCEEDED'),
      code: z.literal('OK'),
      assessment: assessmentEvidenceSchema.optional(),
      extraction: z
        .object({ artifactId: z.uuid(), manifest: extractionManifestSchema })
        .strict()
        .optional(),
    })
    .strict(),
  workLeaseSchema
    .extend({ outcome: z.literal('FAILED'), code: z.literal('EXECUTION_FAILED') })
    .strict(),
  workLeaseSchema
    .extend({ outcome: z.literal('UNSUPPORTED'), code: z.literal('HANDLER_NOT_INSTALLED') })
    .strict(),
  workLeaseSchema.extend({ outcome: z.literal('RETRY'), code: z.literal('TRANSIENT_IO') }).strict(),
]);
export const workClaimResponseSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('claimed'),
      lease: workLeaseSchema,
      leaseExpiresAt: z.iso.datetime(),
      attemptDeadline: z.iso.datetime(),
      remainingExecutions: z.number().int().min(0).max(2),
    })
    .strict(),
  z.object({ state: z.enum(['busy', 'stale', 'terminal']) }).strict(),
  z
    .object({ state: z.literal('wait'), retryAfterSeconds: z.number().int().min(1).max(60) })
    .strict(),
]);
export const workResultResponseSchema = z
  .object({
    accepted: z.literal(true),
    duplicate: z.boolean(),
    retryAfterSeconds: z.number().int().min(1).max(60).nullable(),
  })
  .strict();
export const deliveryLeaseSchema = z
  .object({ dispatch: workEnvelopeSchema, deliveryToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
export const deliveryReceiptSchema = z
  .object({ dispatchId: z.uuid(), deliveryToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
export const deliveryFailureSchema = deliveryReceiptSchema
  .extend({ code: z.enum(['UNROUTABLE', 'BROKER_UNAVAILABLE']) })
  .strict();
export const WORK_PRIVATE_ROUTES = [
  {
    method: 'POST',
    path: '/internal/work/presence',
    role: 'task-owner',
    request: 'Presence',
    response: 'PresenceReceipt',
  },
  {
    method: 'POST',
    path: '/internal/work/attempts/extraction-input',
    role: 'task-owner',
    request: 'Lease',
    response: 'ExtractionInput',
  },
  {
    method: 'POST',
    path: '/internal/work/attempts/extraction-output',
    role: 'task-owner',
    request: 'ExtractionOutputRequest',
    response: 'ExtractionOutput',
  },
  {
    method: 'POST',
    path: '/internal/work/attempts/candidate',
    role: 'scanner',
    request: 'Lease',
    response: 'Candidate',
  },
  {
    method: 'POST',
    path: '/internal/work/dispatches/claim',
    role: 'publisher',
    request: 'Empty',
    response: 'Deliveries',
  },
  {
    method: 'POST',
    path: '/internal/work/dispatches/delivered',
    role: 'publisher',
    request: 'DeliveryReceipt',
    response: 'Acknowledged',
  },
  {
    method: 'POST',
    path: '/internal/work/dispatches/failed',
    role: 'publisher',
    request: 'DeliveryFailure',
    response: 'Acknowledged',
  },
  {
    method: 'POST',
    path: '/internal/work/attempts/claim',
    role: 'task-owner',
    request: 'Envelope',
    response: 'Claim',
  },
  {
    method: 'POST',
    path: '/internal/work/attempts/heartbeat',
    role: 'task-owner',
    request: 'Lease',
    response: 'Heartbeat',
  },
  {
    method: 'POST',
    path: '/internal/work/attempts/result',
    role: 'task-owner',
    request: 'Result',
    response: 'ResultReceipt',
  },
] as const;
export const workSchemas = {
  Presence: servicePresenceSchema,
  PresenceReceipt: z.object({ accepted: z.literal(true) }).strict(),
  ExtractionInput: z
    .object({
      request: extractionRequestSchema,
      deadline: z.iso.datetime().optional(),
      url: z.url(),
      size: z.number().int().positive().max(52428800),
    })
    .strict(),
  ExtractionOutputRequest: workLeaseSchema
    .extend({
      size: z.number().int().positive().max(26214400),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  ExtractionOutput: z
    .object({
      artifactId: z.uuid(),
      url: z.url(),
      size: z.number().int().positive().max(26214400),
      headers: z
        .object({ 'content-type': z.literal('application/json'), 'if-none-match': z.literal('*') })
        .strict(),
    })
    .strict(),
  ExtractionRequest: extractionRequestSchema,
  ExtractionManifest: extractionManifestSchema,
  ExtractionArtifact: extractionArtifactSchema,
  Assessment: assessmentEvidenceSchema,
  Candidate: z
    .object({
      candidateId: z.uuid(),
      url: z.url(),
      size: z.number().int().positive().max(52428800),
      contentType: z.string().max(100),
      sha256: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .nullable(),
    })
    .strict(),
  Job: z
    .object({
      version: z.literal(1),
      id: z.uuid(),
      uploadId: z.uuid(),
      applicationId: z.uuid(),
      task: z.enum(WORK_TASKS),
      state: z.enum([
        'QUEUED',
        'RUNNING',
        'RETRY_WAIT',
        'SUCCEEDED',
        'FAILED',
        'UNSUPPORTED',
        'CANCELLED',
      ]),
      generation: z.number().int().positive(),
      executions: z.number().int().min(0).max(3),
      recoveries: z.number().int().min(0).max(3),
      createdAt: z.iso.datetime(),
      budgetStartedAt: z.iso.datetime().nullable(),
      deadline: z.iso.datetime().nullable(),
      nextEligibleAt: z.iso.datetime().nullable(),
      recoverAt: z.iso.datetime().nullable(),
      resultCode: z.string().max(64).nullable(),
    })
    .strict(),
  Envelope: workEnvelopeSchema,
  Lease: workLeaseSchema,
  Result: workResultSchema,
  Claim: workClaimResponseSchema,
  ResultReceipt: workResultResponseSchema,
  DeliveryReceipt: deliveryReceiptSchema,
  DeliveryFailure: deliveryFailureSchema,
  Deliveries: z.object({ items: z.array(deliveryLeaseSchema).max(10) }).strict(),
  Empty: z.object({}).strict(),
  Acknowledged: z.object({ accepted: z.literal(true) }).strict(),
  Heartbeat: z.object({ leaseExpiresAt: z.iso.datetime() }).strict(),
};
export const workJsonSchemas = Object.fromEntries(
  Object.entries(workSchemas).map(([name, schema]) => [name, z.toJSONSchema(schema)]),
);
export type WorkEnvelope = z.infer<typeof workEnvelopeSchema>;
export type WorkLease = z.infer<typeof workLeaseSchema>;
export type WorkResult = z.infer<typeof workResultSchema>;
export type WorkRole = (typeof WORK_ROLES)[number];
export type WorkTask = (typeof WORK_TASKS)[number];

export {
  extractionTask,
  OCR_FORMATS,
  OCR_RUNTIME,
  ocrProvenanceSchema,
  STRUCTURE_RUNTIME,
} from './extraction.js';
export { EXTRACTION_FORMATS, EXTRACTION_LIMITS };
