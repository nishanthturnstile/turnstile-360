import { operatorBatchInspectionSchema } from '@thaarei/dms-contracts/private';
import type { DmsTransaction, OperatorContext } from '../access/resource-policy.js';
import { insertSecurityEvent } from '../audit/security-event.js';
import { type BatchItemRow, projectBatch } from './batches.service.js';
import { projectSession, SESSION_SELECT, type SessionRow } from './upload-state.js';

// Fresh operator proof and a current DMS grant are checked by withOperatorRead.
// These reads have SELECT-only registry grants; they issue no transfer authority.
export async function inspectUploadOperation(
  tx: DmsTransaction<OperatorContext>,
  input:
    | { action: 'upload-inspect'; uploadId: string }
    | {
        action: 'batch-inspect';
        batchId: string;
        after?: number | undefined;
        limit?: number | undefined;
      },
) {
  const wall = (await tx.client.query('SELECT clock_timestamp() AS wall')).rows[0].wall as Date;
  const current = (s: SessionRow) => {
    if (['INITIATED', 'OBJECT_VERIFIED'].includes(s.upload_state) && s.expires_at <= wall)
      s.upload_state = 'EXPIRED';
    return s;
  };
  if (input.action === 'upload-inspect') {
    const row = (
      await tx.client.query<SessionRow>(`${SESSION_SELECT} WHERE s.id=$1`, [input.uploadId])
    ).rows[0];
    if (!row) throw new Error('Upload unavailable');
    await evidence(tx, input.uploadId, 'operator.upload.inspect');
    return projectSession(current(row));
  }
  const batch = (
    await tx.client.query('SELECT * FROM dms.upload_batch WHERE id=$1', [input.batchId])
  ).rows[0];
  if (!batch) throw new Error('Batch unavailable');
  if (batch.state === 'OPEN' && batch.expires_at <= wall) batch.state = 'EXPIRED';
  const items = (
    await tx.client.query<BatchItemRow>(
      'SELECT * FROM dms.upload_batch_item WHERE batch_id=$1 ORDER BY ordinal',
      [batch.id],
    )
  ).rows;
  if (batch.state === 'EXPIRED')
    for (const item of items) if (item.state === 'UNSTARTED') item.state = 'EXPIRED';
  const sessions = (
    await tx.client.query<SessionRow>(`${SESSION_SELECT} WHERE s.batch_id=$1 ORDER BY s.id`, [
      batch.id,
    ])
  ).rows.map(current);
  let nextAfter: number | null = null;
  const { nextCursor: _cursor, ...result } = projectBatch(
    batch,
    items,
    sessions,
    input.limit ?? 20,
    input.after ?? -1,
    (last) => {
      nextAfter = last;
      return null;
    },
  );
  await evidence(tx, batch.id, 'operator.batch.inspect');
  return operatorBatchInspectionSchema.parse({ ...result, nextAfter });
}
async function evidence(tx: DmsTransaction<OperatorContext>, subjectId: string, action: string) {
  await insertSecurityEvent(tx.client, tx.context.tenantId, {
    action,
    actorKind: 'operator',
    actorId: tx.context.subjectId,
    subjectId,
    outcome: 'success',
  });
}
