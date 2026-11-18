import { HttpException, Injectable } from '@nestjs/common';
import { ClientCredentialsTokenProvider, DmsClient, DmsClientError } from '@thaarei/dms-client';
import { DMS_MACHINE_SCOPES, documentListQuerySchema } from '@thaarei/dms-contracts/public';
import {
  DOCUMENTS_PERMISSIONS,
  DOCUMENTS_ROUTES,
  documentsAuditQuerySchema,
  documentsConnectionSchema,
  documentsContentQuerySchema,
  documentsDetailSchema,
  documentsDownloadQuerySchema,
  documentsErrorSchema,
  documentsPageSchema,
  documentsProcessingQuerySchema,
  documentsSearchQuerySchema,
  documentsValidationChecklistSchema,
  documentsVersionQuerySchema,
} from '@thaarei/turnstile-contracts/documents';
import { peopleIdSchema } from '@thaarei/turnstile-contracts/runtime';
import type { PoolClient } from 'pg';
import type { ConfigurationActor } from '../../infrastructure/configuration-context.js';
import { withTenant } from '../../infrastructure/database/postgres.js';
import { ProductPersistenceService } from '../../infrastructure/database/product-persistence.service.js';
import { DmsConfigurationService } from '../../integrations/dms/dms-configuration/dms-configuration.service.js';
import { covers, readAccess } from '../access/access-evaluator.js';
import { deploymentPreflight, deploymentStatus, requireDeployment } from '../deployment/access.js';
import { operation, permissions, workspaceKinds } from './documents-command.js';
import { validationOutcomes } from './documents-validation-outcomes.js';

export function createDocumentsClient(config: DmsConfigurationService['config']) {
  // Private operator provisioning must authorize these exact scopes at the issuer
  // and DMS registration too. Configuring requests cannot expand either ceiling.
  const scopes = (process.env.DMS_DOCUMENTS_SCOPES ?? '').split(' ').filter(Boolean);
  if (
    config &&
    scopes.includes('dms:documents:read') &&
    scopes.every((scope) =>
      [
        'dms:capabilities:read',
        'dms:documents:read',
        'dms:documents:write',
        'dms:audit:read',
      ].includes(scope),
    )
  ) {
    const tokens = new ClientCredentialsTokenProvider({
      issuerUrl: config.AUTH_ISSUER_URL,
      clientId: config.DMS_MACHINE_CLIENT_ID,
      clientSecret: config.DMS_MACHINE_CLIENT_SECRET,
      resource: config.DMS_RESOURCE_URL,
      scopes: DMS_MACHINE_SCOPES.filter(
        (scope) => scope === 'dms:capabilities:read' || scopes.includes(scope),
      ),
      allowInsecureHttp: config.AUTH_PROFILE !== 'production',
    });
    return new DmsClient({
      baseUrl: config.DMS_API_URL,
      tokenProvider: tokens,
      allowInsecureHttp: new URL(config.DMS_API_URL).protocol === 'http:',
    });
  }
  return undefined;
}

