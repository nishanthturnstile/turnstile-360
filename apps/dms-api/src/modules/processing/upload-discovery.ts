import { randomUUID } from 'node:crypto';
import { appendDocumentAudit } from '../audit/document-audit.js';
import { StorageFailure } from '../storage/s3-storage.js';
import type { StorageService } from '../storage/storage.service.js';
import { batchAudit } from '../uploads/upload-state.js';
import type { WorkService } from './work.service.js';
import { type CoordinatorTx, later, lockWorkSource, sourceActive, wall } from './work-state.js';

// Bounded discovery leases persist before I/O. A cancelled/expired source or stale
// lease can never accept a delayed HEAD. Object observation is not security evidence.
export async function discoverUploads(work: WorkService, storage: StorageService) {
  const ids = await work.internal(async (tx) =>
    (
      await tx.client.query(
        "SELECT s.id FROM dms.upload_session s JOIN dms.upload_admission a ON a.id=s.id JOIN dms.application_registration r ON r.id=a.application_id WHERE s.upload_state='INITIATED' AND a.expires_at>clock_timestamp() AND r.status='active' AND discovery_next_at<=clock_timestamp() AND (discovery_until IS NULL OR discovery_until<=clock_timestamp()) ORDER BY discovery_next_at,s.id LIMIT 10",
      )
    ).rows.map((r) => r.id as string),
  );
  let verified = 0;
  for (const id of ids) {
    const claim = await work.internal(async (tx) => {
      const source = await lockWorkSource(tx, id),
        now = await wall(tx.client);
      if (
        !sourceActive(source, now) ||
        source.upload_state !== 'INITIATED' ||
        source.discovery_next_at > now ||
        (source.discovery_until && source.discovery_until > now)
      )
        return null;
      const token = randomUUID();
      await tx.client.query(
        'UPDATE dms.upload_session SET discovery_token=$1,discovery_until=$2 WHERE id=$3',
        [token, later(now, 60), id],
      );
      return {
        token,
        source,
        reference: {
          area: 'staging' as const,
          tenantId: tx.context.tenantId,
          applicationId: source.application_id as string,
          id: source.staging_id as string,
        },
      };
    });
    if (!claim) continue;
    let observation: { size: number; contentType: string | undefined; etag: string } | null = null;
    try {
      observation = await storage.forRole('snapshot').head(claim.reference);
    } catch (error) {
      if (!(error instanceof StorageFailure)) throw error;
      // Missing objects and unavailable storage retain reservations and no security claim.
    }
    const accepted = await work.internal(async (tx) => {
      const source = await lockWorkSource(tx, id),
        now = await wall(tx.client);
      if (
        source.discovery_token !== claim.token ||
        !source.discovery_until ||
        source.discovery_until <= now ||
        source.upload_state !== 'INITIATED' ||
        !sourceActive(source, now)
      )
        return false;
      if (!observation) {
        await tx.client.query(
          'UPDATE dms.upload_session SET discovery_token=NULL,discovery_until=NULL,discovery_next_at=$1 WHERE id=$2',
          [later(now, 15), id],
        );
        return false;
      }
      const failure =
        observation.size !== source.descriptor.size
          ? 'SIZE_MISMATCH'
          : observation.contentType !== source.descriptor.contentType
            ? 'CONTENT_TYPE_MISMATCH'
            : null;
      await tx.client.query(
        'UPDATE dms.upload_session SET upload_state=$1,observed_etag=$2,observed_size=$3,observed_at=$4,failure_code=$5,discovery_token=NULL,discovery_until=NULL WHERE id=$6',
        [
          failure ? 'FAILED' : 'OBJECT_VERIFIED',
          observation.etag,
          observation.size,
          now,
          failure,
          id,
        ],
      );
      await discoveryAudit(tx, source, failure ? 'upload.failed' : 'upload.object-verified');
      return !failure;
    });
    if (accepted) verified++;
  }
  return { verified };
}
async function discoveryAudit(
  tx: CoordinatorTx,
  source: Record<string, unknown>,
  action: 'upload.failed' | 'upload.object-verified',
) {
  await appendDocumentAudit(tx, {
    documentId: source.document_id as string,
    applicationId: source.application_id as string,
    action,
  });
}

export async function expireUploads(work: WorkService) {
  const ids = await work.internal(async (tx) =>
    (
      await tx.client.query(
        "SELECT s.id FROM dms.upload_session s JOIN dms.upload_admission a ON a.id=s.id JOIN dms.application_registration r ON r.id=a.application_id WHERE s.upload_state IN ('INITIATED','OBJECT_VERIFIED') AND (a.expires_at<=clock_timestamp() OR r.status<>'active') ORDER BY a.expires_at,s.id LIMIT 20",
      )
    ).rows.map((r) => r.id as string),
  );
  for (const id of ids)
    await work.internal(async (tx) => {
      const source = await lockWorkSource(tx, id),
        now = await wall(tx.client);
      if (
        !['INITIATED', 'OBJECT_VERIFIED'].includes(source.upload_state) ||
        sourceActive(source, now)
      )
        return;
      const expired = source.expires_at <= now;
      await tx.client.query(
        'UPDATE dms.upload_session SET upload_state=$1,discovery_token=NULL,discovery_until=NULL WHERE id=$2',
        [expired ? 'EXPIRED' : 'CANCELLED', id],
      );
      await appendDocumentAudit(tx, {
        documentId: source.document_id,
        applicationId: source.application_id,
        action: expired ? 'upload.expired' : 'upload.cancelled',
      });
    });
  return { expired: ids.length };
}

export async function expireBatches(work: WorkService) {
  const rows = await work.internal(
    async (tx) =>
      (
        await tx.client.query(
          "SELECT b.id,b.application_id FROM dms.upload_batch b JOIN dms.application_registration r ON r.id=b.application_id WHERE b.state='OPEN' AND (b.expires_at<=clock_timestamp() OR r.status<>'active') ORDER BY b.expires_at,b.id LIMIT 20",
        )
      ).rows,
  );
  for (const row of rows)
    await work.internal(async (tx) => {
      const registration = (
        await tx.client.query(
          'SELECT status FROM dms.application_registration WHERE id=$1 FOR SHARE',
          [row.application_id],
        )
      ).rows[0];
      const batch = (
        await tx.client.query(
          'SELECT *,expires_at<=clock_timestamp() AS expired FROM dms.upload_batch WHERE id=$1 FOR UPDATE',
          [row.id],
        )
      ).rows[0];
      if (batch?.state !== 'OPEN' || (!batch.expired && registration?.status === 'active')) return;
      const state = batch.expired ? 'EXPIRED' : 'CANCELLED';
      await tx.client.query('UPDATE dms.upload_batch SET state=$1 WHERE id=$2', [state, batch.id]);
      await tx.client.query(
        "UPDATE dms.upload_batch_item SET state=$1 WHERE batch_id=$2 AND state='UNSTARTED'",
        [state, batch.id],
      );
      await tx.client.query('UPDATE dms.upload_batch_slot SET active=false WHERE id=$1', [
        batch.id,
      ]);
      await batchAudit(
        tx,
        batch.id,
        batch.expired ? 'batch.expired' : 'batch.cancelled',
        undefined,
        batch.application_id,
      );
    });
  return { expired: rows.length };
}
