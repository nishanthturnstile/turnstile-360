import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type DmsErrorCode,
  processingContentSchema,
  processingHistorySchema,
  processingRunSchema,
  reprocessResponseSchema,
  reprocessSchema,
} from '@thaarei/dms-contracts/public';
import type { MachinePrincipal } from '../access/access-policy.js';
import { DmsDatabaseService } from '../access/dms-database/dms-database.service.js';
import { dmsError } from '../access/dms-errors.js';
import {
  type DmsTransaction,
  requireDocumentRight,
  requireResourceOwner,
} from '../access/resource-policy.js';
import { appendDocumentAudit } from '../audit/document-audit.js';
import { AVAILABLE_ORIGINAL, lockOriginal } from '../documents/download-policy.js';
import { parseAuthorityEnvironment } from '../platform-auth/authority-configuration.js';
import { StorageService } from '../storage/storage.service.js';
import { hash } from '../uploads/admission.service.js';
import { AdmissionFeatures } from '../uploads/admission-policy.js';

export const presentRun = (row: Record<string, unknown>) =>
  processingRunSchema.parse({
    id: row.id,
    documentId: row.document_id,
    versionId: row.version_id,
    number: row.number,
    profile: row.profile,
    sourceSha256: row.source_sha256,
    state: row.state,
    active: row.active,
    indexStatus: row.index_status ?? 'NOT_INDEXED',
    manifest: row.manifest ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    completedAt: row.completed_at ? (row.completed_at as Date).toISOString() : null,
  });
const selectRun =
  'SELECT r.*,dms.processing_index_status(r.id) AS index_status,e.manifest,e.object_id,e.size,e.sha256 FROM dms.processing_run r LEFT JOIN LATERAL dms.accepted_processing_artifact(r.id) e ON true';
