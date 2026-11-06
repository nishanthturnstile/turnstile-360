import { discoveryPageSchema, discoveryRequestSchema } from './discovery.js';

export * from './discovery.js';

import {
  processingContentSchema,
  processingHistorySchema,
  processingRunSchema,
  reprocessResponseSchema,
  reprocessSchema,
} from './results.js';

export {
  extractionArtifactSchema,
  extractionManifestSchema,
  extractionUnitSchema,
} from './extraction.js';
export * from './results.js';

import {
  EXTRACTION_FORMATS,
  extractionArtifactSchema,
  extractionManifestSchema,
} from './extraction.js';
import {
  batchCreateSchema,
  batchResponseSchema,
  batchStatusSchema,
  emptyCommandSchema,
  uploadBeginSchema,
  uploadResponseSchema,
  uploadStatusSchema,
} from './uploads.js';

export * from './uploads.js';

import {
  admissionPolicyProjectionSchema,
  documentEditSchema,
  documentPageSchema,
  documentPermissionsResponseSchema,
  documentPermissionsSchema,
  documentReferenceInputSchema,
  documentResponseSchema,
  downloadCapabilitySchema,
  lifecycleResponseSchema,
  restoreVersionSchema,
  versionPageSchema,
  versionSchema,
} from './registry.js';

export * from './registry.js';

import { z } from 'zod';

// Extend this ceiling only alongside the capability that implements the scope.
export const DMS_MACHINE_SCOPES = [
  'dms:capabilities:read',
  'dms:audit:read',
  'dms:documents:read',
  'dms:documents:write',
] as const;
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
    operations: z.array(
      z.enum([
        'application-enrollment',
        'capabilities:read',
        'audit:read',
        'documents:read',
        'documents:download',
        'versions:read',
        'versions:write',
        'documents:edit-metadata',
        'documents:references',
        'documents:permissions',
        'documents:lifecycle',
        'versions:restore',
        'discovery:search',
        'processing:read',
        'processing:reprocess',
        'admission-policy:read',
        'uploads:read',
        'uploads:control',
        'upload-batches:read',
        'upload-batches:control',
      ]),
    ),
    formats: z.array(z.enum(Object.keys(EXTRACTION_FORMATS) as [string, ...string[]])).max(32),
    profiles: z.array(z.enum(['secure-only', 'searchable', 'structured'])).max(3),
    formatCapabilities: z
      .array(
        z
          .object({
            contentType: z.string().max(100),
            securityAssessment: z.literal(true),
            textExtraction: z.boolean(),
            ocr: z.boolean().optional(),
            tabularData: z.boolean(),
            structuredLayout: z.boolean(),
            preview: z.literal(false),
          })
          .strict(),
      )
      .max(32)
      .optional(),
    languages: z.array(z.literal('en')).max(1),
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
      'DOCUMENT_NOT_FOUND',
      'DOCUMENT_UNAVAILABLE',
      'VERSION_NOT_FOUND',
      'PROCESSING_RUN_NOT_FOUND',
      'RESULT_UNAVAILABLE',
      'PROFILE_UNAVAILABLE',
      'PROCESSING_IN_PROGRESS',
      'POLICY_DENIED',
      'CAPACITY_EXCEEDED',
      'CAPACITY_UNAVAILABLE',
      'ADMISSION_IN_PROGRESS',
      'RESTORE_WINDOW_EXPIRED',
      'REVISION_CONFLICT',
      'UPLOAD_NOT_FOUND',
      'BATCH_NOT_FOUND',
      'BATCH_ITEM_NOT_FOUND',
      'BATCH_ITEM_BOUND',
      'BATCH_CLOSED',
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
    resourceType: z.enum(['application', 'document', 'upload-batch']),
    resourceId: z.uuid(),
    action: z.enum([
      'application.enrolled',
      'document.admitted',
      'admission.reconciled',
      'upload.authorized',
      'upload.completion-requested',
      'upload.cancelled',
      'upload.expired',
      'upload.object-verified',
      'upload.failed',
      'work.queued',
      'work.completed',
      'work.recovered',
      'work.cancelled',
      'security.assessed',
      'security.invalidated',
      'document.published',
      'document.download-authorized',
      'document.version-restored',
      'document.soft-deleted',
      'document.logical-restored',
      'processing.requested',
      'processing.promoted',
      'processing.content-authorized',
      'document.permissions-changed',
      'document.metadata-updated',
      'document.reference-linked',
      'document.reference-unlinked',
      'disposal.requested',
      'disposal.completed',
      'document.purged',
      'batch.created',
      'batch.closed',
      'batch.cancelled',
      'batch.expired',
    ]),
    actor: z
      .object({
        kind: z.enum(['machine', 'coordinator', 'operator']),
        id: z.string().min(1).max(200),
      })
      .strict(),
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
  DOCUMENT_NOT_FOUND: [404],
  DOCUMENT_UNAVAILABLE: [409],
  VERSION_NOT_FOUND: [404],
  PROCESSING_RUN_NOT_FOUND: [404],
  RESULT_UNAVAILABLE: [409],
  PROFILE_UNAVAILABLE: [409],
  PROCESSING_IN_PROGRESS: [409],
  POLICY_DENIED: [403],
  CAPACITY_EXCEEDED: [429],
  CAPACITY_UNAVAILABLE: [503],
  ADMISSION_IN_PROGRESS: [409],
  RESTORE_WINDOW_EXPIRED: [410],
  REVISION_CONFLICT: [412],
  UPLOAD_NOT_FOUND: [404],
  BATCH_NOT_FOUND: [404],
  BATCH_ITEM_NOT_FOUND: [404],
  BATCH_ITEM_BOUND: [409],
  BATCH_CLOSED: [409],
} as const satisfies Record<DmsErrorCode, readonly number[]>;

