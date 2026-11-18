import {
  admissionPolicyProjectionSchema,
  auditPageSchema,
  auditQuerySchema,
  batchCreateSchema,
  batchResponseSchema,
  batchStatusSchema,
  type CapabilitiesResponse,
  capabilitiesResponseSchema,
  type DmsErrorCode,
  discoveryPageSchema,
  discoveryRequestSchema,
  dmsErrorSchema,
  documentEditSchema,
  documentListQuerySchema,
  documentPageSchema,
  documentPermissionsResponseSchema,
  documentPermissionsSchema,
  documentQuerySchema,
  documentReferenceInputSchema,
  documentResponseSchema,
  downloadCapabilitySchema,
  type EnrollmentRequest,
  type EnrollmentResponse,
  enrollmentRequestSchema,
  enrollmentResponseSchema,
  lifecycleResponseSchema,
  processingContentSchema,
  processingHistorySchema,
  processingQuerySchema,
  reprocessResponseSchema,
  reprocessSchema,
  restoreVersionSchema,
  resultQuerySchema,
  serviceInfoSchema,
  uploadBeginSchema,
  uploadResponseSchema,
  uploadStatusSchema,
  versionPageSchema,
  versionSchema,
} from '@thaarei/dms-contracts/public';
import { DmsClientError, fixedUrl, jsonRequest, timeout } from './http.js';
import type { MachineTokenProvider } from './tokens.js';

export interface DmsActorContext {
  userId: string;
  requestId: string;
  deadlineAt?: number;
}

export class DmsClient {
  private readonly baseUrl: string;
  private readonly provider: MachineTokenProvider;
  private readonly transport: typeof fetch;
  private readonly timeoutMs: number;
  constructor(options: {
    baseUrl: string;
    tokenProvider: MachineTokenProvider;
    allowInsecureHttp?: boolean;
    transport?: typeof fetch;
    timeoutMs?: number;
  }) {
    this.baseUrl = fixedUrl(options.baseUrl, options.allowInsecureHttp ?? false);
    if (new URL(this.baseUrl).pathname !== '/v1')
      throw new DmsClientError('DMS_CONFIGURATION_INVALID');
    this.provider = options.tokenProvider;
    this.transport = options.transport ?? fetch;
    this.timeoutMs = timeout(options.timeoutMs);
  }

