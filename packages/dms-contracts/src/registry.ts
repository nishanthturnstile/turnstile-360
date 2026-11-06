import { z } from 'zod';

export const DOCUMENT_LIMITS = {
  maxFileBytes: 50 * 1024 * 1024,
  metadataBytes: 16384,
  uploadControlBytes: 32768,
  batchManifestBytes: 262144,
  batchControlBytes: 266240,
  activePerApplication: 4,
  activePerTenant: 16,
  queuedWork: 100,
  uploadSeconds: 86400,
  idempotencySeconds: 86400,
  capacityFreshSeconds: 30,
  scratchPerUploadBytes: 256 * 1024 * 1024,
} as const;
const label = z
  .string()
  .min(1)
  .max(240)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters in presentation metadata.
  .regex(/^[^\u0000-\u001f\u007f\uD800-\uDFFF]+$/u);
const displayName = z
  .string()
  .min(1)
  .max(255)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject path separators and controls in display filenames.
  .regex(/^[^/\\\u0000-\u001f\u007f]+$/);
const metadataText = z
  .string()
  .max(2048)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: PostgreSQL JSON strings cannot contain NUL or unpaired surrogates.
  .regex(/^[^\u0000\uD800-\uDFFF]*$/u);
const value = z.union([metadataText, z.number().finite(), z.boolean(), z.null()]);
export const documentMetadataSchema = z
  .record(
    z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,47}$/),
    z.union([value, z.array(value).max(20)]),
  )
  .refine(
    (v) =>
      Object.keys(v).length <= 64 &&
      encodeURIComponent(JSON.stringify(v)).replace(/%[0-9A-F]{2}|./g, 'x').length <=
        DOCUMENT_LIMITS.metadataBytes,
  )
  .meta({ maxProperties: 64 });
export const documentTagsSchema = z
  .array(label.max(64))
  .max(32)
  .refine((v) => new Set(v).size === v.length);
export const documentReferenceInputSchema = z
  .object({
    namespace: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/),
    type: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/),
    externalId: label.max(128),
  })
  .strict();
export const documentReferenceSchema = documentReferenceInputSchema
  .extend({ id: z.uuid(), applicationId: z.uuid() })
  .strict();
export const documentEditSchema = z
  .object({
    title: label.optional(),
    metadata: documentMetadataSchema.optional(),
    tags: documentTagsSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
export const documentFilterSchema = z
  .object({
    fileName: displayName.optional(),
    title: label.optional(),
    tag: label.max(64).optional(),
    referenceNamespace: documentReferenceInputSchema.shape.namespace.optional(),
    referenceType: documentReferenceInputSchema.shape.type.optional(),
    referenceId: documentReferenceInputSchema.shape.externalId.optional(),
  })
  .strict()
  .refine(
    (v) =>
      [v.referenceNamespace, v.referenceType, v.referenceId].filter((x) => x !== undefined).length %
        3 ===
      0,
  );
export const documentAssertedHumanSchema = z
  .object({
    source: z.literal('application-asserted'),
    subject: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_.:@-]+$/),
  })
  .strict();
export const uploadAdmissionRequestSchema = z
  .object({
    documentId: z.uuid().optional(),
    expectedRevision: z
      .string()
      .regex(/^[1-9][0-9]{0,14}$/)
      .optional(),
    title: label,
    fileName: displayName,
    contentType: z
      .string()
      .max(100)
      .regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/),
    size: z.number().int().min(1).max(DOCUMENT_LIMITS.maxFileBytes),
    profile: z.enum(['secure-only', 'searchable', 'structured']),
    metadata: documentMetadataSchema.default({}),
    assertedHuman: documentAssertedHumanSchema.optional(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    batchId: z.uuid().optional(),
    itemId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
  })
  .strict();
export const admissionPolicyInputSchema = z
  .object({
    enabled: z.boolean(),
    storageBudgetBytes: z
      .number()
      .int()
      .min(1)
      .max(2 ** 50),
    applicationBudgetBytes: z
      .number()
      .int()
      .min(1)
      .max(2 ** 50),
    scratchBudgetBytes: z
      .number()
      .int()
      .min(1)
      .max(2 ** 50),
    maxFileBytes: z.number().int().min(1).max(DOCUMENT_LIMITS.maxFileBytes),
    activePerApplication: z.number().int().min(1).max(4),
    activePerTenant: z.number().int().min(1).max(16),
    queuedWork: z.number().int().min(1).max(100),
    profiles: z.array(z.enum(['secure-only', 'searchable', 'structured'])).max(3),
    contentTypes: z
      .array(
        z
          .string()
          .max(100)
          .regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/),
      )
      .max(32),
  })
  .strict();
export const admissionPolicyProjectionSchema = z
  .object({
    version: z.literal(1),
    revision: z.string().regex(/^(?:0|[1-9][0-9]{0,14})$/),
    state: z.enum(['not-configured', 'not-installed', 'paused', 'enabled']),
    limits: z
      .object({
        maxFileBytes: z.number().int().min(1).max(DOCUMENT_LIMITS.maxFileBytes),
        metadataBytes: z.literal(16384),
        uploadControlBytes: z.literal(32768),
        batchManifestBytes: z.literal(262144),
        batchControlBytes: z.literal(266240),
        activePerApplication: z.number().int().min(1).max(4),
        activePerTenant: z.number().int().min(1).max(16),
        queuedWork: z.number().int().min(1).max(100),
      })
      .strict(),
    formats: z.array(z.string().max(100)).max(32),
    profiles: z.array(z.enum(['secure-only', 'searchable', 'structured'])).max(3),
  })
  .strict();