export const dmsPublicSchemas = {
  DiscoveryRequest: discoveryRequestSchema,
  DiscoveryPage: discoveryPageSchema,
  ExtractionArtifact: extractionArtifactSchema,
  ExtractionManifest: extractionManifestSchema,
  ProcessingRun: processingRunSchema,
  ProcessingHistory: processingHistorySchema,
  ProcessingContent: processingContentSchema,
  Reprocess: reprocessSchema,
  ReprocessResponse: reprocessResponseSchema,
  UploadBegin: uploadBeginSchema,
  EmptyCommand: emptyCommandSchema,
  UploadStatus: uploadStatusSchema,
  UploadResponse: uploadResponseSchema,
  BatchCreate: batchCreateSchema,
  BatchStatus: batchStatusSchema,
  BatchResponse: batchResponseSchema,
  EnrollmentRequest: enrollmentRequestSchema,
  EnrollmentResponse: enrollmentResponseSchema,
  CapabilitiesResponse: capabilitiesResponseSchema,
  DmsError: dmsErrorSchema,
  ServiceInfo: serviceInfoSchema,
  IdempotencyKey: idempotencyKeySchema,
  ResourceETag: resourceEtagSchema,
  RetryAfterSeconds: retryAfterSecondsSchema,
  RequestId: requestIdSchema,
  Document: documentResponseSchema,
  DocumentEdit: documentEditSchema,
  DocumentLifecycle: lifecycleResponseSchema,
  DocumentPermissions: documentPermissionsSchema,
  DocumentPermissionsResponse: documentPermissionsResponseSchema,
  DocumentReferenceInput: documentReferenceInputSchema,
  DownloadCapability: downloadCapabilitySchema,
  Version: versionSchema,
  VersionPage: versionPageSchema,
  RestoreVersion: restoreVersionSchema,
  DocumentPage: documentPageSchema,
  AdmissionPolicy: admissionPolicyProjectionSchema,
  AuditEvent: auditEventSchema,
  AuditPage: auditPageSchema,
  AuditQuery: auditQuerySchema,
};
export const dmsPublicJsonSchemas = Object.fromEntries(
  Object.entries(dmsPublicSchemas).map(([name, schema]) => [
    name,
    z.toJSONSchema(schema, name === 'DiscoveryRequest' ? { io: 'input' } : {}),
  ]),
);

