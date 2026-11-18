import { DMS_ERROR_STATUS, DMS_PUBLIC_ROUTES, dmsPublicJsonSchemas } from './public.js';

const applicationId = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';
const descriptor = {
  title: 'Private candidate',
  fileName: 'report.txt',
  size: 10,
  contentType: 'text/plain',
  profile: 'secure-only',
  metadata: { category: 'report' },
};
const uploadStatus = {
  id: applicationId,
  documentId: applicationId,
  versionId: tenantId,
  upload: 'INITIATED',
  security: 'PENDING',
  availability: 'CANDIDATE',
  processing: 'NOT_SCHEDULED',
  completionRequested: false,
  expiresAt: '2026-11-06T12:00:00Z',
  replayUntil: '2026-11-06T12:00:00Z',
  size: 10,
  contentType: 'text/plain',
  failure: null,
  retryAfterSeconds: null,
};
const batchStatus = {
  id: applicationId,
  state: 'OPEN',
  expiresAt: '2026-11-06T12:00:00Z',
  total: 1,
  counts: {
    items: { UNSTARTED: 1, BOUND: 0, CLOSED: 0, CANCELLED: 0, EXPIRED: 0 },
    upload: { INITIATED: 0, OBJECT_VERIFIED: 0, COMPLETED: 0, EXPIRED: 0, CANCELLED: 0, FAILED: 0 },
    security: { PENDING: 0, PASSED: 0, REJECTED: 0, INCONCLUSIVE: 0, INVALIDATED: 0 },
    availability: { CANDIDATE: 0, AVAILABLE: 0, UNAVAILABLE: 0 },
    processing: { NOT_SCHEDULED: 0 },
  },
  items: [
    {
      itemId: 'report-1',
      operation: 'create',
      fileName: 'report.txt',
      state: 'UNSTARTED',
      session: null,
      admissionError: null,
      retryAfterSeconds: null,
    },
  ],
  nextCursor: null,
};
const documentSummary = {
  id: applicationId,
  applicationId,
  title: 'Private upload candidate',
  tags: [],
  fileName: 'report.txt',
  lifecycle: 'ACTIVE',
  revision: '1',
  currentVersionId: null,
  downloadable: false,
  searchable: false,
};
const processingRun = {
  id: applicationId,
  documentId: applicationId,
  versionId: tenantId,
  number: 1,
  profile: 'searchable',
  sourceSha256: 'a'.repeat(64),
  state: 'QUEUED',
  active: false,
  indexStatus: 'PENDING',
  manifest: null,
  createdAt: '2026-11-05T12:00:00Z',
  completedAt: null,
};
const resultManifest = {
  schemaVersion: 1,
  documentId: applicationId,
  versionId: tenantId,
  runId: applicationId,
  generation: 1,
  lifecycleGeneration: 1,
  sourceSha256: 'a'.repeat(64),
  contentType: 'text/plain',
  profile: 'searchable',
  stage: 'native',
  processor: 'utf8',
  processorVersion: 'python-3.13.18',
  configurationVersion: 'native-extraction-v1',
  status: 'SUCCEEDED',
  code: 'OK',
  languages: [],
  coverage: { attempted: 1, completed: 1, omitted: 0, ocrNeeded: 0 },
  warnings: [],
  completedAt: '2026-11-05T12:00:00Z',
};
export const dmsPublicExamples = {
  DiscoveryRequest: { q: 'quarterly report', limit: 20 },
  DiscoveryPage: { language: 'en', untrusted: true, items: [], nextCursor: null },
  ExtractionManifest: resultManifest,
  ExtractionArtifact: {
    manifest: resultManifest,
    units: [
      {
        id: 'line:1',
        kind: 'line',
        state: 'TEXT',
        text: 'Untrusted extracted source text',
        source: { index: 1, offset: 0 },
        warnings: [],
      },
    ],
    metadata: {},
  },
  ProcessingRun: processingRun,
  ProcessingHistory: {
    documentId: applicationId,
    versionId: tenantId,
    activeRunId: null,
    indexStatus: 'NOT_INDEXED',
    items: [processingRun],
    nextCursor: null,
  },
  ProcessingContent: {
    run: {
      ...processingRun,
      state: 'SUCCEEDED',
      active: true,
      manifest: resultManifest,
      completedAt: resultManifest.completedAt,
    },
    untrusted: true,
    artifacts: [
      {
        schemaVersion: 1,
        kind: 'extraction-json',
        size: 1000,
        sha256: 'b'.repeat(64),
        method: 'GET',
        url: 'https://files.example.test/dms-artifacts/object?X-Amz-Signature=example-issued-per-request',
        expiresAt: '2026-11-05T12:02:00Z',
      },
    ],
  },
  Reprocess: { profile: 'searchable' },
  ReprocessResponse: {
    operationId: applicationId,
    run: processingRun,
    replayUntil: '2026-11-06T12:00:00Z',
  },

  DocumentLifecycle: {
    documentId: applicationId,
    revision: '1',
    lifecycle: 'ACTIVE',
    generation: 1,
    deletedAt: null,
    restoreDeadline: null,
    restoredAt: null,
    currentVersionId: null,
    downloadable: false,
    restoration: { state: 'NOT_REQUESTED', pending: 0, scanning: 0, completed: 0, failed: 0 },
  },
  DocumentPermissions: { grants: [] },
  DocumentPermissionsResponse: { documentId: applicationId, revision: '1', grants: [] },
  DocumentEdit: { title: 'Updated report', tags: ['report'] },
  DocumentReferenceInput: { namespace: 'erp', type: 'invoice', externalId: 'INV-1' },
  UploadBegin: descriptor,
  Version: {
    uploadId: applicationId,
    upload: 'COMPLETED',
    id: tenantId,
    documentId: applicationId,
    number: 1,
    fileName: 'report.txt',
    contentType: 'text/plain',
    size: 10,
    sha256: 'a'.repeat(64),
    availability: 'AVAILABLE',
    security: 'PASSED',
    isCurrent: true,
    downloadable: true,
    restoredFromVersionId: null,
    createdAt: '2026-11-05T12:00:00Z',
  },
  VersionPage: { items: [], nextCursor: null },
  RestoreVersion: { profile: 'secure-only' },
  DownloadCapability: {
    documentId: applicationId,
    versionId: tenantId,
    url: 'https://files.example.test/dms-originals/object?X-Amz-Signature=example-issued-per-request',
    method: 'GET',
    fileName: 'report.txt',
    contentType: 'application/octet-stream',
    size: 10,
    sha256: 'a'.repeat(64),
    expiresAt: '2026-11-05T12:02:00Z',
  },
  EmptyCommand: {},
  UploadStatus: uploadStatus,
  UploadResponse: {
    operationId: applicationId,
    session: uploadStatus,
    transfer: {
      url: `https://files.example.test/dms-staging/${tenantId}/${applicationId}/33333333-3333-4333-8333-333333333333?X-Amz-Signature=example-issued-per-request`,
      method: 'PUT',
      headers: { 'content-type': 'text/plain', 'if-none-match': '*' },
      size: 10,
      expiresAt: '2026-11-05T12:15:00Z',
    },
  },
  BatchCreate: { items: [{ itemId: 'report-1', operation: 'create', descriptor }] },
  BatchStatus: batchStatus,
  BatchResponse: { operationId: applicationId, batch: batchStatus },
  Document: {
    ...documentSummary,
    metadata: { category: 'report' },
    references: [],
    createdAt: '2026-11-05T12:00:00Z',
  },
  DocumentPage: { items: [documentSummary], nextCursor: null },
  AdmissionPolicy: {
    version: 1,
    revision: '1',
    state: 'not-installed',
    limits: {
      maxFileBytes: 52428800,
      metadataBytes: 16384,
      uploadControlBytes: 32768,
      batchManifestBytes: 262144,
      batchControlBytes: 266240,
      activePerApplication: 4,
      activePerTenant: 16,
      queuedWork: 100,
    },
    formats: [],
    profiles: [],
  },
  AuditEvent: {
    id: applicationId,
    applicationId,
    resourceType: 'application',
    resourceId: applicationId,
    action: 'application.enrolled',
    actor: { kind: 'machine', id: 'independent-backend' },
    assertedHuman: null,
    requestId: applicationId,
    createdAt: '2026-11-05T12:00:00Z',
  },
  AuditPage: { items: [], nextCursor: null },
  AuditQuery: { limit: '50' },
  ServiceInfo: { name: 'Thaarei DMS API' },
  EnrollmentRequest: { name: 'Independent backend' },
  EnrollmentResponse: {
    applicationId,
    tenantId,
    status: 'active',
    receiptId: '33333333-3333-4333-8333-333333333333',
    replayUntil: '2026-11-05T12:00:00Z',
  },
  CapabilitiesResponse: {
    contractVersion: 1,
    applicationId,
    tenantId,
    operations: ['application-enrollment', 'capabilities:read'],
    formats: [],
    profiles: [],
    languages: [],
    limits: { accessTokenSeconds: 300, idempotencyWindowSeconds: 86400 },
  },
  DmsError: { code: 'MACHINE_TOKEN_REQUIRED', requestId: applicationId, retryable: false },
  IdempotencyKey: applicationId,
  ResourceETag: '"1"',
  RetryAfterSeconds: 2,
  RequestId: applicationId,
};
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const commonHeaders = {
  'X-Request-Id': {
    description: 'Server-generated UUID; untrusted caller IDs are not reflected.',
    schema: ref('RequestId'),
    example: applicationId,
  },
  'Cache-Control': {
    description: 'Sensitive control responses are never cached.',
    schema: { type: 'string', const: 'private, no-store' },
    example: 'private, no-store',
  },
};
const retryHeader = {
  description:
    'Seconds before retry. Temporary unavailability, capacity pressure and in-flight receipt/admission conflicts include retry guidance; inspect the error code and retryable flag.',
  schema: ref('RetryAfterSeconds'),
  example: 1,
};

