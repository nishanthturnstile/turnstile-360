import { randomUUID } from 'node:crypto';
import type { WorkService } from '../processing/work.service.js';
import { StorageFailure } from '../storage/s3-storage.js';
import type { StorageService } from '../storage/storage.service.js';
import type { ObjectReference } from '../storage/storage-configuration.js';

// The durable tombstone prevents new references while network calls happen outside
// transactions. A lost DELETE acknowledgement is reconciled by authenticated HEAD.
export async function disposeObjects(work: WorkService, storage: StorageService) {
  const intents = await work.internal(
    async (tx) =>
      (
        await tx.client.query(
          `SELECT id FROM dms.disposal_intent WHERE state<>'COMPLETE' AND dms.disposal_eligible(area,application_id,object_id) AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp()) ORDER BY next_attempt_at,id LIMIT 5`,
        )
      ).rows,
  );
  for (const intent of intents) {
    const claimed = await work.internal(async (tx) => {
      const row = (
        await tx.client.query(
          `SELECT * FROM dms.disposal_intent WHERE id=$1 AND state<>'COMPLETE' AND (lease_until IS NULL OR lease_until<clock_timestamp()) FOR UPDATE`,
          [intent.id],
        )
      ).rows[0];
      if (
        !row ||
        !(
          await tx.client.query('SELECT dms.disposal_eligible($1,$2,$3) AS eligible', [
            row.area,
            row.application_id,
            row.object_id,
          ])
        ).rows[0]?.eligible
      )
        return null;
      const lease = randomUUID();
      await tx.client.query(
        `UPDATE dms.disposal_intent SET state='DELETING',lease_id=$2,lease_until=clock_timestamp()+interval '120 seconds' WHERE id=$1`,
        [row.id, lease],
      );
      return {
        row,
        lease,
        reference: {
          area: row.area,
          tenantId: tx.context.tenantId,
          applicationId: row.application_id,
          id: row.object_id,
        } as ObjectReference,
      };
    });
    if (!claimed) continue;
    const { row, lease, reference } = claimed;
    try {
      const cleanup = storage.forRole('cleanup');
      await cleanup.requireUnversioned(reference.area);
      try {
        await cleanup.deleteExact(reference);
      } catch (error) {
        if (!(error instanceof StorageFailure) || error.code === 'denied') throw error;
      }
      let absent = false;
      try {
        await storage
          .forRole(
            reference.area === 'staging'
              ? 'snapshot'
              : reference.area === 'originals'
                ? 'originalRead'
                : 'artifactRead',
          )
          .head(reference);
      } catch (error) {
        if (error instanceof StorageFailure && error.code === 'not-found') absent = true;
        else throw error;
      }
      if (!absent) throw new StorageFailure('unavailable');
      await cleanup.requireUnversioned(reference.area);
      await work.internal((tx) =>
        tx.client.query('SELECT dms.finish_disposal($1,$2)', [row.id, lease]),
      );
    } catch {
      await work.internal((tx) =>
        tx.client.query(
          `UPDATE dms.disposal_intent SET lease_until=NULL,next_attempt_at=clock_timestamp()+interval '60 seconds' WHERE id=$1 AND lease_id=$2 AND state<>'COMPLETE'`,
          [row.id, lease],
        ),
      );
      if (process.stdout.writableLength < 65536)
        process.stdout.write(`${JSON.stringify({ type: 'disposal', outcome: 'retryable' })}\n`);
    }
  }
  await work.internal((tx) => tx.client.query('SELECT dms.complete_purged_documents()'));
}
