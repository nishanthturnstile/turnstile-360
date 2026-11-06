import { z } from 'zod';
import { uploadAdmissionRequestSchema } from './registry.js';

export const uploadBeginSchema = uploadAdmissionRequestSchema.omit({
  documentId: true,
  expectedRevision: true,
});
export const emptyCommandSchema = z.object({}).strict();
export const uploadStatusSchema = z
  .object({
    id: z.uuid(),
    documentId: z.uuid(),
    versionId: z.uuid(),
    upload: z.enum(['INITIATED', 'OBJECT_VERIFIED', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'FAILED']),
    security: z.enum(['PENDING', 'PASSED', 'REJECTED', 'INCONCLUSIVE', 'INVALIDATED']),
    availability: z.enum(['CANDIDATE', 'AVAILABLE', 'UNAVAILABLE']),
    processing: z.enum([
      'NOT_SCHEDULED',
      'WAITING_FOR_SECURITY',
      'QUEUED',
      'RUNNING',
      'SUCCEEDED',
      'PARTIAL',
      'FAILED',
      'UNSUPPORTED',
      'CANCELLED',
    ]),
    completionRequested: z.boolean(),
    expiresAt: z.iso.datetime(),
    replayUntil: z.iso.datetime(),
    size: z.number().int().positive().max(52428800),
    contentType: z.string().max(100),
    failure: z
      .enum([
        'SESSION_EXPIRED',
        'CANCELLED',
        'SIZE_MISMATCH',
        'CONTENT_TYPE_MISMATCH',
        'SECURITY_ASSESSMENT_FAILED',
      ])
      .nullable(),
    retryAfterSeconds: z.literal(2).nullable(),
  })
  .strict();
export const transferCapabilitySchema = z
  .object({
    url: z.url(),
    method: z.literal('PUT'),
    headers: z.object({ 'content-type': z.string(), 'if-none-match': z.literal('*') }).strict(),
    size: z.number().int().positive().max(52428800),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export const uploadResponseSchema = z
  .object({
    operationId: z.uuid(),
    session: uploadStatusSchema,
    transfer: transferCapabilitySchema.nullable(),
  })
  .strict();
const descriptor = uploadAdmissionRequestSchema.omit({ batchId: true, itemId: true });
export const batchItemInputSchema = z
  .object({
    itemId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    operation: z.enum(['create', 'new-version']),
    descriptor,
  })
  .strict();
export const batchCreateSchema = z
  .object({ items: z.array(batchItemInputSchema).min(1).max(100) })
  .strict();
export const batchItemStatusSchema = z
  .object({
    itemId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    operation: z.enum(['create', 'new-version']),
    fileName: z.string().max(255),
    state: z.enum(['UNSTARTED', 'BOUND', 'CLOSED', 'CANCELLED', 'EXPIRED']),
    session: uploadStatusSchema.nullable(),
    admissionError: z
      .enum([
        'POLICY_DENIED',
        'CAPACITY_EXCEEDED',
        'CAPACITY_UNAVAILABLE',
        'OPERATION_DENIED',
        'REVISION_CONFLICT',
      ])
      .nullable(),
    retryAfterSeconds: z.literal(2).nullable(),
  })
  .strict();
export const batchStatusSchema = z
  .object({
    id: z.uuid(),
    state: z.enum(['OPEN', 'CLOSED', 'CANCELLED', 'EXPIRED']),
    expiresAt: z.iso.datetime(),
    total: z.number().int().min(1).max(100),
    counts: z
      .object({
        items: z
          .object({
            UNSTARTED: z.number().int().nonnegative(),
            BOUND: z.number().int().nonnegative(),
            CLOSED: z.number().int().nonnegative(),
            CANCELLED: z.number().int().nonnegative(),
            EXPIRED: z.number().int().nonnegative(),
          })
          .strict(),
        upload: z
          .object({
            INITIATED: z.number().int().nonnegative(),
            OBJECT_VERIFIED: z.number().int().nonnegative(),
            COMPLETED: z.number().int().nonnegative(),
            EXPIRED: z.number().int().nonnegative(),
            CANCELLED: z.number().int().nonnegative(),
            FAILED: z.number().int().nonnegative(),
          })
          .strict(),
        security: z
          .object({
            PENDING: z.number().int().nonnegative(),
            PASSED: z.number().int().nonnegative(),
            REJECTED: z.number().int().nonnegative(),
            INCONCLUSIVE: z.number().int().nonnegative(),
            INVALIDATED: z.number().int().nonnegative(),
          })
          .strict(),
        availability: z
          .object({
            CANDIDATE: z.number().int().nonnegative(),
            AVAILABLE: z.number().int().nonnegative(),
            UNAVAILABLE: z.number().int().nonnegative(),
          })
          .strict(),
        processing: z
          .object({
            NOT_SCHEDULED: z.number().int().nonnegative(),
            WAITING_FOR_SECURITY: z.number().int().nonnegative().optional(),
            QUEUED: z.number().int().nonnegative().optional(),
            RUNNING: z.number().int().nonnegative().optional(),
            SUCCEEDED: z.number().int().nonnegative().optional(),
            PARTIAL: z.number().int().nonnegative().optional(),
            FAILED: z.number().int().nonnegative().optional(),
            UNSUPPORTED: z.number().int().nonnegative().optional(),
            CANCELLED: z.number().int().nonnegative().optional(),
          })
          .strict(),
      })
      .strict(),
    items: z.array(batchItemStatusSchema).max(50),
    nextCursor: z.string().max(2048).nullable(),
  })
  .strict();
export const batchResponseSchema = z
  .object({ operationId: z.uuid(), batch: batchStatusSchema })
  .strict();
export type UploadStatus = z.infer<typeof uploadStatusSchema>;