export const documentSummarySchema = z
  .object({
    id: z.uuid(),
    applicationId: z.uuid(),
    title: label,
    tags: documentTagsSchema,
    fileName: displayName,
    lifecycle: z.literal('ACTIVE'),
    revision: z.string().regex(/^[1-9][0-9]{0,14}$/),
    currentVersionId: z.uuid().nullable(),
    downloadable: z.boolean(),
    searchable: z.boolean(),
  })
  .strict();
export const documentResponseSchema = documentSummarySchema
  .extend({
    metadata: documentMetadataSchema,
    references: z.array(documentReferenceSchema).max(32),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const documentPageSchema = z
  .object({
    items: z.array(documentSummarySchema).max(50),
    nextCursor: z.string().max(2048).nullable(),
  })
  .strict();
export const documentQuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^(?:[1-9]|[1-4][0-9]|50)$/)
      .optional(),
    cursor: z
      .string()
      .min(1)
      .max(2048)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict();
export type UploadAdmissionRequest = z.infer<typeof uploadAdmissionRequestSchema>;
export type AdmissionPolicy = z.infer<typeof admissionPolicyInputSchema>;
export type DocumentResponse = z.infer<typeof documentResponseSchema>;

// Current original only. Historical selection is introduced with version history.
export const downloadQuerySchema = z.object({ versionId: z.uuid().optional() }).strict();
export const downloadCapabilitySchema = z
  .object({
    documentId: z.uuid(),
    versionId: z.uuid(),
    url: z.url(),
    method: z.literal('GET'),
    fileName: z.string().min(1).max(255),
    contentType: z.literal('application/octet-stream'),
    size: z.number().int().positive().max(52428800),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.iso.datetime(),
  })
  .strict();

export const versionSchema = z
  .object({
    uploadId: z.uuid().nullable(),
    upload: z
      .enum(['INITIATED', 'OBJECT_VERIFIED', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'])
      .nullable(),
    id: z.uuid(),
    documentId: z.uuid(),
    number: z.number().int().positive().max(2147483646),
    fileName: displayName,
    contentType: z.string().max(100),
    size: z.number().int().positive().max(52428800),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    availability: z.enum(['CANDIDATE', 'AVAILABLE', 'UNAVAILABLE']),
    security: z.enum(['PENDING', 'PASSED', 'REJECTED', 'INCONCLUSIVE', 'INVALIDATED']),
    isCurrent: z.boolean(),
    downloadable: z.boolean(),
    restoredFromVersionId: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const versionPageSchema = z
  .object({ items: z.array(versionSchema).max(50), nextCursor: z.string().max(2048).nullable() })
  .strict();
export const restoreVersionSchema = z
  .object({ profile: z.enum(['secure-only', 'searchable', 'structured']) })
  .strict();

export const documentListQuerySchema = documentQuerySchema
  .extend(documentFilterSchema.shape)
  .refine(
    (v) =>
      [v.referenceNamespace, v.referenceType, v.referenceId].filter((x) => x !== undefined).length %
        3 ===
      0,
  );

export const documentRightSchema = z.enum(['READ', 'EDIT_METADATA', 'ADD_VERSION']);
export const documentPermissionsSchema = z
  .object({
    grants: z
      .array(
        z
          .object({
            applicationId: z.uuid(),
            rights: z
              .array(documentRightSchema)
              .min(1)
              .max(3)
              .refine((v) => new Set(v).size === v.length),
          })
          .strict(),
      )
      .max(64),
  })
  .strict()
  .refine(
    (v) => new Set(v.grants.map((g) => g.applicationId.toLowerCase())).size === v.grants.length,
  );
export const documentPermissionsResponseSchema = documentPermissionsSchema.safeExtend({
  documentId: z.uuid(),
  revision: z.string().regex(/^[1-9][0-9]{0,14}$/),
});

export const lifecycleResponseSchema = z
  .object({
    documentId: z.uuid(),
    revision: z.string().regex(/^[1-9][0-9]{0,14}$/),
    lifecycle: z.enum(['ACTIVE', 'SOFT_DELETED', 'PURGING', 'PURGED']),
    generation: z.number().int().positive().max(2147483646),
    deletedAt: z.iso.datetime().nullable(),
    restoreDeadline: z.iso.datetime().nullable(),
    restoredAt: z.iso.datetime().nullable(),
    currentVersionId: z.uuid().nullable(),
    downloadable: z.boolean(),
    restoration: z
      .object({
        state: z.enum(['NOT_REQUESTED', 'PENDING', 'COMPLETE', 'FAILED', 'PARTIAL']),
        pending: z.number().int().nonnegative(),
        scanning: z.number().int().nonnegative(),
        completed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
