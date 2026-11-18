import { z } from 'zod';
import { extractionUnitSchema } from './extraction.js';
import { documentFilterSchema } from './registry.js';

// biome-ignore lint/suspicious/noControlCharactersInRegex: PostgreSQL text cannot contain NUL or unpaired surrogates.
const queryText = z.string().regex(/^[^\u0000\uD800-\uDFFF]*$/u);
export const indexStatusSchema = z.enum(['PENDING', 'READY', 'PARTIAL', 'NOT_INDEXED']);
export const discoveryRequestSchema = documentFilterSchema
  .safeExtend({
    q: queryText.trim().min(3).max(128).optional(),
    metadataField: z.enum(['category', 'status']).optional(),
    metadataValue: queryText.max(2048).optional(),
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(2048).optional(),
  })
  .refine((v) => (v.metadataField === undefined) === (v.metadataValue === undefined));
export const discoveryPageSchema = z
  .object({
    language: z.literal('en'),
    untrusted: z.literal(true),
    items: z
      .array(
        z
          .object({
            documentId: z.uuid(),
            versionId: z.uuid(),
            title: z.string().max(240),
            fileName: z.string().max(255),
            runId: z.uuid().nullable(),
            indexStatus: indexStatusSchema,
            match: z
              .object({
                unitId: z.string().max(160),
                kind: extractionUnitSchema.shape.kind,
                source: extractionUnitSchema.shape.source,
                chunk: z.number().int().min(0).max(8191),
                snippet: z.string().max(480),
              })
              .strict()
              .nullable(),
          })
          .strict(),
      )
      .max(50),
    nextCursor: z.string().max(2048).nullable(),
  })
  .strict();