type Route = (typeof DMS_PUBLIC_ROUTES)[number];
function successExample(route: Route) {
  if (route.response === 'DocumentLifecycle') {
    const deleted = {
      ...dmsPublicExamples.DocumentLifecycle,
      lifecycle: 'SOFT_DELETED',
      generation: 2,
      revision: '2',
      deletedAt: '2026-11-05T12:00:00Z',
      restoreDeadline: '2026-12-05T12:00:00Z',
    };
    if (route.operationId === 'deleteDmsDocument') return deleted;
    if (route.operationId === 'restoreDmsDocument')
      return {
        ...deleted,
        lifecycle: 'ACTIVE',
        generation: 3,
        revision: '3',
        restoredAt: '2026-11-05T12:01:00Z',
        restoration: { state: 'PENDING', pending: 1, scanning: 0, completed: 0, failed: 0 },
      };
  }

  if (route.operationId === 'completeDmsUpload')
    return {
      operationId: applicationId,
      session: { ...uploadStatus, completionRequested: true, retryAfterSeconds: 2 },
      transfer: null,
    };
  if (route.operationId === 'cancelDmsUpload')
    return {
      operationId: applicationId,
      session: { ...uploadStatus, upload: 'CANCELLED', failure: 'CANCELLED' },
      transfer: null,
    };
  if (route.operationId === 'closeDmsUploadBatch' || route.operationId === 'cancelDmsUploadBatch') {
    const state = route.operationId === 'closeDmsUploadBatch' ? 'CLOSED' : 'CANCELLED';
    return {
      operationId: applicationId,
      batch: {
        ...batchStatus,
        state,
        counts: {
          ...batchStatus.counts,
          items: {
            UNSTARTED: 0,
            BOUND: 0,
            CLOSED: state === 'CLOSED' ? 1 : 0,
            CANCELLED: state === 'CANCELLED' ? 1 : 0,
            EXPIRED: 0,
          },
        },
        items: batchStatus.items.map((item) => ({ ...item, state })),
      },
    };
  }
  return dmsPublicExamples[route.response];
}
const summaries: Record<string, string> = {
  getDmsDocumentLifecycle: 'Inspect owner-only logical lifecycle and restore progress',
  deleteDmsDocument: 'Soft-delete an owned document and fence former work',
  restoreDmsDocument: 'Restore logical identity and reassess retained originals',
  getDmsDocumentPermissions: 'Read owner-managed application grants',
  setDmsDocumentPermissions: 'Replace explicit application grants with expected revision',
  editDmsDocument: 'Edit logical title, metadata and tags without a binary revision',
  linkDmsDocumentReference: 'Link an opaque application-namespaced business reference',
  unlinkDmsDocumentReference: 'Remove an owned document reference',
  beginDmsVersionUpload: 'Admit a new binary revision with expected document revision',
  listDmsVersions: 'List authorized version history',
  getDmsVersion: 'Inspect an authorized version and security status',
  searchDmsDocuments:
    'Discover current safe documents with live READ rights and bounded English source chunks',
  getDmsProcessing: 'Read authorized version-bound run history and active result',
  getDmsContent: 'Read the exact accepted result and bounded artifact capability',
  reprocessDmsVersion: 'Request an owner-authorized bounded replacement run',
  restoreDmsVersion: 'Create a new reassessed revision referencing protected historical bytes',
  beginDmsUpload: 'Admit and begin a single-PUT upload',
  getDmsUpload: 'Inspect an owned upload session',
  completeDmsUpload: 'Record completion intent (not security approval)',
  refreshDmsUpload: 'Refresh an eligible session capability',
  cancelDmsUpload: 'Cancel an eligible pending upload',
  createDmsUploadBatch: 'Create a bounded manifest without documents or transfer authority',
  getDmsUploadBatch: 'Read per-stage counts and paginated item outcomes',
  closeDmsUploadBatch: 'Close a batch to new sessions',
  cancelDmsUploadBatch: 'Cancel unstarted and eligible pending batch items',
  getDmsServiceInfo: 'Read service identity',
  getDmsCapabilities: 'Read installed capabilities',
  enrollDmsApplication: 'Enroll a privately registered consumer (CLI/backend only)',
  getDmsDocument: 'Inspect an authorized logical document',
  getDmsDocumentDownload: 'Issue a short-lived capability for the current assessed original',
  listDmsDocuments: 'List authorized logical documents',
  getDmsAdmissionPolicy: 'Read effective admission policy',
  getDmsAudit: 'Read own application audit',
  getDmsDocumentAudit: 'Read owned document audit',
};
function operation(route: Route) {
  const paged = [
    'getDmsAudit',
    'getDmsDocumentAudit',
    'listDmsDocuments',
    'getDmsUploadBatch',
    'listDmsVersions',
    'getDmsProcessing',
  ].includes(route.operationId);
  const audit = route.response === 'AuditPage';
  const parameters = [
    ...(route.operationId === 'getDmsContent'
      ? [
          {
            in: 'query',
            name: 'runId',
            required: false,
            schema: { type: 'string', format: 'uuid' },
            description: 'Exact accepted run within the selected version; never falls back.',
          },
        ]
      : []),
    ...(route.operationId === 'listDmsDocuments'
      ? ['fileName', 'title', 'tag', 'referenceNamespace', 'referenceType', 'referenceId'].map(
          (name) => ({
            in: 'query',
            name,
            required: false,
            schema: { type: 'string' },
            description:
              'Exact case-sensitive filter. Reference namespace/type/id must be supplied together. Filters are bound into pagination cursors; arbitrary metadata filters are unsupported.',
          }),
        )
      : []),
    ...([
      'deleteDmsDocument',
      'restoreDmsDocument',
      'setDmsDocumentPermissions',
      'editDmsDocument',
      'linkDmsDocumentReference',
      'unlinkDmsDocumentReference',
      'beginDmsVersionUpload',
      'restoreDmsVersion',
    ].includes(route.operationId)
      ? [
          {
            in: 'header',
            name: 'If-Match',
            required: true,
            schema: ref('ResourceETag'),
            description:
              'Expected logical document revision; identical idempotent replays preserve identity after current authorization.',
          },
        ]
      : []),
    ...(['getDmsDocumentDownload', 'getDmsProcessing', 'getDmsContent'].includes(route.operationId)
      ? [
          {
            in: 'query',
            name: 'versionId',
            required: false,
            schema: { type: 'string', format: 'uuid' },
            description: 'Explicit available historical version; omitted means current.',
          },
        ]
      : []),
    ...Array.from(route.path.matchAll(/\{([^}]+)\}/g), (match) => ({
      in: 'path',
      name: match[1],
      required: true,
      schema: { type: 'string', format: 'uuid' },
    })),
    ...('idempotency' in route || route.policy === 'enrollment'
      ? [
          {
            in: 'header',
            name: 'Idempotency-Key',
            required: true,
            schema: ref('IdempotencyKey'),
            example: applicationId,
          },
        ]
      : []),
    ...(paged
      ? [
          {
            in: 'query',
            name: 'limit',
            required: false,
            schema: {
              type: 'integer',
              minimum: 1,
              maximum: audit ? 100 : 50,
              default: audit ? 50 : 20,
            },
          },
          {
            in: 'query',
            name: 'cursor',
            required: false,
            schema: { type: 'string', maxLength: 2048 },
            description:
              'Opaque signed cursor bound to current tenant/application/resource; each page reauthorizes.',
          },
        ]
      : []),
  ];
  return {
    operationId: route.operationId,
    summary: summaries[route.operationId],
    'x-dms-policy': route.policy,
    'x-required-scopes': route.scopes,
    'x-browser-execution': route.method === 'GET',
    description: ['getDmsProcessing', 'getDmsContent', 'reprocessDmsVersion'].includes(
      route.operationId,
    )
      ? 'Current READ authorization, active lifecycle and passed source security are required. Omit versionId for current; explicit version/run selectors never fall back to another identity. Artifact GET capabilities expire within 120 seconds and are private/no-store. Extracted text/layout is untrusted data, never an instruction or business-field mutation. Reprocessing requires owner authority plus read/write scopes and Idempotency-Key; current profile/type policy, capacity and queued-work limits apply. It allocates no binary version. Pending or failed replacement retains the previous accepted active result; indexing is not installed until I17.'
      : ['getDmsDocumentPermissions', 'setDmsDocumentPermissions'].includes(route.operationId)
        ? 'Owner-only application grant management under current API scope ceilings. PUT requires strong If-Match and replaces up to 64 active same-installation consumer targets with independent READ, EDIT_METADATA and ADD_VERSION rights; an empty list revokes all. Accepted changes increment the logical revision and append attributed audit atomically. Grants never transfer ownership or confer audit, lifecycle restoration, reprocessing or permission-management authority.'
        : ['editDmsDocument', 'linkDmsDocumentReference', 'unlinkDmsDocumentReference'].includes(
              route.operationId,
            )
          ? 'Requires the current strong If-Match revision. Updates logical metadata only; no binary revision is allocated. References are opaque identifiers scoped to this tenant and creating application; they grant no access and cause no external fetch. Duplicate links return the current document without a mutation; missing unlink targets return 404. Each accepted mutation increments the logical revision and appends attributed audit atomically.'
          : ['beginDmsVersionUpload', 'restoreDmsVersion'].includes(route.operationId)
            ? 'Allocate a monotonically numbered candidate, preserving the current available original. If-Match and Idempotency-Key are required. A restore references the exact protected historical object, checks integrity/current policy and requires a fresh security pass before publication. It charges work/scratch but never duplicate physical bytes.'
            : route.operationId === 'getDmsDocumentDownload'
              ? 'Returns JSON, never a redirect. Live READ rights (ownership or an explicit grant), active application/lifecycle, current available version and accepted security evidence are required. Omit versionId for current; explicitly selecting history rechecks the same live eligibility. The signed GET expires within 120 seconds, uses attachment/octet-stream and supports one byte range. Issuance is audited separately from byte retrieval; previously issued URLs can remain usable until expiry after disablement/invalidation. Never log or persist capability URLs.'
              : route.policy === 'public'
                ? 'Unauthenticated service identity; no registration or scope is required.'
                : route.policy === 'enrollment'
                  ? 'Backend-only bound enrollment. Identical retries return the same receipt for 24 hours after current authorization; changed bodies conflict.'
                  : route.operationId === 'completeDmsUpload'
                    ? 'Persists accepted completion intent and returns 202 with status location. No HEAD verification, security approval or publication is implied. Cancellation/expiry remains authoritative.'
                    : route.operationId === 'beginDmsUpload'
                      ? 'Current access, installed profile/type, policy and capacity are required. Same key/body preserves session identity for 24 hours; changed bodies conflict. Replay may mint a fresh capability only for the same eligible session. Exact known-size single PUT with Content-Type, Content-Length and If-None-Match: *; browser sets Content-Length automatically. A repeated PUT may return 412: inspect and complete this session, never overwrite.'
                      : route.operationId === 'getDmsUploadBatch'
                        ? 'Per-stage counts cover the whole batch; item list is paginated. Admission errors/retry guidance are per file. A group is not an assertion of file availability.'
                        : 'Current registration, scope and owner policy are checked on every call and retry. Cookies and explorer credentials grant no machine access. Signed capabilities are never persisted in receipts.',
    security:
      route.policy === 'public'
        ? []
        : route.policy === 'enrollment'
          ? [{ MachineBearer: [], EnrollmentKey: [] }]
          : [{ MachineBearer: [] }],
    parameters:
      route.operationId === 'getDmsCapabilities'
        ? [
            ...parameters,
            {
              in: 'header',
              name: 'Prefer',
              required: false,
              schema: { type: 'string', enum: ['include-deployment-status'] },
              description:
                'Opt in to the safe deploymentAccess field. Omit to preserve the ordinary version-1 response shape for strict decoders. No central credentials or signed proof are returned.',
            },
          ]
        : parameters,
    ...('request' in route
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: ref(route.request),
                example: dmsPublicExamples[route.request],
              },
            },
          },
        }
      : {}),
    responses: Object.fromEntries(
      route.statuses.map((status) => {
        const success = status < 300;
        const code = Object.entries(DMS_ERROR_STATUS).find(([, statuses]) =>
          (statuses as readonly number[]).includes(status),
        )?.[0];
        const description = !success
          ? `Controlled DMS error (${status}); see finite codes and retryable flag.`
          : route.policy === 'public'
            ? 'Public service identity.'
            : route.policy === 'enrollment'
              ? status === 201
                ? 'Enrollment activation and receipt committed atomically.'
                : 'Authenticated identical enrollment replay.'
              : route.operationId === 'getDmsCapabilities'
                ? 'Installed capabilities and verified application context.'
                : [
                      'ProcessingRun',
                      'ProcessingHistory',
                      'ProcessingContent',
                      'ReprocessResponse',
                    ].includes(route.response)
                  ? status === 202
                    ? 'Replacement run admitted; follow Location. Prior accepted active results remain available while this run is pending or fails.'
                    : 'Currently authorized version/run state; capabilities reference only this accepted artifact. Indexing is independently not installed.'
                  : route.response === 'DownloadCapability'
                    ? 'Audited short-lived signed GET for the exact current assessed original; possession authorizes byte retrieval until expiry.'
                    : status === 202
                      ? 'Completion intent accepted; inspect status. Security remains pending and candidate unavailable.'
                      : route.response.startsWith('Upload')
                        ? 'Current upload state with separate pending security and candidate availability; capability is present only when eligible.'
                        : route.response.startsWith('Batch')
                          ? 'Current authorized batch state and independent per-file outcomes; manifest creation grants no transfer authority.'
                          : route.response === 'AdmissionPolicy'
                            ? 'Versioned effective policy and installed/enabled catalog.'
                            : route.response === 'AuditPage'
                              ? 'Bounded current owner-only resource audit.'
                              : 'Authorized logical registry state; no available version is implied.';
        return [
          status,
          {
            description,
            headers: {
              ...commonHeaders,
              ...(status === 200 &&
              ['Document', 'DocumentPermissionsResponse', 'DocumentLifecycle'].includes(
                route.response,
              )
                ? { ETag: { description: 'Current logical revision', schema: ref('ResourceETag') } }
                : {}),
              ...(status === 401
                ? {
                    'WWW-Authenticate': { schema: { type: 'string', const: 'Bearer realm="dms"' } },
                  }
                : {}),
              ...([202, 429, 503].includes(status) ||
              (status === 409 && route.response !== 'DownloadCapability')
                ? { 'Retry-After': retryHeader }
                : {}),
              ...(status === 202 || status === 201
                ? {
                    Location: {
                      schema: { type: 'string', format: 'uri-reference' },
                      description: 'Same-origin resource/status location.',
                    },
                  }
                : {}),
            },
            content: {
              'application/json': {
                schema: ref(success ? route.response : 'DmsError'),
                example: success
                  ? successExample(route)
                  : { code, requestId: applicationId, retryable: status === 503 || status === 429 },
              },
            },
          },
        ];
      }),
    ),
  };
}
const generatedPaths: Record<string, Record<string, ReturnType<typeof operation>>> = {};
for (const route of DMS_PUBLIC_ROUTES) {
  const methods = generatedPaths[route.path] ?? {};
  methods[route.method.toLowerCase()] = operation(route);
  generatedPaths[route.path] = methods;
}

