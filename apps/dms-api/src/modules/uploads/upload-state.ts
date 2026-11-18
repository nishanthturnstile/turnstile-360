import { randomUUID } from 'node:crypto';
import { type UploadAdmissionRequest, uploadStatusSchema } from '@thaarei/dms-contracts/public';
import { dmsError } from '../access/dms-errors.js';
import type {
  CoordinatorContext,
  DmsTransaction,
  MachineContext,
} from '../access/resource-policy.js';
import { appendDocumentAudit } from '../audit/document-audit.js';
import { canonical, hash } from './admission.service.js';

export type MachineTx = DmsTransaction<MachineContext>;
export type SessionRow = {
  id: string;
  application_id: string;
  batch_application_id: string;
  document_id: string;
  version_id: string;
  staging_id: string;
  descriptor: UploadAdmissionRequest;
  batch_id: string | null;
  item_id: string | null;
  upload_state: 'INITIATED' | 'OBJECT_VERIFIED' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED' | 'FAILED';
  expires_at: Date;
  replay_until?: Date;
  processing_state?: string;
  completion_requested_at: Date | null;
  failure_code?: 'SIZE_MISMATCH' | 'CONTENT_TYPE_MISMATCH' | 'SECURITY_ASSESSMENT_FAILED' | null;
  security_state?: 'COPYING' | 'PENDING' | 'PASSED' | 'REJECTED' | 'INCONCLUSIVE' | 'INVALIDATED';
  version_availability?: 'PENDING' | 'AVAILABLE' | 'UNAVAILABLE';
};
export const SESSION_SELECT = `SELECT s.*,a.document_id,a.version_id,coalesce(a.reassessment_until,a.expires_at) AS expires_at,a.expires_at AS replay_until,c.state AS security_state,v.availability AS version_availability,dms.extraction_status(s.id) AS processing_state FROM dms.upload_session s JOIN dms.upload_admission a ON a.id=s.id JOIN dms.document_version v ON v.id=a.version_id LEFT JOIN dms.security_candidate c ON c.upload_id=s.id`;
export function projectSession(s: SessionRow) {
  return uploadStatusSchema.parse({
    id: s.id,
    documentId: s.document_id,
    versionId: s.version_id,
    upload: s.upload_state,
    security: !s.security_state || s.security_state === 'COPYING' ? 'PENDING' : s.security_state,
    availability:
      !s.version_availability || s.version_availability === 'PENDING'
        ? 'CANDIDATE'
        : s.version_availability,
    processing: s.processing_state ?? 'NOT_SCHEDULED',
    completionRequested: s.completion_requested_at !== null,
    expiresAt: s.expires_at.toISOString(),
    replayUntil: (s.replay_until ?? s.expires_at).toISOString(),
    size: s.descriptor.size,
    contentType: s.descriptor.contentType,
    failure:
      s.upload_state === 'EXPIRED'
        ? 'SESSION_EXPIRED'
        : s.upload_state === 'CANCELLED'
          ? 'CANCELLED'
          : (s.failure_code ?? null),
    retryAfterSeconds:
      s.upload_state === 'OBJECT_VERIFIED' ||
      (s.upload_state === 'INITIATED' && s.completion_requested_at)
        ? 2
        : null,
  });
}
export async function batchAudit(
  tx: MachineTx | DmsTransaction<CoordinatorContext>,
  id: string,
  action: 'batch.created' | 'batch.closed' | 'batch.cancelled' | 'batch.expired',
  requestId?: string,
  applicationId?: string,
) {
  const auditId = randomUUID(),
    appId = tx.context.kind === 'machine' ? tx.context.application.id : applicationId;
  if (!appId) throw new Error('Owning batch application required');
  const actor =
    tx.context.kind === 'machine' ? tx.context.principal.clientId : tx.context.subjectId;
  await tx.client.query(
    `INSERT INTO dms.audit_event (id,tenant_id,application_id,batch_id,resource_id,resource_type,action,actor_kind,actor_id,request_id)
  VALUES ($1,$2,$3,$4,$4,'upload-batch',$5,$6,$7,$8)`,
    [auditId, tx.context.tenantId, appId, id, action, tx.context.kind, actor, requestId ?? null],
  );
  await tx.client.query(
    'INSERT INTO dms.outbox_intent (id,tenant_id,application_id,audit_id,kind) VALUES ($1,$2,$3,$4,$5)',
    [randomUUID(), tx.context.tenantId, appId, auditId, action],
  );
}
export async function lockBatch(tx: MachineTx, id: string, requestId?: string) {
  const row = (
    await tx.client.query(
      `SELECT *,expires_at<=clock_timestamp() AS expired FROM dms.upload_batch WHERE id=$1 FOR UPDATE`,
      [id],
    )
  ).rows[0];
  if (!row) return dmsError(404, 'BATCH_NOT_FOUND');
  if (row.state === 'OPEN' && row.expired) {
    await tx.client.query("UPDATE dms.upload_batch SET state='EXPIRED' WHERE id=$1", [id]);
    await tx.client.query(
      "UPDATE dms.upload_batch_item SET state='EXPIRED' WHERE batch_id=$1 AND state='UNSTARTED'",
      [id],
    );
    await tx.client.query('UPDATE dms.upload_batch_slot SET active=false WHERE id=$1', [id]);
    await batchAudit(tx, id, 'batch.expired', requestId);
    row.state = 'EXPIRED';
  }
  return row as {
    id: string;
    state: 'OPEN' | 'CLOSED' | 'CANCELLED' | 'EXPIRED';
    expires_at: Date;
  };
}
export async function expireSession(tx: MachineTx, row: SessionRow, requestId?: string) {
  // Use wall-clock time after lock acquisition, rather than transaction-start now().
  const expired = (
    await tx.client.query('SELECT $1::timestamptz<=clock_timestamp() AS expired', [row.expires_at])
  ).rows[0].expired;
  if (
    ['INITIATED', 'OBJECT_VERIFIED'].includes(row.upload_state) &&
    expired &&
    (await tx.client.query('SELECT dms.controls_upload($1) AS allowed', [row.id])).rows[0]?.allowed
  ) {
    row.upload_state = 'EXPIRED';
    await tx.client.query("UPDATE dms.upload_session SET upload_state='EXPIRED' WHERE id=$1", [
      row.id,
    ]);
    await appendDocumentAudit(tx, {
      documentId: row.document_id,
      action: 'upload.expired',
      requestId,
    });
  }
  return row;
}
export async function lockSession(
  tx: MachineTx,
  id: string,
  requestId?: string,
  beforeLock?: () => Promise<unknown>,
) {
  // The first read discovers grouping only. Lock order is batch -> session throughout.
  const first = (await tx.client.query<SessionRow>(`${SESSION_SELECT} WHERE s.id=$1`, [id]))
    .rows[0];
  if (!first) return dmsError(404, 'UPLOAD_NOT_FOUND');
  if (first.batch_id && first.batch_application_id === tx.context.application.id)
    await lockBatch(tx, first.batch_id, requestId);
  await beforeLock?.();
  const row = (
    await tx.client.query<SessionRow>(`${SESSION_SELECT} WHERE s.id=$1 FOR UPDATE OF s`, [id])
  ).rows[0];
  if (!row) return dmsError(404, 'UPLOAD_NOT_FOUND');
  return expireSession(tx, row, requestId);
}
export async function cancelSession(tx: MachineTx, row: SessionRow, requestId?: string) {
  if (
    !(await tx.client.query('SELECT dms.controls_upload($1) AS allowed', [row.id])).rows[0]?.allowed
  )
    return row;
  await expireSession(tx, row, requestId);
  if (!['INITIATED', 'OBJECT_VERIFIED'].includes(row.upload_state)) return row;
  row.upload_state = 'CANCELLED';
  await tx.client.query("UPDATE dms.upload_session SET upload_state='CANCELLED' WHERE id=$1", [
    row.id,
  ]);
  await appendDocumentAudit(tx, {
    documentId: row.document_id,
    action: 'upload.cancelled',
    requestId,
  });
  return row;
}
export async function operationReceipt(
  tx: MachineTx,
  namespace: 'batch.create' | 'batch.close' | 'upload.complete',
  key: string,
  body: unknown,
  target: { batchId?: string; uploadId?: string },
) {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) return dmsError(400, 'INVALID_REQUEST');
  const keyHash = hash(key),
    requestHash = hash(JSON.stringify(canonical({ body, ...target })));
  const locked = await tx.client.query(
    'SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked',
    [
      `dms-upload-receipt:${tx.context.tenantId}:${tx.context.application.id}:${namespace}:${keyHash}`,
    ],
  );
  if (!locked.rows[0]?.locked) return dmsError(409, 'ADMISSION_IN_PROGRESS');
  const old = (
    await tx.client.query(
      'SELECT *,expires_at<=clock_timestamp() AS expired FROM dms.upload_receipt WHERE namespace=$1 AND key_hash=$2',
      [namespace, keyHash],
    )
  ).rows[0];
  if (old) {
    if (old.request_hash !== requestHash) return dmsError(409, 'IDEMPOTENCY_CONFLICT');
    if (old.expired) return dmsError(410, 'REPLAY_WINDOW_EXPIRED');
    return { id: old.id as string, batchId: old.batch_id as string | null, replay: true };
  }
  const id = randomUUID();
  return {
    id,
    batchId: null,
    replay: false,
    save: async (resource: { batchId?: string; uploadId?: string }) => {
      await tx.client.query(
        `INSERT INTO dms.upload_receipt (id,tenant_id,application_id,namespace,key_hash,request_hash,batch_id,upload_id,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()+interval '24 hours')`,
        [
          id,
          tx.context.tenantId,
          tx.context.application.id,
          namespace,
          keyHash,
          requestHash,
          resource.batchId ?? null,
          resource.uploadId ?? null,
        ],
      );
    },
  };
}