@Injectable()
export class DocumentsService {
  private readonly client: DmsClient | undefined;
  constructor(
    private readonly persistence: ProductPersistenceService,
    private readonly settings: DmsConfigurationService,
  ) {
    this.client = createDocumentsClient(settings.config);
  }
  fail(
    actor: ConfigurationActor,
    status: number,
    code: string,
    recovery?: 'retry_same_intent' | 'manual_review',
  ): never {
    const guidance =
      status === 401
        ? 'sign_in'
        : status === 403
          ? 'wait_for_access'
          : status === 409
            ? 'review_conflict'
            : 'correct_input';
    throw new HttpException(
      documentsErrorSchema.parse({
        code,
        requestId: actor.requestId,
        guidance: recovery ?? guidance,
      }),
      status,
    );
  }
  authorize(
    actor: ConfigurationActor,
    permission?: string | readonly string[],
    mode: 'read' | 'full' = 'read',
  ) {
    return this.transaction(actor, permission, mode, async (_db, _tenant, access) => access);
  }
  async transaction<T>(
    actor: ConfigurationActor,
    permission: string | readonly string[] | undefined,
    mode: 'read' | 'full',
    work: (
      db: PoolClient,
      tenant: string,
      access: Awaited<ReturnType<typeof readAccess>>,
    ) => Promise<T>,
  ) {
    const { pool, config } = this.persistence;
    if (!pool || !config || !(await this.persistence.ready()))
      return this.fail(actor, 503, 'DOCUMENTS_UNAVAILABLE');
    await deploymentPreflight(pool, config.INSTALLATION_TENANT_ID, mode);
    return withTenant(
      pool,
      config.INSTALLATION_TENANT_ID,
      async (db) => {
        await db.query('SELECT turnstile.lock_access_context($1::uuid)', [
          config.INSTALLATION_TENANT_ID,
        ]);
        await requireDeployment(db, mode);
        const access = await readAccess(db, config.INSTALLATION_TENANT_ID, actor.userId);
        if (!access.workspaceComplete) throw new HttpException({ code: 'SETUP_REQUIRED' }, 409);
        if (
          permission
            ? !(typeof permission === 'string' ? [permission] : permission).every((value) =>
                covers(access, value, { kind: 'company' }),
              )
            : !DOCUMENTS_PERMISSIONS.some((p) => covers(access, p, { kind: 'company' }))
        )
          this.fail(actor, 403, 'DOCUMENTS_DENIED');
        if (mode === 'full' && actor.accessFingerprint !== access.context.fingerprint)
          this.fail(actor, 409, 'DOCUMENTS_CONFLICT');
        return work(db, config.INSTALLATION_TENANT_ID, access);
      },
      actor.deadlineAt,
    );
  }
  async settle<T>(actor: ConfigurationActor, work: (db: PoolClient, tenant: string) => Promise<T>) {
    const { pool, config } = this.persistence;
    if (!pool || !config) return this.fail(actor, 503, 'DOCUMENTS_UNAVAILABLE');
    return withTenant(
      pool,
      config.INSTALLATION_TENANT_ID,
      (db) => work(db, config.INSTALLATION_TENANT_ID),
      actor.deadlineAt,
    );
  }
  async boundClient(
    actor: ConfigurationActor,
    mode: 'read' | 'full' = 'read',
    operation: Awaited<
      ReturnType<DmsClient['documentsCapabilities']>
    >['operations'][number] = 'uploads:control',
  ) {
    if (!this.client || !this.settings.config)
      return this.fail(actor, 503, 'DOCUMENTS_UNAVAILABLE');
    const capabilities = await this.client.documentsCapabilities(actor);
    if (
      capabilities.tenantId !== this.settings.config.INSTALLATION_TENANT_ID ||
      capabilities.applicationId !== this.settings.config.TURNSTILE_APPLICATION_ID
    )
      throw new DmsClientError('DMS_INVALID_RESPONSE');
    if (mode === 'full' && capabilities.deploymentAccess !== 'full')
      this.fail(actor, 403, 'DEPLOYMENT_RESTRICTED');
    if (mode === 'full' && !capabilities.operations.includes(operation))
      this.fail(actor, 403, 'DOCUMENTS_DENIED');
    return { client: this.client, capabilities };
  }
  requireTransferOrigin(actor: ConfigurationActor) {
    const origin = process.env.DMS_DOCUMENTS_TRANSFER_ORIGIN;
    if (!origin) return this.fail(actor, 503, 'DOCUMENTS_UNAVAILABLE');
    try {
      const url = new URL(origin);
      const allowHttp = this.settings.config?.AUTH_PROFILE !== 'production';
      if (
        url.origin === origin &&
        (url.protocol === 'https:' ||
          (allowHttp &&
            url.protocol === 'http:' &&
            ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
      )
        return origin;
    } catch {
      // Invalid configuration maps to the same finite product error.
    }
    return this.fail(actor, 503, 'DOCUMENTS_UNAVAILABLE');
  }
  transferUrl(value: string, actor: ConfigurationActor) {
    const origin = this.requireTransferOrigin(actor);
    const url = new URL(value);
    if (
      !origin ||
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.hash ||
      (url.protocol !== 'https:' && this.settings.config?.AUTH_PROFILE === 'production') ||
      !['https:', 'http:'].includes(url.protocol)
    )
      throw new DmsClientError('DMS_INVALID_RESPONSE');
    return value;
  }
  uploadStatus(actor: ConfigurationActor, input: string) {
    const id = peopleIdSchema.safeParse(input);
    if (!id.success) return this.fail(actor, 400, 'DOCUMENTS_INVALID');
    return this.perform(actor, 'turnstile:documents:read', async (client) => {
      const response = await client.uploadStatus(id.data, actor);
      if (response.id !== id.data) throw new DmsClientError('DMS_INVALID_RESPONSE');
      return response;
    });
  }
  original(actor: ConfigurationActor, input: string, query: unknown) {
    const id = peopleIdSchema.safeParse(input);
    if (!id.success) return this.fail(actor, 400, 'DOCUMENTS_INVALID');
    const selection = documentsDownloadQuerySchema.safeParse(query);
    if (!selection.success) return this.fail(actor, 400, 'DOCUMENTS_INVALID');
    const versionId = selection.data.versionId?.toLowerCase();
    return this.perform(actor, 'turnstile:documents:read', async (client) => {
      const response = await client.originalDownload(id.data, actor, versionId);
      if (response.documentId !== id.data || (versionId && response.versionId !== versionId))
        throw new DmsClientError('DMS_INVALID_RESPONSE');
      return { ...response, url: this.transferUrl(response.url, actor) };
    });
  }
  versions(actor: ConfigurationActor, input: string, query: unknown) {
    const id = peopleIdSchema.safeParse(input);
    const page = documentsVersionQuerySchema.safeParse(query);
    if (!id.success || !page.success) return this.fail(actor, 400, 'DOCUMENTS_INVALID');
    return this.perform(actor, 'turnstile:documents:read', async (client) => {
      const result = await client.versions(id.data, page.data, actor);
      if (result.items.some((row) => row.documentId !== id.data))
        throw new DmsClientError('DMS_INVALID_RESPONSE');
      return result;
    });
  }
  search(actor: ConfigurationActor, input: unknown) {
    const query = documentsSearchQuerySchema.safeParse(input);
    if (!query.success) return this.fail(actor, 400, 'DOCUMENTS_INVALID');
    const { limit, ...filters } = query.data;
    return this.perform(actor, 'turnstile:documents:read', (client) =>
      client.search({ ...filters, limit: Number(limit ?? 20) }, actor),
    );
  }
  processing(actor: ConfigurationActor, input: string, query: unknown) {
    const id = peopleIdSchema.safeParse(input);
    const page = documentsProcessingQuerySchema.safeParse(query);
    if (!id.success || !page.success) return this.fail(actor, 400, 'DOCUMENTS_INVALID');
    const versionId = page.data.versionId?.toLowerCase();
    return this.perform(actor, 'turnstile:documents:read', async (client) => {
      const result = await client.processing(id.data, { ...page.data, versionId }, actor);
      if (
        result.documentId !== id.data ||
        (versionId && result.versionId !== versionId) ||
        result.items.some((run) => run.documentId !== id.data || run.versionId !== result.versionId)
      )
        throw new DmsClientError('DMS_INVALID_RESPONSE');
      return result;
    });
  }
  content(actor: ConfigurationActor, input: string, query: unknown) {
    const id = peopleIdSchema.safeParse(input);
    const selection = documentsContentQuerySchema.safeParse(query);
    if (!id.success || !selection.success) return this.fail(actor, 400, 'DOCUMENTS_INVALID');
    const versionId = selection.data.versionId?.toLowerCase();
    const runId = selection.data.runId?.toLowerCase();
    return this.perform(actor, 'turnstile:documents:read', async (client) => {
      const result = await client.content(id.data, { versionId, runId }, actor);
      if (
        result.run.documentId !== id.data ||
        (versionId && result.run.versionId !== versionId) ||
        (runId ? result.run.id !== runId : !result.run.active) ||
        result.artifacts.length !== 1
      )
        throw new DmsClientError('DMS_INVALID_RESPONSE');
      if (!['SUCCEEDED', 'PARTIAL'].includes(result.run.state))
        return this.fail(actor, 409, 'DOCUMENTS_RESULT_UNAVAILABLE');
      return {
        ...result,
        artifacts: result.artifacts.map((artifact) => ({
          ...artifact,
          url: this.transferUrl(artifact.url, actor),
        })),
      };
    });
  }
  lifecycle(actor: ConfigurationActor, input: string) {
    const id = peopleIdSchema.safeParse(input);
    if (!id.success) return this.fail(actor, 400, 'DOCUMENTS_INVALID');
    return this.perform(actor, 'turnstile:documents:lifecycle', async (client) => {
      const result = await client.lifecycle(id.data, actor);
      if (result.documentId !== id.data) throw new DmsClientError('DMS_INVALID_RESPONSE');
      return result;
    });
  }
  permissions(actor: ConfigurationActor, input: string) {
    const id = peopleIdSchema.safeParse(input);
    if (!id.success) return this.fail(actor, 400, 'DOCUMENTS_INVALID');
    return this.perform(actor, 'turnstile:documents:share', async (client) => {
      const result = await client.documentPermissions(id.data, actor);
      if (result.documentId !== id.data) throw new DmsClientError('DMS_INVALID_RESPONSE');
      return result;
    });
  }
  audit(actor: ConfigurationActor, query: unknown, input?: string) {
    const id = input === undefined ? undefined : peopleIdSchema.safeParse(input);
    const cursor = documentsAuditQuerySchema.safeParse(query);
    if ((id && !id.success) || !cursor.success) return this.fail(actor, 400, 'DOCUMENTS_INVALID');
    return this.perform(actor, 'turnstile:documents:audit', async (client, capabilities) => {
      const result = await client.audit(cursor.data, actor, id?.data);
      if (
        result.items.some(
          (item) =>
            item.applicationId !== capabilities.applicationId ||
            (id?.data && (item.resourceType !== 'document' || item.resourceId !== id.data)),
        )
      )
        throw new DmsClientError('DMS_INVALID_RESPONSE');
      return result;
    });
  }
  batch(actor: ConfigurationActor, input: string, query: unknown) {
    const id = peopleIdSchema.safeParse(input);
    const page = documentsVersionQuerySchema.safeParse(query);
    if (!id.success || !page.success) return this.fail(actor, 400, 'DOCUMENTS_INVALID');
    return this.perform(actor, 'turnstile:documents:read', async (client) => {
      const result = await client.batch(id.data, page.data, actor);
      if (result.id !== id.data) throw new DmsClientError('DMS_INVALID_RESPONSE');
      return result;
    });
  }
  version(actor: ConfigurationActor, input: string, version: string, query: unknown) {
    const id = peopleIdSchema.safeParse(input);
    const versionId = peopleIdSchema.safeParse(version);
    if (
      !id.success ||
      !versionId.success ||
      !query ||
      typeof query !== 'object' ||
      Object.keys(query).length
    )
      return this.fail(actor, 400, 'DOCUMENTS_INVALID');
    return this.perform(actor, 'turnstile:documents:read', async (client) => {
      const result = await client.version(id.data, versionId.data, actor);
      if (result.documentId !== id.data || result.id !== versionId.data)
        throw new DmsClientError('DMS_INVALID_RESPONSE');
      return result;
    });
  }
  private async perform<T>(
    actor: ConfigurationActor,
    permission: string | undefined,
    work: (
      client: DmsClient,
      capabilities: Awaited<ReturnType<DmsClient['documentsCapabilities']>>,
    ) => Promise<T>,
  ) {
    await this.authorize(actor, permission);
    try {
      const { client, capabilities } = await this.boundClient(actor);
      const result = await work(client, capabilities);
      // A late response cannot outlive local revocation. No SQL transaction spans HTTP.
      await this.authorize(actor, permission);
      return result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof DmsClientError && error.domainCode === 'DEPLOYMENT_RESTRICTED')
        return this.fail(actor, 403, 'DEPLOYMENT_RESTRICTED');
      if (error instanceof DmsClientError && error.domainCode === 'RESULT_UNAVAILABLE')
        return this.fail(actor, 409, 'DOCUMENTS_RESULT_UNAVAILABLE');
      const status =
        error instanceof DmsClientError && error.status === 400
          ? 400
          : error instanceof DmsClientError && error.status === 403
            ? 403
            : error instanceof DmsClientError && error.status === 404
              ? 404
              : error instanceof DmsClientError && error.status === 409
                ? 409
                : 503;
      return this.fail(
        actor,
        status,
        status === 400
          ? 'DOCUMENTS_INVALID'
          : status === 403
            ? 'DOCUMENTS_DENIED'
            : status === 404
              ? 'DOCUMENTS_NOT_FOUND'
              : status === 409
                ? 'DOCUMENTS_CONFLICT'
                : 'DOCUMENTS_UNAVAILABLE',
      );
    }
  }
  connection(actor: ConfigurationActor) {
    return this.perform(actor, undefined, async (client, capabilities) => {
      const admission = await client.admissionPolicy(actor);
      const access = await this.authorize(actor);
      const { pool, config } = this.persistence;
      if (!pool || !config) return this.fail(actor, 503, 'DOCUMENTS_UNAVAILABLE');
      const product = await withTenant(pool, config.INSTALLATION_TENANT_ID, (db) =>
        deploymentStatus(db),
      );
      const allowed = new Set(['capabilities:read', 'admission-policy:read']);
      if (covers(access, 'turnstile:documents:read', { kind: 'company' })) {
        for (const read of [
          'documents:read',
          'documents:download',
          'versions:read',
          'discovery:search',
          'processing:read',
          'uploads:read',
          'upload-batches:read',
        ])
          allowed.add(read);
      }
      if (covers(access, 'turnstile:documents:audit', { kind: 'company' }))
        allowed.add('audit:read');
      if (product.access === 'full' && capabilities.deploymentAccess === 'full') {
        for (const kind of workspaceKinds) {
          if (
            permissions(kind).every((permission) => covers(access, permission, { kind: 'company' }))
          )
            allowed.add(operation(kind));
        }
      }
      return documentsConnectionSchema.parse({
        contractVersion: 1,
        productAccess: product.access,
        dmsAccess: capabilities.deploymentAccess ?? 'closed',
        effectiveOperations: capabilities.operations.filter((candidate) => allowed.has(candidate)),
        formats: capabilities.formats,
        profiles: capabilities.profiles,
        languages: capabilities.languages,
        formatCapabilities: capabilities.formatCapabilities,
        admission,
      });
    });
  }
  policy(actor: ConfigurationActor) {
    return this.perform(actor, undefined, (client) => client.admissionPolicy(actor));
  }
  identity(actor: ConfigurationActor) {
    return this.perform(actor, 'turnstile:documents:validate', (client) =>
      client.serviceInfo(actor),
    );
  }
  async validation(actor: ConfigurationActor) {
    const access = await this.authorize(actor, 'turnstile:documents:validate');
    return documentsValidationChecklistSchema.parse({
      items: DOCUMENTS_ROUTES.map(({ evidenceId, action, product }) => {
        const required = product && 'command' in product ? permissions(product.command) : [action];
        return {
          evidenceId,
          allowedByProductRole:
            product !== null &&
            (action === 'any_documents_permission' ||
              required.every((permission) => covers(access, permission, { kind: 'company' }))),
          expected: validationOutcomes[evidenceId],
        };
      }),
    });
  }
  list(actor: ConfigurationActor, input: unknown) {
    const parsed = documentListQuerySchema.safeParse(input);
    if (!parsed.success) return this.fail(actor, 400, 'DOCUMENTS_INVALID');
    return this.perform(actor, 'turnstile:documents:read', async (client) => {
      const page = await client.documents(parsed.data, actor);
      return documentsPageSchema.parse({
        ...page,
        items: page.items.map((row) => {
          const { applicationId, ...document } = row;
          return {
            ...document,
            ownership:
              applicationId === this.settings.config?.TURNSTILE_APPLICATION_ID ? 'owned' : 'shared',
          };
        }),
      });
    });
  }
  detail(actor: ConfigurationActor, input: unknown) {
    const id = peopleIdSchema.safeParse(input);
    if (!id.success) return this.fail(actor, 400, 'DOCUMENTS_INVALID');
    return this.perform(actor, 'turnstile:documents:read', async (client) => {
      const { applicationId, ...document } = await client.document(id.data, actor);
      return documentsDetailSchema.parse({
        ...document,
        ownership:
          applicationId === this.settings.config?.TURNSTILE_APPLICATION_ID ? 'owned' : 'shared',
      });
    });
  }
}
