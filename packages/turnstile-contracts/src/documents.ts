import {
  admissionPolicyProjectionSchema,
  auditPageSchema,
  auditQuerySchema,
  batchStatusSchema,
  capabilitiesResponseSchema,
  discoveryPageSchema,
  discoveryRequestSchema,
  documentEditSchema,
  documentListQuerySchema,
  documentPermissionsResponseSchema,
  documentPermissionsSchema,
  documentQuerySchema,
  documentReferenceInputSchema,
  documentResponseSchema,
  documentRightSchema,
  documentSummarySchema,
  downloadCapabilitySchema,
  downloadQuerySchema,
  extractionArtifactSchema,
  lifecycleResponseSchema,
  processingContentSchema,
  processingHistorySchema,
  processingQuerySchema,
  reprocessSchema,
  restoreVersionSchema,
  resultQuerySchema,
  serviceInfoSchema,
  transferCapabilitySchema,
  uploadBeginSchema,
  uploadStatusSchema,
  versionPageSchema,
  versionSchema,
} from '@thaarei/dms-contracts/public';
import { z } from 'zod';
import { DOCUMENTS_PERMISSIONS } from './documents-access.js';
import { DOCUMENTS_BATCH_ITEM_OPERATIONS, DOCUMENTS_ROUTES } from './documents-routes.js';
import {
  accessRevisionSchema,
  peopleDigestSchema,
  peopleIdSchema,
  peopleInstantSchema,
  peopleSubjectSchema,
  uniqueValues,
} from './people-common.js';

export * from './documents-access.js';
export * from './documents-routes.js';

