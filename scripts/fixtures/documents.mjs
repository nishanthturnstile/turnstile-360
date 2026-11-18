import { dmsPublicExamples } from '../../packages/dms-contracts/dist/openapi.js';
import { DOCUMENTS_ROUTES } from '../../packages/turnstile-contracts/dist/documents.js';

const id = '10000000-0000-4000-8000-000000000001';
export const documentsExamples = {
  DocumentsValidationChecklist: {
    items: DOCUMENTS_ROUTES.map(({ evidenceId, product }) => ({
      evidenceId,
      allowedByProductRole: product !== null,
      expected: 'Read back the current authorized outcome.',
    })),
  },
  DocumentsServiceIdentity: dmsPublicExamples.ServiceInfo,
  DocumentsConnection: {
    contractVersion: 1,
    productAccess: 'full',
    dmsAccess: 'full',
    effectiveOperations: ['capabilities:read'],
    formats: ['text/plain'],
    profiles: ['secure-only'],
    languages: ['en'],
    admission: dmsPublicExamples.AdmissionPolicy,
  },
  DocumentsCommand: {
    kind: 'upload.begin',
    payload: {
      title: 'Validation file',
      fileName: 'validation.txt',
      contentType: 'text/plain',
      size: 8,
      profile: 'secure-only',
      metadata: {},
      sha256: 'a'.repeat(64),
    },
  },
  DocumentsDraftRequest: { mode: 'ordinary', command: { kind: 'upload.complete', uploadId: id } },
  DocumentsExecuteRequest: { digest: 'a'.repeat(64) },
  DocumentsIntentReceipt: {
    id,
    digest: 'a'.repeat(64),
    kind: 'upload.complete',
    state: 'ACKNOWLEDGED',
    acknowledgement: 'accepted',
    visibility: 'local_receipt_only',
    createdAt: '2026-11-17T10:00:00Z',
    reconciliationUntil: '2026-11-18T09:00:00Z',
  },
  DocumentsValidatorCommand: {
    action: 'grant',
    key: id,
    expectedAccessRevision: 0,
    operatorId: 'example-operator',
    operatorUserId: 'example-administrator',
    operatorCookie: 'synthetic-session-proof',
    targetUserId: 'example-validator',
    targetCookie: 'synthetic-target-proof',
    roleId: id,
    scope: 'company',
    reason: 'Reviewed validator access',
    permissions: ['turnstile:access', 'turnstile:documents:validate', 'turnstile:documents:upload'],
    activateV3Barrier: true,
  },
  DocumentsError: { code: 'DOCUMENTS_INTENT_GONE', requestId: id, guidance: 'manual_review' },
};

const { applicationId: _applicationId, ...document } = dmsPublicExamples.Document;
documentsExamples.DocumentsSummary = {
  id: document.id,
  title: document.title,
  tags: document.tags,
  fileName: document.fileName,
  lifecycle: document.lifecycle,
  revision: document.revision,
  currentVersionId: document.currentVersionId,
  downloadable: document.downloadable,
  searchable: document.searchable,
  ownership: 'owned',
};
documentsExamples.DocumentsDetail = { ...document, ownership: 'owned' };
documentsExamples.DocumentsPage = { items: [documentsExamples.DocumentsSummary], nextCursor: null };
documentsExamples.DocumentsListQuery = { title: 'Validation file' };
documentsExamples.DocumentsProcessingQuery = { versionId: id, limit: '20' };
documentsExamples.DocumentsProcessingHistory = dmsPublicExamples.ProcessingHistory;
documentsExamples.DocumentsContentQuery = { versionId: id, runId: id };
documentsExamples.DocumentsContent = dmsPublicExamples.ProcessingContent;
documentsExamples.DocumentsExtractionArtifact = dmsPublicExamples.ExtractionArtifact;
documentsExamples.DocumentsSearchQuery = { ...dmsPublicExamples.DiscoveryRequest, limit: '20' };
documentsExamples.DocumentsSearchPage = dmsPublicExamples.DiscoveryPage;

documentsExamples.DocumentsUploadCommand = documentsExamples.DocumentsCommand;
documentsExamples.DocumentsWorkspaceCommand = {
  kind: 'document.edit',
  documentId: document.id,
  expectedRevision: document.revision,
  payload: { title: 'Reviewed validation file', tags: ['reviewed'], metadata: { reviewed: true } },
};
documentsExamples.DocumentsVersion = dmsPublicExamples.Version;
documentsExamples.DocumentsVersionPage = { items: [dmsPublicExamples.Version], nextCursor: null };
documentsExamples.DocumentsVersionQuery = { limit: '10' };
documentsExamples.DocumentsDownloadQuery = { versionId: dmsPublicExamples.Version.id };
documentsExamples.DocumentsBatchPayload = {
  items: [
    {
      itemId: 'text-1',
      operation: 'create',
      descriptor: documentsExamples.DocumentsCommand.payload,
    },
  ],
};
documentsExamples.DocumentsBatchStatus = dmsPublicExamples.BatchStatus;
documentsExamples.DocumentsLifecycle = dmsPublicExamples.DocumentLifecycle;
documentsExamples.DocumentsGrantList = dmsPublicExamples.DocumentPermissionsResponse;
documentsExamples.DocumentsAuditPage = dmsPublicExamples.AuditPage;
documentsExamples.DocumentsAuditQuery = dmsPublicExamples.AuditQuery;
documentsExamples.DocumentsBatchManifest = {
  id,
  items: [
    {
      itemId: 'text-1',
      operation: 'create',
      fileName: 'validation.txt',
      size: 8,
      sha256: 'a'.repeat(64),
    },
  ],
};
documentsExamples.DocumentsUploadReceipt = {
  receipt: { ...documentsExamples.DocumentsIntentReceipt, state: 'RESOLVED' },
  uploadId: id,
  file: null,
};
documentsExamples.DocumentsUploadExecution = {
  ...documentsExamples.DocumentsUploadReceipt,
  transfer: null,
};
documentsExamples.DocumentsUploadHistory = [documentsExamples.DocumentsUploadReceipt];
documentsExamples.DocumentsUploadStatus = dmsPublicExamples.UploadStatus;
documentsExamples.DocumentsOriginalDownload = dmsPublicExamples.DownloadCapability;