export const dmsPublicOpenApi = {
  openapi: '3.1.0',
  jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
  info: {
    title: 'Thaarei DMS consumer API',
    version: '1.4.0',
    description:
      'Implemented consumer control routes only. Obtain short-lived machine tokens outside the browser. Identity sessions do not authorize DMS calls. Enrollment is CLI/backend-only; no document or processing feature is advertised before implementation.',
  },
  servers: [{ url: '/' }],
  paths: generatedPaths,
  components: {
    securitySchemes: {
      MachineBearer: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'RS256 at+jwt',
        description:
          'Backend client-credentials token for the exact DMS audience, lasting at most 300 seconds. Never enter a machine client secret here.',
      },
      EnrollmentKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Thaarei-Enrollment-Key',
        description:
          'Private CLI/backend enrollment only. Browser execution is disabled for enrollment.',
      },
    },
    schemas: dmsPublicJsonSchemas,
    headers: {
      ResourceETag: {
        description:
          'Document reads expose strong quoted positive decimal revision ETags; owning mutable routes apply If-Match.',
        schema: ref('ResourceETag'),
      },
      RetryAfter: retryHeader,
      OperationLocation: {
        description:
          'Accepted completion intents provide a same-origin status URL and Retry-After; acceptance is not publication.',
        schema: { type: 'string', format: 'uri-reference' },
      },
    },
  },
};