export const DOCUMENTS_LIMITS = {
  ordinaryRequestBytes: 16_384,
  controlEnvelopeBytes: 36_864,
  upstreamControlBytes: 32_768,
  batchEnvelopeBytes: 270_336,
  upstreamBatchBytes: 266_240,
  manifestBytes: 262_144,
  responseBytes: 1_048_576,
  artifactBytes: 26_214_400,
  upstreamTimeoutMs: 8_000,
  handlerTimeoutMs: 10_000,
  browserTimeoutMs: 15_000,
  reconciliationSeconds: 23 * 3600,
  replaySafetySeconds: 60,
  payloadRetentionDays: 30,
  tombstoneRetentionDays: 90,
  unreconciledOperations: 100,
} as const;
// ES-only UTF-8 counting, including surrogate pairs. No DOM or Node dependency.
export function documentsJsonBytes(value: unknown): number {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error('JSON value required');
  let bytes = 0;
  for (const point of json) {
    const code = point.codePointAt(0) as number;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}
export const documentRevisionSchema = z.string().regex(/^[1-9][0-9]{0,14}$/);
const documentTarget = { documentId: peopleIdSchema };
const revisionTarget = { ...documentTarget, expectedRevision: documentRevisionSchema };
const versionTarget = { ...documentTarget, versionId: peopleIdSchema };
const reprocessCommandSchema = z.strictObject({
  kind: z.literal('version.reprocess'),
  ...versionTarget,
  payload: reprocessSchema,
});
// Actor/tenant/application/URL/method are intentionally absent from browser inputs.
const rawDescriptorSchema = uploadBeginSchema.omit({ assertedHuman: true });
const descriptorSchema = rawDescriptorSchema.refine(
  (value) => (value.batchId === undefined) === (value.itemId === undefined),
  'Batch and item identity must be supplied together',
);
const versionDescriptorSchema = descriptorSchema.safeExtend({ sha256: peopleDigestSchema });
const batchDescriptorSchema = rawDescriptorSchema.omit({ batchId: true, itemId: true });
const batchItemIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const batchItemCommandSchema = z.strictObject({
  kind: z.literal('batch.item'),
  batchId: peopleIdSchema,
  itemId: batchItemIdSchema,
});
const batchItemSchema = z.discriminatedUnion('operation', [
  z.strictObject({
    itemId: batchItemIdSchema,
    operation: z.literal('create'),
    descriptor: batchDescriptorSchema,
  }),
  z.strictObject({
    itemId: batchItemIdSchema,
    operation: z.literal('new-version'),
    ...revisionTarget,
    descriptor: batchDescriptorSchema.safeExtend({ sha256: peopleDigestSchema }),
  }),
]);
const batchPayloadSchema = z
  .strictObject({ items: z.array(batchItemSchema).min(1).max(100) })
  .refine(
    (value) =>
      uniqueValues(value.items.map((item) => item.itemId)) &&
      documentsJsonBytes(value) <= DOCUMENTS_LIMITS.manifestBytes,
    'Duplicate item identity or manifest byte limit',
  );
export const documentsCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('upload.begin'), payload: descriptorSchema }),
  z.strictObject({
    kind: z.literal('version.begin'),
    ...revisionTarget,
    payload: versionDescriptorSchema,
  }),
  z.strictObject({ kind: z.literal('upload.complete'), uploadId: peopleIdSchema }),
  z.strictObject({ kind: z.literal('upload.refresh'), uploadId: peopleIdSchema }),
  z.strictObject({ kind: z.literal('upload.cancel'), uploadId: peopleIdSchema }),
  z.strictObject({ kind: z.literal('batch.create'), payload: batchPayloadSchema }),
  batchItemCommandSchema,
  z.strictObject({ kind: z.literal('batch.close'), batchId: peopleIdSchema }),
  z.strictObject({ kind: z.literal('batch.cancel'), batchId: peopleIdSchema }),
  z.strictObject({
    kind: z.literal('document.edit'),
    ...revisionTarget,
    payload: documentEditSchema,
  }),
  z.strictObject({
    kind: z.literal('reference.link'),
    ...revisionTarget,
    payload: documentReferenceInputSchema,
  }),
  z.strictObject({
    kind: z.literal('reference.unlink'),
    ...revisionTarget,
    referenceId: peopleIdSchema,
  }),
  z.strictObject({
    kind: z.literal('version.restore'),
    ...revisionTarget,
    versionId: peopleIdSchema,
    payload: restoreVersionSchema,
  }),
  z.strictObject({ kind: z.literal('document.delete'), ...revisionTarget }),
  z.strictObject({ kind: z.literal('document.restore'), ...revisionTarget }),
  z.strictObject({
    kind: z.literal('permissions.replace'),
    ...revisionTarget,
    payload: documentPermissionsSchema,
  }),
  reprocessCommandSchema,
]);
const textDescriptorSchema = batchDescriptorSchema.extend({
  contentType: z.literal('text/plain'),
  profile: z.literal('secure-only'),
  sha256: peopleDigestSchema,
});
const hashedDescriptorSchema = batchDescriptorSchema.extend({ sha256: peopleDigestSchema });
export const documentsUploadCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('upload.begin'),
    payload: textDescriptorSchema,
  }),
  z.strictObject({ kind: z.literal('upload.complete'), uploadId: peopleIdSchema }),
  z.strictObject({ kind: z.literal('upload.refresh'), uploadId: peopleIdSchema }),
  z.strictObject({ kind: z.literal('upload.cancel'), uploadId: peopleIdSchema }),
]);
export const documentsBatchItemSchema = z.discriminatedUnion('operation', [
  batchItemSchema.options[0].extend({ descriptor: textDescriptorSchema }),
  batchItemSchema.options[1].extend({ descriptor: textDescriptorSchema }),
]);
export const documentsBatchPayloadSchema = batchPayloadSchema.safeExtend({
  items: z.array(documentsBatchItemSchema).min(1).max(100),
});
export type DocumentsBatchPayload = z.infer<typeof documentsBatchPayloadSchema>;
export const documentsWorkspaceCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('upload.begin'), payload: hashedDescriptorSchema }),
  ...documentsUploadCommandSchema.options.slice(1),
  z.strictObject({
    kind: z.literal('version.begin'),
    ...revisionTarget,
    payload: hashedDescriptorSchema,
  }),
  z.strictObject({ kind: z.literal('batch.create'), payload: documentsBatchPayloadSchema }),
  batchItemCommandSchema,
  z.strictObject({ kind: z.literal('batch.close'), batchId: peopleIdSchema }),
  z.strictObject({ kind: z.literal('batch.cancel'), batchId: peopleIdSchema }),
  z.strictObject({
    kind: z.literal('document.edit'),
    ...revisionTarget,
    payload: documentEditSchema,
  }),
  z.strictObject({
    kind: z.literal('reference.link'),
    ...revisionTarget,
    payload: documentReferenceInputSchema,
  }),
  z.strictObject({
    kind: z.literal('reference.unlink'),
    ...revisionTarget,
    referenceId: peopleIdSchema,
  }),
  z.strictObject({
    kind: z.literal('version.restore'),
    ...revisionTarget,
    versionId: peopleIdSchema,
    payload: z.strictObject({ profile: z.literal('secure-only') }),
  }),
  z.strictObject({ kind: z.literal('document.delete'), ...revisionTarget }),
  z.strictObject({ kind: z.literal('document.restore'), ...revisionTarget }),
  z.strictObject({
    kind: z.literal('permissions.replace'),
    ...revisionTarget,
    payload: documentPermissionsSchema,
  }),
  reprocessCommandSchema,
]);
export type DocumentsWorkspaceCommand = z.infer<typeof documentsWorkspaceCommandSchema>;
export const documentsVersionQuerySchema = documentQuerySchema;
export const documentsVersionSchema = versionSchema;
export const documentsVersionPageSchema = versionPageSchema;
export const documentsDownloadQuerySchema = downloadQuerySchema;
export const documentsLifecycleSchema = lifecycleResponseSchema;
export const documentsGrantListSchema = documentPermissionsResponseSchema;
export const documentsAuditPageSchema = auditPageSchema;
export const documentsAuditQuerySchema = auditQuerySchema;
export const documentsProcessingQuerySchema = processingQuerySchema;
export const documentsProcessingHistorySchema = processingHistorySchema;
export const documentsContentQuerySchema = resultQuerySchema;
export const documentsContentSchema = processingContentSchema;
export const documentsExtractionArtifactSchema = extractionArtifactSchema;
export const documentsSearchQuerySchema = z
  .strictObject({ ...discoveryRequestSchema.shape, limit: documentListQuerySchema.shape.limit })
  .refine(
    ({ limit, ...filters }) =>
      discoveryRequestSchema.safeParse({ ...filters, limit: Number(limit ?? 20) }).success,
  );
