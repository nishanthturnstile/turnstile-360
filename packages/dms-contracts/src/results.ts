import { z } from 'zod';
import { indexStatusSchema } from './discovery.js';
import { extractionManifestSchema } from './extraction.js';

export const reprocessSchema = z.object({ profile: z.enum(['searchable', 'structured']) }).strict();
export const resultQuerySchema = z
  .object({ versionId: z.uuid().optional(), runId: z.uuid().optional() })
  .strict();
export const processingQuerySchema = z
  .object({
    versionId: z.uuid().optional(),
    limit: z
      .string()
      .regex(/^(?:[1-9]|[1-4][0-9]|50)$/)
      .optional(),
    cursor: z.string().min(1).max(2048).optional(),
  })
  .strict();
export const processingRunSchema = z
  .object({
    id: z.uuid(),
    documentId: z.uuid(),
    versionId: z.uuid(),
    number: z.number().int().positive(),
    profile: z.enum(['searchable', 'structured']),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.enum([
      'QUEUED',
      'RUNNING',
      'SUCCEEDED',
      'PARTIAL',
      'FAILED',
      'UNSUPPORTED',
      'CANCELLED',
    ]),
    active: z.boolean(),
    indexStatus: indexStatusSchema,
    manifest: extractionManifestSchema.nullable(),
    createdAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
  })
  .strict();
export const processingHistorySchema = z
  .object({
    documentId: z.uuid(),
    versionId: z.uuid(),
    activeRunId: z.uuid().nullable(),
    indexStatus: indexStatusSchema,
    items: z.array(processingRunSchema).max(50),
    nextCursor: z.string().max(2048).nullable(),
  })
  .strict();
export const reprocessResponseSchema = z
  .object({ operationId: z.uuid(), run: processingRunSchema, replayUntil: z.iso.datetime() })
  .strict();
export const processingContentSchema = z
  .object({
    run: processingRunSchema,
    untrusted: z.literal(true),
    artifacts: z
      .array(
        z
          .object({
            schemaVersion: z.literal(1),
            kind: z.literal('extraction-json'),
            size: z.number().int().positive().max(26214400),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            url: z.url(),
            method: z.literal('GET'),
            expiresAt: z.iso.datetime(),
          })
          .strict(),
      )
      .max(1),
  })
  .strict();
