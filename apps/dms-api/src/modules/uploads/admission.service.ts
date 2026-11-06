import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  DOCUMENT_LIMITS,
  type UploadAdmissionRequest,
  uploadAdmissionRequestSchema,
} from '@thaarei/dms-contracts/public';
import type { PoolClient } from 'pg';
import type { MachinePrincipal } from '../access/access-policy.js';
import { DmsDatabaseService } from '../access/dms-database/dms-database.service.js';
import { dmsError } from '../access/dms-errors.js';
import {
  type DmsTransaction,
  type MachineContext,
  requireDocumentRight,
} from '../access/resource-policy.js';
import { appendDocumentAudit } from '../audit/document-audit.js';
import { lockOriginal } from '../documents/download-policy.js';
import { AdmissionFeatures, readAdmissionPolicy } from './admission-policy.js';

export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b, 'en'))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export type AdmissionReceipt = {
  id: string;
  document_id: string;
  version_id: string;
  storage_mode: 'UPLOAD' | 'REUSE';
  state: 'RESERVED' | 'RELEASED' | 'SETTLED';
  request_hash: string;
  size: string;
  profile: string;
  expires_at: Date;
  reserved_storage: string;
  reserved_scratch: string;
  staging_bytes: string;
  original_bytes: string;
  application_id: string;
  work_released: boolean;
};
export async function lockUsage(client: PoolClient, tenantId: string, applicationId: string) {
  await client.query(
    'INSERT INTO dms.admission_tenant_usage (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [tenantId],
  );
  const tenant = (await client.query('SELECT * FROM dms.admission_tenant_usage FOR UPDATE'))
    .rows[0];
  await client.query(
    'INSERT INTO dms.admission_application_usage (id,tenant_id,application_id) VALUES ($1,$2,$3) ON CONFLICT (tenant_id,application_id) DO NOTHING',
    [randomUUID(), tenantId, applicationId],
  );
  const app = (
    await client.query(
      'SELECT * FROM dms.admission_application_usage WHERE application_id=$1 FOR UPDATE',
      [applicationId],
    )
  ).rows[0];
  return { tenant, app };
}
const used = (row: Record<string, unknown>) =>
  ['staging_bytes', 'original_bytes', 'artifact_bytes', 'retained_bytes'].reduce(
    (sum, key) => sum + Number(row[key]),
    0,
  );

