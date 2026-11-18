import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  batchCreateSchema,
  batchResponseSchema,
  batchStatusSchema,
  DOCUMENT_LIMITS,
  type UploadAdmissionRequest,
} from '@thaarei/dms-contracts/public';
import type { MachinePrincipal } from '../access/access-policy.js';
import { DmsDatabaseService } from '../access/dms-database/dms-database.service.js';
import { dmsError } from '../access/dms-errors.js';
import { canonical, hash } from './admission.service.js';
import {
  batchAudit,
  cancelSession,
  lockBatch,
  lockSession,
  type MachineTx,
  operationReceipt,
  projectSession,
  SESSION_SELECT,
  type SessionRow,
} from './upload-state.js';

@Injectable()
export class BatchesService {
  constructor(private readonly database: DmsDatabaseService) {}
  async create(principal: MachinePrincipal, body: unknown, key: string, requestId: string) {
    const parsed = batchCreateSchema.safeParse(body);
    if (
      !parsed.success ||
      Buffer.byteLength(JSON.stringify(body)) > DOCUMENT_LIMITS.batchControlBytes ||
      Buffer.byteLength(JSON.stringify(parsed.data.items)) > DOCUMENT_LIMITS.batchManifestBytes
    )
      return dmsError(400, 'INVALID_REQUEST');
    const items = parsed.data.items;
    if (new Set(items.map((i) => i.itemId)).size !== items.length)
      return dmsError(400, 'INVALID_REQUEST');
    for (const item of items) {
      const d = item.descriptor;
      if (d.documentId) d.documentId = d.documentId.toLowerCase();
      if (
        Buffer.byteLength(JSON.stringify(d.metadata)) > DOCUMENT_LIMITS.metadataBytes ||
        (item.operation === 'create'
          ? d.documentId !== undefined || d.expectedRevision !== undefined
          : !d.documentId || !d.expectedRevision)
      )
        return dmsError(400, 'INVALID_REQUEST');
    }
    return this.database.withMachine(principal, ['dms:documents:write'], async (tx) => {
      const receipt = await operationReceipt(tx, 'batch.create', key, parsed.data, {});
      if (receipt.replay) {
        if (!receipt.batchId) throw new Error('Missing receipt binding');
        return {
          ...batchResponseSchema.parse({
            operationId: receipt.id,
            batch: await this.readInTransaction(tx, receipt.batchId),
          }),
          replay: true,
        };
      }
      await tx.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `dms-open-batches:${tx.context.tenantId}`,
      ]);
      const count = (
        await tx.client.query(
          `SELECT count(*)::int AS tenant,count(*) FILTER (WHERE application_id=$1)::int AS app FROM dms.upload_batch_slot WHERE active AND expires_at>clock_timestamp()`,
          [tx.context.application.id],
        )
      ).rows[0];
      if (count.tenant >= 16 || count.app >= 4) return dmsError(429, 'CAPACITY_EXCEEDED');
      const id = randomUUID();
      await tx.client.query(
        "INSERT INTO dms.upload_batch (id,tenant_id,application_id,expires_at) VALUES ($1,$2,$3,clock_timestamp()+interval '24 hours')",
        [id, tx.context.tenantId, tx.context.application.id],
      );
      await tx.client.query(
        'INSERT INTO dms.upload_batch_slot (id,tenant_id,application_id,expires_at) SELECT id,tenant_id,application_id,expires_at FROM dms.upload_batch WHERE id=$1',
        [id],
      );
      for (const [ordinal, item] of items.entries())
        await tx.client.query(
          'INSERT INTO dms.upload_batch_item (tenant_id,application_id,batch_id,item_id,ordinal,operation,descriptor) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [
            tx.context.tenantId,
            tx.context.application.id,
            id,
            item.itemId,
            ordinal,
            item.operation,
            item.descriptor,
          ],
        );
      await receipt.save?.({ batchId: id });
      await batchAudit(tx, id, 'batch.created', requestId);
      return {
        ...batchResponseSchema.parse({
          operationId: receipt.id,
          batch: await this.readInTransaction(tx, id),
        }),
        replay: false,
      };
    });
  }
  read(principal: MachinePrincipal, id: string, limit = 20, cursor?: string) {
    return this.database.withMachine(principal, ['dms:documents:read'], (tx) =>
      this.readInTransaction(tx, id, limit, cursor),
    );
  }
  async readInTransaction(tx: MachineTx, id: string, limit = 20, cursor?: string) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      return dmsError(400, 'INVALID_REQUEST');
    const batch = await lockBatch(tx, id);
    const after = cursor ? this.decodeCursor(tx, id, cursor) : -1;
    const items = (
      await tx.client.query(
        'SELECT * FROM dms.upload_batch_item WHERE batch_id=$1 ORDER BY ordinal',
        [id],
      )
    ).rows;
    const sessions = (
      await tx.client.query<SessionRow>(
        `${SESSION_SELECT} WHERE s.batch_id=$1 AND dms.has_document_right(a.document_id,'READ') ORDER BY s.id`,
        [id],
      )
    ).rows;
    for (const [i, s] of sessions.entries()) {
      if (
        (await tx.client.query('SELECT dms.controls_upload($1) AS allowed', [s.id])).rows[0]
          ?.allowed
      )
        sessions[i] = await lockSession(tx, s.id);
    }
    return projectBatch(batch, items, sessions, limit, after, (last) =>
      this.encodeCursor(tx, id, last),
    );
  }
  async control(
    principal: MachinePrincipal,
    id: string,
    action: 'close' | 'cancel',
    key: string | undefined,
    requestId: string,
  ) {
    return this.database.withMachine(principal, ['dms:documents:write'], async (tx) => {
      const receipt =
        action === 'close'
          ? await operationReceipt(tx, 'batch.close', key ?? '', {}, { batchId: id })
          : null;
      const batch = await lockBatch(tx, id, requestId);
      if (!receipt?.replay) {
        const target = action === 'cancel' ? 'CANCELLED' : 'CLOSED';
        if (batch.state === 'OPEN' || (action === 'cancel' && batch.state !== 'CANCELLED')) {
          await tx.client.query('UPDATE dms.upload_batch SET state=$1 WHERE id=$2', [target, id]);
          await tx.client.query('UPDATE dms.upload_batch_slot SET active=false WHERE id=$1', [id]);
          await tx.client.query(
            "UPDATE dms.upload_batch_item SET state=$1 WHERE batch_id=$2 AND state='UNSTARTED'",
            [target, id],
          );
          if (action === 'cancel') {
            const sessions = (
              await tx.client.query<SessionRow>(
                `${SESSION_SELECT} WHERE s.batch_id=$1 ORDER BY s.id FOR UPDATE OF s`,
                [id],
              )
            ).rows;
            for (const s of sessions) await cancelSession(tx, s, requestId);
          }
          await batchAudit(
            tx,
            id,
            action === 'cancel' ? 'batch.cancelled' : 'batch.closed',
            requestId,
          );
        }
        await receipt?.save?.({ batchId: id });
      }
      return batchResponseSchema.parse({
        operationId: receipt?.id ?? id,
        batch: await this.readInTransaction(tx, id),
      });
    });
  }
  async beforeAdmission(tx: MachineTx, request: UploadAdmissionRequest, key: string) {
    if (!!request.batchId !== !!request.itemId) return dmsError(400, 'INVALID_REQUEST');
    if (!request.batchId) return;
    const batch = await lockBatch(tx, request.batchId);
    const item = (
      await tx.client.query(
        'SELECT * FROM dms.upload_batch_item WHERE batch_id=$1 AND item_id=$2 FOR UPDATE',
        [request.batchId, request.itemId],
      )
    ).rows[0];
    if (!item) return dmsError(404, 'BATCH_ITEM_NOT_FOUND');
    const { batchId: _batch, itemId: _item, ...descriptor } = request;
    if (JSON.stringify(canonical(descriptor)) !== JSON.stringify(canonical(item.descriptor)))
      return dmsError(409, 'IDEMPOTENCY_CONFLICT');
    if (item.upload_id) {
      const prior = (
        await tx.client.query('SELECT idempotency_hash FROM dms.upload_admission WHERE id=$1', [
          item.upload_id,
        ])
      ).rows[0];
      if (prior?.idempotency_hash !== hash(key)) return dmsError(409, 'BATCH_ITEM_BOUND');
      return;
    }
    if (batch.state !== 'OPEN' || item.state !== 'UNSTARTED') return dmsError(409, 'BATCH_CLOSED');
    if ((item.operation === 'new-version') !== Boolean(request.documentId))
      return dmsError(400, 'INVALID_REQUEST');
  }
  async bind(tx: MachineTx, request: UploadAdmissionRequest, id: string) {
    if (request.batchId)
      await tx.client.query(
        "UPDATE dms.upload_batch_item SET state='BOUND',upload_id=$1,admission_error=NULL WHERE batch_id=$2 AND item_id=$3 AND state='UNSTARTED'",
        [id, request.batchId, request.itemId],
      );
  }
  async admissionFailed(
    principal: MachinePrincipal,
    request: UploadAdmissionRequest,
    code: string,
  ) {
    if (
      !request.batchId ||
      ![
        'POLICY_DENIED',
        'CAPACITY_EXCEEDED',
        'CAPACITY_UNAVAILABLE',
        'OPERATION_DENIED',
        'REVISION_CONFLICT',
      ].includes(code)
    )
      return;
    await this.database.withMachine(principal, ['dms:documents:write'], async (tx) => {
      const batch = await lockBatch(tx, request.batchId as string);
      if (batch.state !== 'OPEN') return;
      const { batchId: _b, itemId: _i, ...descriptor } = request;
      await tx.client.query(
        "UPDATE dms.upload_batch_item SET admission_error=$1 WHERE batch_id=$2 AND item_id=$3 AND state='UNSTARTED' AND descriptor=$4::jsonb",
        [code, request.batchId, request.itemId, JSON.stringify(descriptor)],
      );
    });
  }
  private encodeCursor(tx: MachineTx, id: string, after: number) {
    const data = JSON.stringify([
      'dms-batch-v1',
      tx.context.tenantId,
      tx.context.application.id,
      id,
      after,
    ]);
    const sig = createHmac('sha256', process.env.AUTH_SECRET ?? '')
      .update(data)
      .digest('hex');
    return Buffer.from(JSON.stringify([data, sig])).toString('base64url');
  }
  private decodeCursor(tx: MachineTx, id: string, cursor: string) {
    try {
      const [data, sig] = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      const expected = createHmac('sha256', process.env.AUTH_SECRET ?? '')
        .update(data)
        .digest();
      const received = Buffer.from(sig, 'hex');
      if (received.length !== expected.length || !timingSafeEqual(expected, received))
        throw new Error();
      const [domain, tenant, app, batch, after] = JSON.parse(data);
      if (
        domain !== 'dms-batch-v1' ||
        tenant !== tx.context.tenantId ||
        app !== tx.context.application.id ||
        batch !== id ||
        !Number.isInteger(after) ||
        after < 0 ||
        after > 99
      )
        throw new Error();
      return after as number;
    } catch {
      return dmsError(400, 'INVALID_REQUEST');
    }
  }
}