export const documentsSearchPageSchema = discoveryPageSchema;
export { documentEditSchema, documentRightSchema };
export type DocumentsUploadCommand = z.infer<typeof documentsUploadCommandSchema>;
export type DocumentsCommand = z.infer<typeof documentsCommandSchema>;
// No action implies READ. In particular Contribute requires validate plus its own action.
export function documentsCommandPermissions(
  kind: DocumentsCommand['kind'],
  mode: 'ordinary' | 'contribute',
) {
  const route = DOCUMENTS_ROUTES.find((route) =>
    kind === 'batch.item'
      ? route.operationId === DOCUMENTS_BATCH_ITEM_OPERATIONS.create
      : route.product && 'command' in route.product && route.product.command === kind,
  );
  if (!route) throw new Error('Unknown Documents command');
  return [
    'turnstile:access',
    route.action,
    ...(mode === 'contribute' ? ['turnstile:documents:validate'] : []),
  ];
}
// Enforce after canonicalization and server attribution as well as at parser ingress.
export function documentsForwardedBodyFits(kind: DocumentsCommand['kind'], body: unknown): boolean {
  return (
    documentsJsonBytes(body) <=
    (kind === 'batch.create'
      ? DOCUMENTS_LIMITS.upstreamBatchBytes
      : DOCUMENTS_LIMITS.upstreamControlBytes)
  );
}
export function documentsCommandBodyLimit(kind: unknown) {
  if (kind === 'batch.create') return DOCUMENTS_LIMITS.batchEnvelopeBytes;
  return [
    'upload.begin',
    'version.begin',
    'document.edit',
    'reference.link',
    'reference.unlink',
  ].some((command) => command === kind)
    ? DOCUMENTS_LIMITS.controlEnvelopeBytes
    : DOCUMENTS_LIMITS.ordinaryRequestBytes;
}
const contributionKinds = new Set<DocumentsCommand['kind']>([
  'document.edit',
  'reference.link',
  'reference.unlink',
  'version.begin',
  'upload.complete',
  'upload.refresh',
  'upload.cancel',
]);
export const isContributionKind = (kind: DocumentsCommand['kind']) => contributionKinds.has(kind);
export const documentsOperationModeSchema = z.enum(['ordinary', 'contribute']);
export type DocumentsOperationMode = z.infer<typeof documentsOperationModeSchema>;
export const documentsDraftRequestSchema = z
  .strictObject({ command: documentsCommandSchema, mode: documentsOperationModeSchema })
  .superRefine((value, ctx) => {
    if (documentsJsonBytes(value) > documentsCommandBodyLimit(value.command.kind))
      ctx.addIssue({ code: 'custom', message: 'Command envelope byte limit' });
    if (value.mode === 'contribute' && !isContributionKind(value.command.kind))
      ctx.addIssue({ code: 'custom', message: 'Unsupported contribution command' });
    if (
      value.mode === 'contribute' &&
      value.command.kind === 'version.begin' &&
      !textDescriptorSchema.safeParse(value.command.payload).success
    )
      ctx.addIssue({ code: 'custom', message: 'Contribution requires a secure-only text file' });
  });