export { used as measuredStorageBytes };
@Injectable()
export class AdmissionService {
  constructor(
    private readonly database: DmsDatabaseService,
    private readonly features: AdmissionFeatures,
  ) {}
  async beginUpload<T = undefined>(
    principal: MachinePrincipal,
    body: unknown,
    idempotencyKey: string,
    requestId: string,
    afterReserve?: (tx: DmsTransaction<MachineContext>, receipt: AdmissionReceipt) => Promise<T>,
    hooks?: {
      reuseSourceId?: string;
      before: (tx: DmsTransaction<MachineContext>) => Promise<void>;
      replay: (tx: DmsTransaction<MachineContext>, receipt: AdmissionReceipt) => Promise<T>;
    },
  ) {
    const input = uploadAdmissionRequestSchema.safeParse(body);
    if (!input.success || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey))
      return dmsError(400, 'INVALID_REQUEST');
    const request = input.data;
    if (
      Buffer.byteLength(JSON.stringify(body)) > DOCUMENT_LIMITS.uploadControlBytes ||
      Buffer.byteLength(JSON.stringify(request.metadata)) > DOCUMENT_LIMITS.metadataBytes ||
      (request.documentId ? !request.expectedRevision : request.expectedRevision !== undefined)
    )
      return dmsError(400, 'INVALID_REQUEST');
    const requestHash = hash(
      JSON.stringify(
        canonical(
          hooks?.reuseSourceId
            ? {
                operation: 'version.restore',
                documentId: request.documentId,
                expectedRevision: request.expectedRevision,
                profile: request.profile,
                reuseSourceId: hooks.reuseSourceId,
              }
            : request,
        ),
      ),
    );
    try {
      return await this.database.withMachine(principal, ['dms:documents:write'], async (tx) => {
        const { client, context } = tx;
        await hooks?.before(tx);
        const policy = await readAdmissionPolicy(client, true);
        if (!policy?.settings.enabled) return dmsError(403, 'POLICY_DENIED');
        if (
          request.size > policy.settings.maxFileBytes ||
          !policy.settings.contentTypes.includes(request.contentType) ||
          !policy.settings.profiles.includes(request.profile)
        )
          return dmsError(403, 'POLICY_DENIED');
        let ownerId = context.application.id;
        if (request.documentId) {
          await requireDocumentRight(tx, request.documentId, 'ADD_VERSION');
          ownerId = (
            await client.query('SELECT application_id FROM dms.document WHERE id=$1', [
              request.documentId,
            ])
          ).rows[0]?.application_id;
          if (!ownerId) return dmsError(404, 'DOCUMENT_NOT_FOUND');
          await client.query(
            "SELECT id FROM dms.application_registration WHERE id=$1 AND status='active' FOR SHARE",
            [ownerId],
          );
        }
        const usage = await lockUsage(client, context.tenantId, ownerId);
        const prior = (
          await client.query<AdmissionReceipt>(
            'SELECT * FROM dms.upload_admission WHERE contributor_application_id=$1 AND idempotency_hash=$2',
            [context.application.id, hash(idempotencyKey)],
          )
        ).rows[0];
        if (prior) {
          if (prior.request_hash !== requestHash) return dmsError(409, 'IDEMPOTENCY_CONFLICT');
          const fresh = (
            await client.query('SELECT $1::timestamptz>clock_timestamp() AS live', [
              prior.expires_at,
            ])
          ).rows[0]?.live;
          if (!fresh) return dmsError(410, 'REPLAY_WINDOW_EXPIRED');
          return {
            replay: true,
            receipt: prior,
            transient: hooks ? await hooks.replay(tx, prior) : (undefined as T | undefined),
          };
        }
        if (!this.features.supports(request.contentType, request.profile))
          return dmsError(503, 'CAPACITY_UNAVAILABLE');
        const capacity = (
          await client.query(
            "SELECT *, observed_at>clock_timestamp()-interval '30 seconds' AND observed_at<=clock_timestamp() AS fresh FROM dms.admission_capacity",
          )
        ).rows[0];
        if (!capacity?.fresh) return dmsError(503, 'CAPACITY_UNAVAILABLE');
        const reserved = hooks?.reuseSourceId ? 0 : 2 * request.size,
          scratch = DOCUMENT_LIMITS.scratchPerUploadBytes;
        const limits = policy.settings;
        if (
          capacity.shared_device &&
          Number(usage.tenant.reserved_storage) +
            Math.max(0, used(usage.tenant) - Number(capacity.used_at_observation)) +
            reserved +
            Number(usage.tenant.reserved_scratch) +
            scratch >
            Math.min(Number(capacity.storage_free_bytes), Number(capacity.scratch_free_bytes))
        )
          return dmsError(429, 'CAPACITY_EXCEEDED');
        if (
          Number(usage.tenant.reserved_storage) + used(usage.tenant) + reserved >
            limits.storageBudgetBytes ||
          Number(usage.app.reserved_storage) + used(usage.app) + reserved >
            limits.applicationBudgetBytes ||
          Number(usage.tenant.reserved_scratch) + scratch > limits.scratchBudgetBytes ||
          Number(usage.tenant.reserved_storage) +
            Math.max(0, used(usage.tenant) - Number(capacity.used_at_observation)) +
            reserved >
            Number(capacity.storage_free_bytes) ||
          Number(usage.tenant.reserved_scratch) + scratch > Number(capacity.scratch_free_bytes) ||
          usage.tenant.active >= limits.activePerTenant ||
          usage.app.active >= limits.activePerApplication ||
          usage.tenant.queued >= limits.queuedWork ||
          usage.app.queued >= Math.min(25, limits.queuedWork)
        )
          return dmsError(429, 'CAPACITY_EXCEEDED');
        const { documentId, versionNumber, lifecycleGeneration } = await this.allocateVersion(
          tx,
          request,
        );
        const versionId = randomUUID(),
          id = randomUUID();
        await client.query(
          'INSERT INTO dms.document_version (id,tenant_id,application_id,document_id,number,size,content_type,file_name,lifecycle_generation) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            versionId,
            context.tenantId,
            ownerId,
            documentId,
            versionNumber,
            request.size,
            request.contentType,
            request.fileName,
            lifecycleGeneration,
          ],
        );
        const receipt = (
          await client.query<AdmissionReceipt>(
            `INSERT INTO dms.upload_admission (id,tenant_id,application_id,contributor_application_id,document_id,version_id,idempotency_hash,request_hash,policy_revision,profile,size,reserved_storage,reserved_scratch,storage_mode,lifecycle_generation,expires_at)
        VALUES ($1,$2,$3,$14,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$15,now()+interval '24 hours') RETURNING *`,
            [
              id,
              context.tenantId,
              ownerId,
              documentId,
              versionId,
              hash(idempotencyKey),
              requestHash,
              policy.revision,
              request.profile,
              request.size,
              reserved,
              scratch,
              hooks?.reuseSourceId ? 'REUSE' : 'UPLOAD',
              context.application.id,
              lifecycleGeneration,
            ],
          )
        ).rows[0];
        if (!receipt) throw new Error('Admission not persisted');
        await client.query(
          'UPDATE dms.admission_tenant_usage SET reserved_storage=reserved_storage+$1,reserved_scratch=reserved_scratch+$2,active=active+1,queued=queued+1',
          [reserved, scratch],
        );
        await client.query(
          'UPDATE dms.admission_application_usage SET reserved_storage=reserved_storage+$1,reserved_scratch=reserved_scratch+$2,active=active+1,queued=queued+1 WHERE application_id=$3',
          [reserved, scratch, ownerId],
        );
        await appendDocumentAudit(tx, {
          documentId,
          action: 'document.admitted',
          requestId,
          assertedHuman: request.assertedHuman,
        });
        const transient = afterReserve ? await afterReserve(tx, receipt) : undefined;
        return { replay: false, receipt, transient };
      });
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        ['55P03', '57014'].includes(String(error.code))
      )
        return dmsError(409, 'ADMISSION_IN_PROGRESS');
      throw error;
    }
  }
  private async allocateVersion(
    tx: DmsTransaction<MachineContext>,
    request: UploadAdmissionRequest,
  ) {
    const { client, context } = tx;
    if (!request.documentId) {
      const id = randomUUID();
      await client.query(
        'INSERT INTO dms.document (id,tenant_id,application_id,title,file_name,metadata,next_version) VALUES ($1,$2,$3,$4,$5,$6,2)',
        [
          id,
          context.tenantId,
          context.application.id,
          request.title,
          request.fileName,
          request.metadata,
        ],
      );
      return { documentId: id, versionNumber: 1, lifecycleGeneration: 1 };
    }
    await lockOriginal(client, context.tenantId, request.documentId, true);
    const row = (
      await client.query(
        'SELECT id,revision,next_version,title,metadata,lifecycle,lifecycle_generation FROM dms.document WHERE id=$1 FOR UPDATE',
        [request.documentId],
      )
    ).rows[0];
    if (!row) return dmsError(404, 'DOCUMENT_NOT_FOUND');
    await requireDocumentRight(tx, request.documentId, 'ADD_VERSION');
    if (row.lifecycle !== 'ACTIVE') return dmsError(409, 'DOCUMENT_UNAVAILABLE');
    if (String(row.revision) !== request.expectedRevision)
      return dmsError(412, 'REVISION_CONFLICT');
    if (
      request.title !== row.title ||
      JSON.stringify(canonical(request.metadata)) !== JSON.stringify(canonical(row.metadata))
    )
      return dmsError(400, 'INVALID_REQUEST');
    if (row.next_version >= 2147483647) return dmsError(403, 'POLICY_DENIED');
    await client.query(
      'UPDATE dms.document SET revision=revision+1,next_version=next_version+1 WHERE id=$1',
      [row.id],
    );
    return {
      documentId: row.id as string,
      versionNumber: row.next_version as number,
      lifecycleGeneration: row.lifecycle_generation as number,
    };
  }
}