export type BatchItemRow = {
  item_id: string;
  ordinal: number;
  operation: string;
  descriptor: UploadAdmissionRequest;
  state: 'UNSTARTED' | 'BOUND' | 'CLOSED' | 'CANCELLED' | 'EXPIRED';
  upload_id: string | null;
  admission_error: string | null;
};
export function projectBatch(
  batch: { id: string; state: string; expires_at: Date },
  items: BatchItemRow[],
  sessions: SessionRow[],
  limit: number,
  after: number,
  cursor: (last: number) => string | null,
) {
  const id = batch.id;
  const map = new Map(sessions.map((s) => [s.id, projectSession(s)]));
  const counts = {
    items: { UNSTARTED: 0, BOUND: 0, CLOSED: 0, CANCELLED: 0, EXPIRED: 0 },
    upload: { INITIATED: 0, OBJECT_VERIFIED: 0, COMPLETED: 0, EXPIRED: 0, CANCELLED: 0, FAILED: 0 },
    security: { PENDING: 0, PASSED: 0, REJECTED: 0, INCONCLUSIVE: 0, INVALIDATED: 0 },
    availability: { CANDIDATE: 0, AVAILABLE: 0, UNAVAILABLE: 0 },
    processing: {
      NOT_SCHEDULED: 0,
      WAITING_FOR_SECURITY: 0,
      QUEUED: 0,
      RUNNING: 0,
      SUCCEEDED: 0,
      PARTIAL: 0,
      FAILED: 0,
      UNSUPPORTED: 0,
      CANCELLED: 0,
    },
  };
  for (const item of items) counts.items[item.state as keyof typeof counts.items]++;
  for (const s of sessions) {
    counts.upload[s.upload_state]++;
    const view = projectSession(s);
    counts.security[view.security]++;
    counts.processing[view.processing]++;
    counts.availability[view.availability]++;
  }
  const page = items.filter((i) => i.ordinal > after).slice(0, limit);
  const last = page.at(-1);
  return batchStatusSchema.parse({
    id,
    state: batch.state,
    expiresAt: batch.expires_at.toISOString(),
    total: items.length,
    counts,
    items: page.map((i) => ({
      itemId: i.item_id,
      operation: i.operation,
      fileName: i.descriptor.fileName,
      state: i.state,
      session: (i.upload_id ? map.get(i.upload_id) : null) ?? null,
      admissionError: i.admission_error,
      retryAfterSeconds: ['CAPACITY_EXCEEDED', 'CAPACITY_UNAVAILABLE'].includes(
        i.admission_error ?? '',
      )
        ? 2
        : null,
    })),
    nextCursor: last && items.some((i) => i.ordinal > last.ordinal) ? cursor(last.ordinal) : null,
  });
}
