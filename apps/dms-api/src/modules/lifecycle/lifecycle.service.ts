import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { type DmsErrorCode, lifecycleResponseSchema } from '@thaarei/dms-contracts/public';
import type { MachinePrincipal } from '../access/access-policy.js';
import { DmsDatabaseService } from '../access/dms-database/dms-database.service.js';
import { dmsError } from '../access/dms-errors.js';
import { type DmsTransaction, requireResourceOwner } from '../access/resource-policy.js';
import { CURRENT_ORIGINAL } from '../documents/download-policy.js';
export async function inspectLifecycle(tx: DmsTransaction, id: string) {
  const doc = (
    await tx.client.query(
      `SELECT d.*,EXISTS(${CURRENT_ORIGINAL}) AS downloadable FROM dms.document d WHERE d.id=$1`,
      [id],
    )
  ).rows[0];
  if (!doc) return dmsError(404, 'DOCUMENT_NOT_FOUND');
  requireResourceOwner(tx, { tenantId: doc.tenant_id, ownerApplicationId: doc.application_id });
  const counts = (
    await tx.client.query(
      "SELECT count(*) FILTER(WHERE state='PENDING')::int AS pending,count(*) FILTER(WHERE state='SCANNING')::int AS scanning,count(*) FILTER(WHERE state='COMPLETE')::int AS completed,count(*) FILTER(WHERE state='FAILED')::int AS failed FROM dms.lifecycle_restore WHERE document_id=$1 AND generation=$2",
      [id, doc.lifecycle_generation],
    )
  ).rows[0];
  const state =
    doc.lifecycle !== 'ACTIVE' || !doc.restored_at
      ? 'NOT_REQUESTED'
      : counts.pending + counts.scanning > 0
        ? 'PENDING'
        : counts.failed > 0
          ? counts.completed > 0
            ? 'PARTIAL'
            : 'FAILED'
          : 'COMPLETE';
  return lifecycleResponseSchema.parse({
    documentId: doc.id,
    revision: String(doc.revision),
    generation: doc.lifecycle_generation,
    lifecycle: doc.lifecycle,
    deletedAt: doc.deleted_at?.toISOString() ?? null,
    restoreDeadline: doc.restore_deadline?.toISOString() ?? null,
    restoredAt: doc.restored_at?.toISOString() ?? null,
    currentVersionId: doc.current_version_id,
    downloadable: doc.downloadable,
    restoration: { state, ...counts },
  });
}
export async function changeLifecycle(
  tx: DmsTransaction,
  id: string,
  operation: 'delete' | 'restore',
  expected: string,
  key?: string,
  requestId: string = randomUUID(),
) {
  const result = (
    await tx.client.query('SELECT dms.change_document_lifecycle($1,$2,$3,$4,$5) AS outcome', [
      id,
      expected,
      operation,
      key ?? null,
      requestId,
    ])
  ).rows[0]?.outcome;
  if (result !== 'CHANGED' && result !== 'REPLAY') {
    const status =
      result === 'REVISION_CONFLICT'
        ? 412
        : result === 'RESTORE_WINDOW_EXPIRED' || result === 'REPLAY_WINDOW_EXPIRED'
          ? 410
          : result === 'DOCUMENT_NOT_FOUND'
            ? 404
            : result === 'APPLICATION_DENIED' || result === 'POLICY_DENIED'
              ? 403
              : result === 'DOCUMENT_UNAVAILABLE' || result === 'IDEMPOTENCY_CONFLICT'
                ? 409
                : 400;
    return dmsError(status, result as DmsErrorCode);
  }
  return { lifecycle: await inspectLifecycle(tx, id), replay: result === 'REPLAY' };
}
@Injectable()
export class LifecycleService {
  constructor(private readonly database: DmsDatabaseService) {}
  read(principal: MachinePrincipal, id: string) {
    return this.database.withMachine(principal, ['dms:documents:read'], (tx) =>
      inspectLifecycle(tx, id),
    );
  }
  change(
    principal: MachinePrincipal,
    id: string,
    operation: 'delete' | 'restore',
    expected: string,
    key: string | undefined,
    requestId: string,
  ) {
    return this.database.withMachine(
      principal,
      ['dms:documents:write'],
      (tx) => changeLifecycle(tx, id, operation, expected, key, requestId),
      false,
      true,
    );
  }
}