  async capabilities(
    actor?: DmsActorContext,
    options: { deploymentStatus?: boolean } = {},
  ): Promise<CapabilitiesResponse> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.deploymentStatus) headers.prefer = 'include-deployment-status';
    if (actor) {
      if (
        !/^[A-Za-z0-9_-]{1,200}$/.test(actor.userId) ||
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(actor.requestId)
      )
        throw new DmsClientError('DMS_REQUEST_INVALID');
      headers['x-thaarei-actor-id'] = actor.userId;
      headers['x-thaarei-request-id'] = actor.requestId;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.machineToken();
      const result = await jsonRequest(
        `${this.baseUrl}/capabilities`,
        {
          method: 'GET',
          headers: { ...headers, authorization: `Bearer ${token.accessToken}` },
        },
        this.transport,
        this.timeoutMs,
      );
      const error = dmsErrorSchema.safeParse(result.body);
      if (
        attempt === 0 &&
        result.status === 401 &&
        error.success &&
        error.data.code === 'MACHINE_TOKEN_EXPIRED'
      ) {
        try {
          this.provider.invalidate(token);
        } catch {
          throw new DmsClientError('DMS_UNAVAILABLE');
        }
        continue;
      }
      this.assertSuccess(result.status, error.success ? error.data.code : undefined);
      const parsed = capabilitiesResponseSchema.safeParse(result.body);
      if (!parsed.success) throw new DmsClientError('DMS_INVALID_RESPONSE');
      return parsed.data;
    }
    throw new DmsClientError('DMS_MACHINE_AUTH_FAILED', 401);
  }

  // Finite consumer reads. No caller-selected host, method or arbitrary path.
  documentsCapabilities(actor: DmsActorContext) {
    return this.readControl('/capabilities', capabilitiesResponseSchema, actor, undefined, {
      prefer: 'include-deployment-status',
    });
  }
  admissionPolicy(actor: DmsActorContext) {
    return this.readControl('/admission-policy', admissionPolicyProjectionSchema, actor);
  }
  serviceInfo(actor: DmsActorContext) {
    return this.readControl('', serviceInfoSchema, actor);
  }
  async documents(query: ReturnType<typeof documentListQuerySchema.parse>, actor: DmsActorContext) {
    const parsed = documentListQuerySchema.safeParse(query);
    if (!parsed.success) throw new DmsClientError('DMS_REQUEST_INVALID');
    return this.readControl('/documents', documentPageSchema, actor, parsed.data);
  }
  async document(id: string, actor: DmsActorContext) {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id))
      throw new DmsClientError('DMS_REQUEST_INVALID');
    return this.readControl(`/documents/${id}`, documentResponseSchema, actor);
  }
  lifecycle(id: string, actor: DmsActorContext) {
    return this.readControl(
      `/documents/${this.controlId(id)}/lifecycle`,
      lifecycleResponseSchema,
      actor,
    );
  }
  deleteDocument(id: string, revision: string, actor: DmsActorContext) {
    return this.writeControl(
      `/documents/${this.controlId(id)}`,
      lifecycleResponseSchema,
      actor,
      'DELETE',
      undefined,
      this.revisionHeader(revision),
    );
  }
  restoreDocument(id: string, revision: string, key: string, actor: DmsActorContext) {
    return this.writeControl(
      `/documents/${this.controlId(id)}/restore`,
      lifecycleResponseSchema,
      actor,
      'POST',
      {},
      { ...this.revisionHeader(revision), 'idempotency-key': this.controlId(key) },
    );
  }
  documentPermissions(id: string, actor: DmsActorContext) {
    return this.readControl(
      `/documents/${this.controlId(id)}/permissions`,
      documentPermissionsResponseSchema,
      actor,
    );
  }
  search(input: ReturnType<typeof discoveryRequestSchema.parse>, actor: DmsActorContext) {
    const parsed = discoveryRequestSchema.safeParse(input);
    if (!parsed.success) throw new DmsClientError('DMS_REQUEST_INVALID', 400);
    return this.readControl(
      '/search',
      discoveryPageSchema,
      actor,
      undefined,
      { 'content-type': 'application/json' },
      { method: 'POST', body: JSON.stringify(parsed.data), replayExpired: true },
    );
  }
  processing(
    id: string,
    input: ReturnType<typeof processingQuerySchema.parse>,
    actor: DmsActorContext,
  ) {
    const query = processingQuerySchema.safeParse(input);
    if (!query.success) throw new DmsClientError('DMS_REQUEST_INVALID', 400);
    return this.readControl(
      `/documents/${this.controlId(id)}/processing`,
      processingHistorySchema,
      actor,
      query.data,
    );
  }
  content(id: string, input: ReturnType<typeof resultQuerySchema.parse>, actor: DmsActorContext) {
    const query = resultQuerySchema.safeParse(input);
    if (!query.success) throw new DmsClientError('DMS_REQUEST_INVALID', 400);
    return this.readControl(
      `/documents/${this.controlId(id)}/content`,
      processingContentSchema,
      actor,
      query.data,
    );
  }
  reprocess(
    id: string,
    version: string,
    input: ReturnType<typeof reprocessSchema.parse>,
    key: string,
    actor: DmsActorContext,
  ) {
    const parsed = reprocessSchema.safeParse(input);
    if (!parsed.success) throw new DmsClientError('DMS_REQUEST_INVALID', 400);
    return this.writeControl(
      `/documents/${this.controlId(id)}/versions/${this.controlId(version)}/reprocess`,
      reprocessResponseSchema,
      actor,
      'POST',
      parsed.data,
      { 'idempotency-key': this.controlId(key) },
    );
  }
  replaceDocumentPermissions(
    id: string,
    revision: string,
    payload: ReturnType<typeof documentPermissionsSchema.parse>,
    actor: DmsActorContext,
  ) {
    return this.writeControl(
      `/documents/${this.controlId(id)}/permissions`,
      documentPermissionsResponseSchema,
      actor,
      'PUT',
      documentPermissionsSchema.parse(payload),
      this.revisionHeader(revision),
    );
  }
  audit(query: ReturnType<typeof auditQuerySchema.parse>, actor: DmsActorContext, id?: string) {
    const path = id ? `/documents/${this.controlId(id)}/audit` : '/audit';
    return this.readControl(path, auditPageSchema, actor, auditQuerySchema.parse(query));
  }
  uploadStatus(id: string, actor: DmsActorContext) {
    return this.readControl(`/uploads/${this.controlId(id)}`, uploadStatusSchema, actor);
  }
  createBatch(
    input: ReturnType<typeof batchCreateSchema.parse>,
    key: string,
    actor: DmsActorContext,
  ) {
    const body = batchCreateSchema.parse(input);
    if (Buffer.byteLength(JSON.stringify(body.items)) > 262144)
      throw new DmsClientError('DMS_REQUEST_INVALID');
    return this.writeControl(
      '/upload-batches',
      batchResponseSchema,
      actor,
      'POST',
      body,
      {
        'idempotency-key': this.controlId(key),
      },
      266240,
    );
  }
  batch(id: string, query: ReturnType<typeof documentQuerySchema.parse>, actor: DmsActorContext) {
    return this.readControl(
      `/upload-batches/${this.controlId(id)}`,
      batchStatusSchema,
      actor,
      documentQuerySchema.parse(query),
    );
  }
  closeBatch(id: string, key: string, actor: DmsActorContext) {
    return this.writeControl(
      `/upload-batches/${this.controlId(id)}/close`,
      batchResponseSchema,
      actor,
      'POST',
      {},
      { 'idempotency-key': this.controlId(key) },
    );
  }
  cancelBatch(id: string, actor: DmsActorContext) {
    return this.writeControl(
      `/upload-batches/${this.controlId(id)}`,
      batchResponseSchema,
      actor,
      'DELETE',
      undefined,
      {},
    );
  }
  originalDownload(id: string, actor: DmsActorContext, versionId?: string) {
    return this.readControl(
      `/documents/${this.controlId(id)}/download`,
      downloadCapabilitySchema,
      actor,
      versionId ? { versionId: this.controlId(versionId) } : undefined,
    );
  }
  async versions(
    id: string,
    query: ReturnType<typeof documentQuerySchema.parse>,
    actor: DmsActorContext,
  ) {
    const parsed = documentQuerySchema.safeParse(query);
    if (!parsed.success) throw new DmsClientError('DMS_REQUEST_INVALID');
    return this.readControl(
      `/documents/${this.controlId(id)}/versions`,
      versionPageSchema,
      actor,
      parsed.data,
    );
  }
  version(id: string, versionId: string, actor: DmsActorContext) {
    return this.readControl(
      `/documents/${this.controlId(id)}/versions/${this.controlId(versionId)}`,
      versionSchema,
      actor,
    );
  }
  async editDocument(
    id: string,
    revision: string,
    payload: ReturnType<typeof documentEditSchema.parse>,
    actor: DmsActorContext,
  ) {
    return this.writeControl(
      `/documents/${this.controlId(id)}`,
      documentResponseSchema,
      actor,
      'PATCH',
      documentEditSchema.parse(payload),
      this.revisionHeader(revision),
    );
  }
  async linkReference(
    id: string,
    revision: string,
    payload: ReturnType<typeof documentReferenceInputSchema.parse>,
    actor: DmsActorContext,
  ) {
    return this.writeControl(
      `/documents/${this.controlId(id)}/references`,
      documentResponseSchema,
      actor,
      'POST',
      documentReferenceInputSchema.parse(payload),
      this.revisionHeader(revision),
    );
  }
  async unlinkReference(id: string, referenceId: string, revision: string, actor: DmsActorContext) {
    return this.writeControl(
      `/documents/${this.controlId(id)}/references/${this.controlId(referenceId)}`,
      documentResponseSchema,
      actor,
      'DELETE',
      undefined,
      this.revisionHeader(revision),
    );
  }
  async beginVersion(
    id: string,
    revision: string,
    payload: ReturnType<typeof uploadBeginSchema.parse>,
    key: string,
    actor: DmsActorContext,
  ) {
    return this.writeControl(
      `/documents/${this.controlId(id)}/versions/uploads`,
      uploadResponseSchema,
      actor,
      'POST',
      uploadBeginSchema.parse(payload),
      { ...this.revisionHeader(revision), 'idempotency-key': this.controlId(key) },
    );
  }
  async restoreVersion(
    id: string,
    versionId: string,
    revision: string,
    payload: ReturnType<typeof restoreVersionSchema.parse>,
    key: string,
    actor: DmsActorContext,
  ) {
    return this.writeControl(
      `/documents/${this.controlId(id)}/versions/${this.controlId(versionId)}/restore`,
      uploadResponseSchema,
      actor,
      'POST',
      restoreVersionSchema.parse(payload),
      { ...this.revisionHeader(revision), 'idempotency-key': this.controlId(key) },
    );
  }
  private revisionHeader(revision: string) {
    if (!/^[1-9][0-9]{0,14}$/.test(revision)) throw new DmsClientError('DMS_REQUEST_INVALID');
    return { 'if-match': `"${revision}"` };
  }
  async beginUpload(
    input: ReturnType<typeof uploadBeginSchema.parse>,
    key: string,
    actor: DmsActorContext,
  ) {
    const parsed = uploadBeginSchema.safeParse(input);
    if (!parsed.success) throw new DmsClientError('DMS_REQUEST_INVALID');
    return this.uploadControl('/uploads', actor, 'POST', parsed.data, this.controlId(key));
  }
  async completeUpload(id: string, key: string, actor: DmsActorContext) {
    return this.uploadControl(
      `/uploads/${this.controlId(id)}/complete`,
      actor,
      'POST',
      {},
      this.controlId(key),
    );
  }
  async refreshUpload(id: string, actor: DmsActorContext) {
    return this.uploadControl(`/uploads/${this.controlId(id)}/refresh`, actor, 'POST', {});
  }
  async cancelUpload(id: string, actor: DmsActorContext) {
    return this.uploadControl(`/uploads/${this.controlId(id)}`, actor, 'DELETE');
  }
  private controlId(id: string) {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id))
      throw new DmsClientError('DMS_REQUEST_INVALID');
    return id;
  }
  private uploadControl(
    path: string,
    actor: DmsActorContext,
    method: 'POST' | 'DELETE',
    body?: object,
    key?: string,
  ) {
    return this.writeControl(
      path,
      uploadResponseSchema,
      actor,
      method,
      body,
      key ? { 'idempotency-key': key } : {},
    );
  }
  private writeControl<T>(
    path: string,
    schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
    actor: DmsActorContext,
    method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    body: object | undefined,
    headers: Record<string, string>,
    bodyLimit = 32768,
  ) {
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    if (encoded && Buffer.byteLength(encoded) > bodyLimit)
      throw new DmsClientError('DMS_REQUEST_INVALID');
    return this.readControl(
      path,
      schema,
      actor,
      undefined,
      {
        ...(encoded ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      { method, ...(encoded ? { body: encoded } : {}) },
    );
  }
  private async readControl<T>(
    path: string,
    schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
    actor: DmsActorContext,
    query?: Record<string, string | undefined>,
    extra: Record<string, string> = {},
    init: {
      method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
      body?: string;
      replayExpired?: true;
    } = {
      method: 'GET',
    },
  ): Promise<T> {
    if (
      !/^[A-Za-z0-9_-]{1,200}$/.test(actor.userId) ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(actor.requestId)
    )
      throw new DmsClientError('DMS_REQUEST_INVALID');
    const { replayExpired, ...request } = init;
    const search = new URLSearchParams(
      Object.entries(query ?? {}).filter((row): row is [string, string] => row[1] !== undefined),
    ).toString();
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.machineToken();
      const remaining =
        actor.deadlineAt === undefined ? 8000 : Math.min(8000, actor.deadlineAt - Date.now());
      if (remaining <= 0) throw new DmsClientError('DMS_UNAVAILABLE');
      const result = await jsonRequest(
        `${this.baseUrl}${path}${search ? `?${search}` : ''}`,
        {
          ...request,
          headers: {
            accept: 'application/json',
            ...extra,
            authorization: `Bearer ${token.accessToken}`,
            'x-thaarei-actor-id': actor.userId,
            'x-thaarei-request-id': actor.requestId,
          },
        },
        this.transport,
        remaining,
        1048576,
      );
      const error = dmsErrorSchema.safeParse(result.body);
      if (
        (request.method === 'GET' || replayExpired) &&
        attempt === 0 &&
        result.status === 401 &&
        error.success &&
        error.data.code === 'MACHINE_TOKEN_EXPIRED'
      ) {
        try {
          this.provider.invalidate(token);
        } catch {
          throw new DmsClientError('DMS_UNAVAILABLE');
        }
        continue;
      }
      if (result.status === 404)
        throw new DmsClientError('DMS_NOT_FOUND', 404, error.success ? error.data.code : undefined);
      if (result.status === 409 || result.status === 412)
        throw new DmsClientError(
          'DMS_CONFLICT',
          result.status,
          error.success ? error.data.code : undefined,
        );
      if (request.method === 'GET' || ![200, 201, 202].includes(result.status))
        this.assertSuccess(result.status, error.success ? error.data.code : undefined);
      const parsed = schema.safeParse(result.body);
      if (!parsed.success) throw new DmsClientError('DMS_INVALID_RESPONSE');
      return parsed.data;
    }
    throw new DmsClientError('DMS_MACHINE_AUTH_FAILED', 401);
  }

  // Enrollment is an explicit provisioning action. Never automatically retry mutations.
  async enroll(input: {
    request: EnrollmentRequest;
    enrollmentKey: string;
    idempotencyKey: string;
  }): Promise<EnrollmentResponse> {
    const parsed = enrollmentRequestSchema.safeParse(input.request);
    if (
      !parsed.success ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(input.idempotencyKey) ||
      !/^the_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(input.enrollmentKey)
    )
      throw new DmsClientError('DMS_REQUEST_INVALID');
    const token = await this.machineToken();
    const result = await jsonRequest(
      `${this.baseUrl}/application-enrollments`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${token.accessToken}`,
          'x-thaarei-enrollment-key': input.enrollmentKey,
          'idempotency-key': input.idempotencyKey,
        },
        body: JSON.stringify(parsed.data),
      },
      this.transport,
      this.timeoutMs,
    );
    if (result.status !== 200 && result.status !== 201) {
      const problem = dmsErrorSchema.safeParse(result.body);
      throw new DmsClientError(
        'DMS_ENROLLMENT_FAILED',
        result.status,
        problem.success ? problem.data.code : undefined,
      );
    }
    const saved = enrollmentResponseSchema.safeParse(result.body);
    if (!saved.success) throw new DmsClientError('DMS_INVALID_RESPONSE');
    return saved.data;
  }

  private async machineToken() {
    try {
      return await this.provider.getToken();
    } catch (error) {
      if (error instanceof DmsClientError) throw error;
      throw new DmsClientError('DMS_UNAVAILABLE');
    }
  }

  private assertSuccess(status: number, domainCode?: DmsErrorCode) {
    if (status === 200) return;
    if (status === 401) throw new DmsClientError('DMS_MACHINE_AUTH_FAILED', status, domainCode);
    if (status === 403) throw new DmsClientError('DMS_ACCESS_DENIED', status, domainCode);
    throw new DmsClientError('DMS_UNAVAILABLE', status, domainCode);
  }
}