// ID is minted in the draft response; executing a missing ID never creates an intent.
export const documentsExecuteRequestSchema = z.strictObject({ digest: peopleDigestSchema });
export const documentsIntentStateSchema = z.enum([
  'DRAFT',
  'DISPATCHING',
  'UNCERTAIN',
  'ACKNOWLEDGED',
  'RESOLVED',
  'UNRESOLVED_REQUIRES_REVIEW',
  'DISPOSED',
]);
export const documentsIntentReceiptSchema = z.strictObject({
  id: peopleIdSchema,
  digest: peopleDigestSchema,
  kind: z.enum(documentsCommandSchema.options.map((option) => option.shape.kind.value)),
  state: documentsIntentStateSchema,
  acknowledgement: z.enum(['none', 'accepted', 'confirmed']),
  visibility: z.literal('local_receipt_only'),
  createdAt: peopleInstantSchema,
  reconciliationUntil: peopleInstantSchema.nullable(),
});
export const documentsUploadReceiptSchema = z.strictObject({
  receipt: documentsIntentReceiptSchema,
  uploadId: peopleIdSchema.nullable(),
  mode: z.literal('contribute').optional(),
  documentId: peopleIdSchema.optional(),
  versionId: peopleIdSchema.optional(),
  runId: peopleIdSchema.optional(),
  batchId: peopleIdSchema.nullable().optional(),
  itemId: batchItemIdSchema.optional(),
  file: z
    .strictObject({
      fileName: z.string().max(255),
      size: z.number().int().positive().max(52428800),
      sha256: peopleDigestSchema,
    })
    .nullable(),
});
export const documentsUploadExecutionSchema = documentsUploadReceiptSchema.extend({
  transfer: transferCapabilitySchema.nullable(),
});
export const documentsUploadHistorySchema = z.array(documentsUploadReceiptSchema).max(100);
export const documentsBatchStatusSchema = batchStatusSchema;
export const documentsBatchManifestSchema = z.strictObject({
  id: peopleIdSchema,
  items: z
    .array(
      z.strictObject({
        itemId: batchItemIdSchema,
        operation: z.enum(['create', 'new-version']),
        fileName: z.string().max(255),
        size: z.number().int().positive().max(52428800),
        sha256: peopleDigestSchema,
      }),
    )
    .max(100),
});
export type DocumentsBatchStatus = z.infer<typeof documentsBatchStatusSchema>;
export { downloadCapabilitySchema, uploadStatusSchema };
export type DocumentsUploadReceipt = z.infer<typeof documentsUploadReceiptSchema>;
export function documentsReconciliationUntil(firstDispatch: number, replayUntil?: number): number {
  if (
    !Number.isFinite(firstDispatch) ||
    (replayUntil !== undefined && !Number.isFinite(replayUntil))
  )
    throw new Error('Finite server time required');
  return Math.min(
    firstDispatch + DOCUMENTS_LIMITS.reconciliationSeconds * 1000,
    replayUntil === undefined
      ? Number.POSITIVE_INFINITY
      : replayUntil - DOCUMENTS_LIMITS.replaySafetySeconds * 1000,
  );
}
// Protected stdin only. Opaque cookies require live verification; fields are not proofs
// by themselves. Private operator code must reject system roles and foreign/inactive users.
const validatorBase = {
  key: peopleIdSchema,
  expectedAccessRevision: accessRevisionSchema,
  operatorId: peopleSubjectSchema,
  operatorUserId: peopleSubjectSchema,
  operatorCookie: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[^\r\n]+$/)
    .meta({ writeOnly: true }),
  targetUserId: peopleSubjectSchema,
  roleId: peopleIdSchema,
  scope: z.literal('company'),
  reason: z.string().trim().min(1).max(300),
};
export const documentsValidatorCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({
    ...validatorBase,
    action: z.literal('grant'),
    targetCookie: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^[^\r\n]+$/)
      .meta({ writeOnly: true }),
    permissions: z
      .array(z.enum(['turnstile:access', ...DOCUMENTS_PERMISSIONS]))
      .min(2)
      .max(10)
      .refine(uniqueValues)
      .refine((values) => values.includes('turnstile:access')),
    activateV3Barrier: z.literal(true),
  }),
  z.strictObject({ ...validatorBase, action: z.literal('revoke') }),
  z
    .strictObject({
      ...validatorBase,
      action: z.literal('handover'),
      targetCookie: z
        .string()
        .min(1)
        .max(4096)
        .regex(/^[^\r\n]+$/)
        .meta({ writeOnly: true }),
      fromUserId: peopleSubjectSchema,
      permissions: z
        .array(z.enum(['turnstile:access', ...DOCUMENTS_PERMISSIONS]))
        .min(2)
        .max(10)
        .refine(uniqueValues)
        .refine((values) => values.includes('turnstile:access')),
      activateV3Barrier: z.literal(true),
    })
    .refine((value) => value.fromUserId !== value.targetUserId),
]);
export const DOCUMENTS_ERROR_STATUS = {
  DOCUMENTS_INVALID: 400,
  LOGIN_REQUIRED: 401,
  DOCUMENTS_DENIED: 403,
  DEPLOYMENT_RESTRICTED: 403,
  DOCUMENTS_NOT_FOUND: 404,
  DOCUMENTS_CONFLICT: 409,
  DOCUMENTS_RESULT_UNAVAILABLE: 409,
  DOCUMENTS_PROFILE_UNAVAILABLE: 409,
  DOCUMENTS_PROCESSING_ACTIVE: 409,
  DOCUMENTS_INTENT_GONE: 410,
  DOCUMENTS_RESTORE_EXPIRED: 410,
  DOCUMENTS_TOO_LARGE: 413,
  DOCUMENTS_MEDIA_TYPE_UNSUPPORTED: 415,
  DOCUMENTS_CAPACITY: 429,
  DOCUMENTS_UNAVAILABLE: 503,
} as const;
export const documentsErrorSchema = z.strictObject({
  code: z.enum(
    Object.keys(DOCUMENTS_ERROR_STATUS) as [
      keyof typeof DOCUMENTS_ERROR_STATUS,
      ...Array<keyof typeof DOCUMENTS_ERROR_STATUS>,
    ],
  ),
  requestId: peopleIdSchema,
  guidance: z.enum([
    'correct_input',
    'sign_in',
    'review_conflict',
    'retry_same_intent',
    'read_known_id',
    'manual_review',
    'wait_for_access',
  ]),
});
export const DOCUMENTS_REQUEST_ID_HEADER = 'x-request-id';
export const documentsServiceIdentitySchema = serviceInfoSchema;
export const documentsValidationChecklistSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        evidenceId: z.enum(DOCUMENTS_ROUTES.map((route) => route.evidenceId)),
        allowedByProductRole: z
          .boolean()
          .describe('All company permissions for the ordinary workflow are present.'),
        expected: z.string().min(1).max(512),
      }),
    )
    .length(DOCUMENTS_ROUTES.length),
});
// Safe separate bootstrap, not the unchanged /api/dms/capabilities DTO.
export const documentsConnectionSchema = z.strictObject({
  contractVersion: z.literal(1),
  productAccess: z.enum(['full', 'existing-reads', 'closed']),
  dmsAccess: z.enum(['full', 'existing-reads', 'closed']),
  effectiveOperations: capabilitiesResponseSchema.shape.operations.describe(
    'Operations available to the ordinary workflow under current product permissions and deployment access.',
  ),
  formats: capabilitiesResponseSchema.shape.formats,
  profiles: capabilitiesResponseSchema.shape.profiles,
  languages: capabilitiesResponseSchema.shape.languages,
  formatCapabilities: capabilitiesResponseSchema.shape.formatCapabilities,
  admission: admissionPolicyProjectionSchema,
});
export function documentsJsonSchemas() {
  const registry = z.registry<{ id: string }>();
  for (const [name, schema] of Object.entries(documentsSchemas)) registry.add(schema, { id: name });
  const result = z.toJSONSchema(registry, { io: 'input', uri: (id) => `#/schemas/${id}` }).schemas;
  for (const schema of Object.values(result)) delete schema.$id;
  return result;
}