export const DMS_PUBLIC_ROUTES = [
  {
    method: 'POST',
    path: '/v1/search',
    operationId: 'searchDmsDocuments',
    policy: 'machine',
    scopes: ['dms:documents:read'],
    request: 'DiscoveryRequest',
    response: 'DiscoveryPage',
    statuses: [200, 400, 401, 403, 503],
  },
  {
    method: 'GET',
    path: '/v1/documents/{documentId}/processing',
    operationId: 'getDmsProcessing',
    policy: 'machine',
    scopes: ['dms:documents:read'],
    response: 'ProcessingHistory',
    statuses: [200, 400, 401, 403, 404, 409, 503],
  },
  {
    method: 'GET',
    path: '/v1/documents/{documentId}/content',
    operationId: 'getDmsContent',
    policy: 'machine',
    scopes: ['dms:documents:read'],
    response: 'ProcessingContent',
    statuses: [200, 400, 401, 403, 404, 409, 503],
  },
  {
    method: 'POST',
    path: '/v1/documents/{documentId}/versions/{versionId}/reprocess',
    operationId: 'reprocessDmsVersion',
    policy: 'machine',
    scopes: ['dms:documents:read', 'dms:documents:write'],
    request: 'Reprocess',
    response: 'ReprocessResponse',
    idempotency: true,
    statuses: [200, 202, 400, 401, 403, 404, 409, 410, 429, 503],
  },

  {
    method: 'GET',
    path: '/v1/documents/{documentId}/lifecycle',
    operationId: 'getDmsDocumentLifecycle',
    policy: 'machine',
    scopes: ['dms:documents:read'],
    response: 'DocumentLifecycle',
    statuses: [200, 400, 401, 403, 404, 503],
  },
  {
    method: 'DELETE',
    path: '/v1/documents/{documentId}',
    operationId: 'deleteDmsDocument',
    policy: 'machine',
    scopes: ['dms:documents:write'],
    response: 'DocumentLifecycle',
    statuses: [200, 400, 401, 403, 404, 409, 412, 503],
  },
  {
    method: 'POST',
    path: '/v1/documents/{documentId}/restore',
    operationId: 'restoreDmsDocument',
    policy: 'machine',
    scopes: ['dms:documents:write'],
    request: 'EmptyCommand',
    response: 'DocumentLifecycle',
    idempotency: true,
    statuses: [200, 202, 400, 401, 403, 404, 409, 410, 412, 503],
  },

  {
    method: 'GET',
    path: '/v1/documents/{documentId}/permissions',
    operationId: 'getDmsDocumentPermissions',
    policy: 'machine',
    scopes: ['dms:documents:read'],
    response: 'DocumentPermissionsResponse',
    statuses: [200, 400, 401, 403, 404, 503],
  },
  {
    method: 'PUT',
    path: '/v1/documents/{documentId}/permissions',
    operationId: 'setDmsDocumentPermissions',
    policy: 'machine',
    scopes: ['dms:documents:write'],
    request: 'DocumentPermissions',
    response: 'DocumentPermissionsResponse',
    statuses: [200, 400, 401, 403, 404, 409, 412, 503],
  },

  {
    method: 'PATCH',
    path: '/v1/documents/{documentId}',
    operationId: 'editDmsDocument',
    policy: 'machine',
    scopes: ['dms:documents:write'],
    request: 'DocumentEdit',
    response: 'Document',
    statuses: [200, 400, 401, 403, 404, 409, 412, 503],
  },
  {
    method: 'POST',
    path: '/v1/documents/{documentId}/references',
    operationId: 'linkDmsDocumentReference',
    policy: 'machine',
    scopes: ['dms:documents:write'],
    request: 'DocumentReferenceInput',
    response: 'Document',
    statuses: [200, 400, 401, 403, 404, 409, 412, 503],
  },
  {
    method: 'DELETE',
    path: '/v1/documents/{documentId}/references/{referenceId}',
    operationId: 'unlinkDmsDocumentReference',
    policy: 'machine',
    scopes: ['dms:documents:write'],
    response: 'Document',
    statuses: [200, 400, 401, 403, 404, 409, 412, 503],
  },

  {
    method: 'POST',
    path: '/v1/documents/{documentId}/versions/uploads',
    operationId: 'beginDmsVersionUpload',
    policy: 'machine',
    scopes: ['dms:documents:write'],
    request: 'UploadBegin',
    response: 'UploadResponse',
    idempotency: true,
    statuses: [200, 201, 400, 401, 403, 404, 409, 410, 412, 429, 503],
  },
  {
    method: 'GET',
    path: '/v1/documents/{documentId}/versions',
    operationId: 'listDmsVersions',
    policy: 'machine',
    scopes: ['dms:documents:read'],
    response: 'VersionPage',
    statuses: [200, 400, 401, 403, 404, 503],
  },
  {
    method: 'GET',
    path: '/v1/documents/{documentId}/versions/{versionId}',
    operationId: 'getDmsVersion',
    policy: 'machine',
    scopes: ['dms:documents:read'],
    response: 'Version',
    statuses: [200, 400, 401, 403, 404, 503],
  },
  {
    method: 'POST',
    path: '/v1/documents/{documentId}/versions/{versionId}/restore',
    operationId: 'restoreDmsVersion',
    policy: 'machine',
    scopes: ['dms:documents:read', 'dms:documents:write'],
    request: 'RestoreVersion',
    response: 'UploadResponse',
    idempotency: true,
    statuses: [200, 202, 400, 401, 403, 404, 409, 410, 412, 429, 503],
  },

  {
    method: 'GET',
    path: '/v1/documents/{documentId}/download',
    operationId: 'getDmsDocumentDownload',
    policy: 'machine',
    scopes: ['dms:documents:read'],
    response: 'DownloadCapability',
    statuses: [200, 400, 401, 403, 404, 409, 503],
  },
  {
    method: 'POST',
    path: '/v1/uploads',
    operationId: 'beginDmsUpload',
    policy: 'machine',
    scopes: ['dms:documents:write'],
    response: 'UploadResponse',
    statuses: [200, 201, 400, 401, 403, 404, 409, 410, 413, 415, 429, 503],
    request: 'UploadBegin',
    idempotency: true,
  },
  {
    method: 'GET',
    path: '/v1/uploads/{uploadId}',
    operationId: 'getDmsUpload',
    policy: 'machine',
    scopes: ['dms:documents:read'],
    response: 'UploadStatus',
    statuses: [200, 400, 401, 403, 404, 503],
  },
  {
    method: 'POST',
    path: '/v1/uploads/{uploadId}/complete',
    operationId: 'completeDmsUpload',
    policy: 'machine',
    scopes: ['dms:documents:write'],
    response: 'UploadResponse',
    statuses: [202, 400, 401, 403, 404, 409, 410, 413, 415, 503],
    request: 'EmptyCommand',
    idempotency: true,
  },
  {
    method: 'POST',
    path: '/v1/uploads/{uploadId}/refresh',
    operationId: 'refreshDmsUpload',
    policy: 'machine',
    scopes: ['dms:documents:write'],
    response: 'UploadResponse',
    statuses: [200, 400, 401, 403, 404, 413, 415, 503],
    request: 'EmptyCommand',
  },
  {
    method: 'DELETE',
    path: '/v1/uploads/{uploadId}',
    operationId: 'cancelDmsUpload',
    policy: 'machine',
    scopes: ['dms:documents:write'],
    response: 'UploadResponse',
    statuses: [200, 400, 401, 403, 404, 503],
  },
  {
    method: 'POST',
    path: '/v1/upload-batches',
    operationId: 'createDmsUploadBatch',
    policy: 'machine',
    scopes: ['dms:documents:write'],
    response: 'BatchResponse',
    statuses: [200, 201, 400, 401, 403, 409, 410, 413, 415, 429, 503],
    request: 'BatchCreate',
    idempotency: true,
  },
  {
    method: 'GET',
    path: '/v1/upload-batches/{batchId}',
    operationId: 'getDmsUploadBatch',
    policy: 'machine',
    scopes: ['dms:documents:read'],
    response: 'BatchStatus',
    statuses: [200, 400, 401, 403, 404, 503],
  },
  {
    method: 'POST',
    path: '/v1/upload-batches/{batchId}/close',
    operationId: 'closeDmsUploadBatch',
    policy: 'machine',
    scopes: ['dms:documents:write'],
    response: 'BatchResponse',
    statuses: [200, 400, 401, 403, 404, 409, 410, 413, 415, 503],
    request: 'EmptyCommand',
    idempotency: true,
  },
  {
    method: 'DELETE',
    path: '/v1/upload-batches/{batchId}',
    operationId: 'cancelDmsUploadBatch',
    policy: 'machine',
    scopes: ['dms:documents:write'],
    response: 'BatchResponse',
    statuses: [200, 400, 401, 403, 404, 503],
  },
  {
    method: 'GET',
    path: '/v1/documents/{documentId}/audit',
    operationId: 'getDmsDocumentAudit',
    policy: 'machine',
    scopes: ['dms:documents:read', 'dms:audit:read'],
    response: 'AuditPage',
    statuses: [200, 400, 401, 403, 404, 503],
  },
  {
    method: 'GET',
    path: '/v1/documents',
    operationId: 'listDmsDocuments',
    policy: 'machine',
    scopes: ['dms:documents:read'],
    response: 'DocumentPage',
    statuses: [200, 400, 401, 403, 503],
  },
  {
    method: 'GET',
    path: '/v1/documents/{documentId}',
    operationId: 'getDmsDocument',
    policy: 'machine',
    scopes: ['dms:documents:read'],
    response: 'Document',
    statuses: [200, 400, 401, 403, 404, 503],
  },
  {
    method: 'GET',
    path: '/v1/admission-policy',
    operationId: 'getDmsAdmissionPolicy',
    policy: 'machine',
    scopes: ['dms:documents:read'],
    response: 'AdmissionPolicy',
    statuses: [200, 400, 401, 403, 503],
  },
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