export async function requestProcessing(
  tx: DmsTransaction,
  documentId: string,
  versionId: string,
  body: unknown,
  key: string,
  requestId?: string,
) {
  const input = reprocessSchema.safeParse(body);
  if (!input.success || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
    return dmsError(400, 'INVALID_REQUEST');
  const doc = (await tx.client.query('SELECT * FROM dms.document WHERE id=$1', [documentId]))
    .rows[0];
  if (!doc) return dmsError(404, 'DOCUMENT_NOT_FOUND');
  requireResourceOwner(tx, { tenantId: doc.tenant_id, ownerApplicationId: doc.application_id });
  const version = (
    await tx.client.query(
      'SELECT content_type FROM dms.document_version WHERE id=$1 AND document_id=$2',
      [versionId, documentId],
    )
  ).rows[0];
  if (!version) return dmsError(404, 'VERSION_NOT_FOUND');
  const actor =
    tx.context.kind === 'machine' ? tx.context.principal.clientId : tx.context.subjectId;
  const receipt = (
    await tx.client.query(
      'SELECT profile FROM dms.processing_run WHERE version_id=$1 AND actor_kind=$2 AND actor_id=$3 AND key_hash=$4',
      [versionId, tx.context.kind, actor, hash(key)],
    )
  ).rows[0];
  if (receipt && receipt.profile !== input.data.profile)
    return dmsError(409, 'IDEMPOTENCY_CONFLICT');
  if (!receipt && !new AdmissionFeatures().supports(version.content_type, input.data.profile))
    return dmsError(409, 'PROFILE_UNAVAILABLE');
  const result = (
    await tx.client.query('SELECT dms.request_processing($1,$2,$3,$4,$5,$6) AS result', [
      documentId,
      versionId,
      input.data.profile,
      key,
      randomUUID(),
      requestId ?? null,
    ])
  ).rows[0].result;
  if (result.error)
    return dmsError(
      (
        {
          DOCUMENT_NOT_FOUND: 404,
          VERSION_NOT_FOUND: 404,
          APPLICATION_DENIED: 403,
          INVALID_REQUEST: 400,
          POLICY_DENIED: 403,
          CAPACITY_EXCEEDED: 429,
          CAPACITY_UNAVAILABLE: 503,
          REPLAY_WINDOW_EXPIRED: 410,
        } as Record<string, number>
      )[result.error] ?? 409,
      result.error as DmsErrorCode,
    );
  const row = (await tx.client.query(`${selectRun} WHERE r.id=$1`, [result.id])).rows[0];
  return {
    ...reprocessResponseSchema.parse({
      operationId: row.id,
      run: presentRun(row),
      replayUntil: row.expires_at.toISOString(),
    }),
    replay: result.replay as boolean,
  };
}
@Injectable()
export class ResultsService {
  constructor(
    private readonly database: DmsDatabaseService,
    private readonly storage: StorageService,
  ) {}
  private async version(tx: DmsTransaction, documentId: string, versionId?: string) {
    await lockOriginal(tx.client, tx.context.tenantId, documentId);
    await requireDocumentRight(tx, documentId, 'READ');
    const doc = (await tx.client.query('SELECT * FROM dms.document WHERE id=$1', [documentId]))
      .rows[0];
    if (doc?.lifecycle !== 'ACTIVE') return dmsError(404, 'DOCUMENT_NOT_FOUND');
    const selected = versionId ?? doc.current_version_id;
    if (!selected) return dmsError(409, 'DOCUMENT_UNAVAILABLE');
    const v = (
      await tx.client.query('SELECT id FROM dms.document_version WHERE document_id=$1 AND id=$2', [
        doc.id,
        selected,
      ])
    ).rows[0];
    if (!v) return dmsError(404, 'VERSION_NOT_FOUND');
    const original = (
      await tx.client.query(
        `SELECT original.* FROM dms.document d CROSS JOIN LATERAL (${AVAILABLE_ORIGINAL} AND v.id=$2) original WHERE d.id=$1`,
        [doc.id, selected],
      )
    ).rows[0];
    if (!original) return dmsError(409, 'DOCUMENT_UNAVAILABLE');
    return { doc, versionId: selected as string, sha256: original.sha256 as string };
  }
  history(
    principal: MachinePrincipal,
    id: string,
    options: {
      versionId?: string | undefined;
      limit?: string | undefined;
      cursor?: string | undefined;
    },
  ) {
    return this.database.withMachine(principal, ['dms:documents:read'], async (tx) => {
      const selected = await this.version(tx, id, options.versionId);
      const binding = [tx.context.tenantId, tx.context.application.id, id, selected.versionId];
      const mac = (data: unknown) =>
        createHmac('sha256', parseAuthorityEnvironment(process.env).AUTH_SECRET)
          .update('dms-processing:')
          .update(JSON.stringify(data))
          .digest();
      let after: number | null = null;
      if (options.cursor) {
        try {
          const decoded = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8'));
          const signature = Buffer.from(decoded.signature, 'base64url'),
            expected = mac(decoded.data);
          if (
            signature.length !== expected.length ||
            !timingSafeEqual(signature, expected) ||
            JSON.stringify(decoded.data.slice(0, 4)) !== JSON.stringify(binding) ||
            decoded.data.length !== 5 ||
            !Number.isInteger(decoded.data[4]) ||
            decoded.data[4] < 1
          )
            throw new Error();
          after = decoded.data[4];
        } catch {
          return dmsError(400, 'INVALID_REQUEST');
        }
      }
      const limit = Number(options.limit ?? 20);
      const rows = (
        await tx.client.query(
          `${selectRun} WHERE r.version_id=$1 AND r.source_sha256=$2 AND ($3::integer IS NULL OR r.number<$3) ORDER BY r.number DESC LIMIT $4`,
          [selected.versionId, selected.sha256, after, limit + 1],
        )
      ).rows;
      const active = (
        await tx.client.query(
          'SELECT id FROM dms.processing_run WHERE version_id=$1 AND active AND lifecycle_generation=$2 AND source_sha256=$3',
          [selected.versionId, selected.doc.lifecycle_generation, selected.sha256],
        )
      ).rows[0];
      const page = rows.slice(0, limit),
        last = page.at(-1),
        data = last ? [...binding, last.number] : null;
      return processingHistorySchema.parse({
        documentId: id,
        versionId: selected.versionId,
        activeRunId: active?.id ?? null,
        indexStatus: active
          ? (await tx.client.query('SELECT dms.processing_index_status($1) AS status', [active.id]))
              .rows[0].status
          : 'NOT_INDEXED',
        items: page.map((row) =>
          presentRun({
            ...row,
            active: row.active && row.lifecycle_generation === selected.doc.lifecycle_generation,
          }),
        ),
        nextCursor:
          rows.length > limit && data
            ? Buffer.from(
                JSON.stringify({ data, signature: mac(data).toString('base64url') }),
              ).toString('base64url')
            : null,
      });
    });
  }
  content(
    principal: MachinePrincipal,
    id: string,
    options: { versionId?: string | undefined; runId?: string | undefined },
    requestId: string,
  ) {
    return this.database.withMachine(principal, ['dms:documents:read'], async (tx) => {
      const selected = await this.version(tx, id, options.versionId);
      const row = (
        await tx.client.query(
          `${selectRun} WHERE r.version_id=$1 AND r.source_sha256=$2 AND ${options.runId ? 'r.id=$3' : 'r.active AND r.lifecycle_generation=$3'}`,
          [selected.versionId, selected.sha256, options.runId ?? selected.doc.lifecycle_generation],
        )
      ).rows[0];
      if (!row)
        return dmsError(
          options.runId ? 404 : 409,
          options.runId ? 'PROCESSING_RUN_NOT_FOUND' : 'RESULT_UNAVAILABLE',
        );
      if (!row.accepted_stage_id || !row.manifest) return dmsError(409, 'RESULT_UNAVAILABLE');
      const cap = await this.storage.forRole('artifactRead').download({
        area: 'artifacts',
        tenantId: tx.context.tenantId,
        applicationId: selected.doc.application_id,
        id: row.object_id,
      });
      await appendDocumentAudit(tx, {
        documentId: id,
        action: 'processing.content-authorized',
        requestId,
      });
      return processingContentSchema.parse({
        run: presentRun({
          ...row,
          active: row.active && row.lifecycle_generation === selected.doc.lifecycle_generation,
        }),
        untrusted: true,
        artifacts: [
          {
            schemaVersion: 1,
            kind: 'extraction-json',
            size: Number(row.size),
            sha256: row.sha256,
            ...cap,
          },
        ],
      });
    });
  }
  reprocess(
    principal: MachinePrincipal,
    id: string,
    versionId: string,
    body: unknown,
    key: string,
    requestId: string,
  ) {
    return this.database.withMachine(
      principal,
      ['dms:documents:read', 'dms:documents:write'],
      (tx) => requestProcessing(tx, id, versionId, body, key, requestId),
    );
  }
}