export const documentsListQuerySchema = documentListQuerySchema;
export const documentsSummarySchema = documentSummarySchema
  .omit({ applicationId: true })
  .extend({ ownership: z.enum(['owned', 'shared']) });
export const documentsDetailSchema = documentResponseSchema
  .omit({ applicationId: true })
  .extend({ ownership: z.enum(['owned', 'shared']) });
export const documentsPageSchema = z.strictObject({
  items: z.array(documentsSummarySchema).max(50),
  nextCursor: z.string().max(2048).nullable(),
});
export type DocumentsConnectionDto = z.infer<typeof documentsConnectionSchema>;
export type DocumentsDetailDto = z.infer<typeof documentsDetailSchema>;
export type DocumentsPageDto = z.infer<typeof documentsPageSchema>;

export const documentsSchemas = {
  DocumentsListQuery: documentsListQuerySchema,
  DocumentsSummary: documentsSummarySchema,
  DocumentsDetail: documentsDetailSchema,
  DocumentsPage: documentsPageSchema,
  DocumentsConnection: documentsConnectionSchema,
  DocumentsCommand: documentsCommandSchema,
  DocumentsDraftRequest: documentsDraftRequestSchema,
  DocumentsExecuteRequest: documentsExecuteRequestSchema,
  DocumentsIntentReceipt: documentsIntentReceiptSchema,
  DocumentsUploadCommand: documentsUploadCommandSchema,
  DocumentsWorkspaceCommand: documentsWorkspaceCommandSchema,
  DocumentsVersion: documentsVersionSchema,
  DocumentsVersionPage: documentsVersionPageSchema,
  DocumentsVersionQuery: documentsVersionQuerySchema,
  DocumentsDownloadQuery: documentsDownloadQuerySchema,
  DocumentsLifecycle: documentsLifecycleSchema,
  DocumentsGrantList: documentsGrantListSchema,
  DocumentsAuditPage: documentsAuditPageSchema,
  DocumentsAuditQuery: documentsAuditQuerySchema,
  DocumentsProcessingQuery: documentsProcessingQuerySchema,
  DocumentsProcessingHistory: documentsProcessingHistorySchema,
  DocumentsContentQuery: documentsContentQuerySchema,
  DocumentsContent: documentsContentSchema,
  DocumentsExtractionArtifact: documentsExtractionArtifactSchema,
  DocumentsSearchQuery: documentsSearchQuerySchema,
  DocumentsSearchPage: documentsSearchPageSchema,
  DocumentsBatchPayload: documentsBatchPayloadSchema,
  DocumentsBatchStatus: documentsBatchStatusSchema,
  DocumentsBatchManifest: documentsBatchManifestSchema,
  DocumentsUploadReceipt: documentsUploadReceiptSchema,
  DocumentsUploadExecution: documentsUploadExecutionSchema,
  DocumentsUploadHistory: documentsUploadHistorySchema,
  DocumentsUploadStatus: uploadStatusSchema,
  DocumentsOriginalDownload: downloadCapabilitySchema,
  DocumentsValidatorCommand: documentsValidatorCommandSchema,
  DocumentsError: documentsErrorSchema,
  DocumentsValidationChecklist: documentsValidationChecklistSchema,
  DocumentsServiceIdentity: documentsServiceIdentitySchema,
};
