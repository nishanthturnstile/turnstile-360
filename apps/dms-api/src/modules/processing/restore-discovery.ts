import { randomUUID } from 'node:crypto';
import { appendDocumentAudit } from '../audit/document-audit.js';
import { lockOriginal } from '../documents/download-policy.js';
import { StorageFailure } from '../storage/s3-storage.js';
import type { StorageService } from '../storage/storage.service.js';
import { lockUsage } from '../uploads/admission.service.js';
import { reconcileAdmission, releaseWorkReservation } from '../uploads/admission-maintenance.js';
import type { WorkService } from './work.service.js';
import { enqueueWork, lockWorkSource, sourceActive, wall } from './work-state.js';
// No object copy and no trust in historical signatures. Persist a fresh assessment
// reference only if the immutable source and its captured invalidation generation survive.
export async function selectRestores(work: WorkService, storage: StorageService) {
  const rows = await work.internal(
    async (tx) =>
      (
        await tx.client.query(
          "SELECT r.id FROM dms.binary_restore r JOIN dms.upload_session s ON s.id=r.id WHERE s.upload_state='OBJECT_VERIFIED' AND NOT EXISTS(SELECT 1 FROM dms.security_candidate c WHERE c.upload_id=r.id) ORDER BY r.created_at,r.id LIMIT 5",
        )
      ).rows,
  );
  for (const row of rows)
    await work.internal(async (tx) => {
      const source = await lockWorkSource(tx, row.id);
      if (!sourceActive(source, await wall(tx.client))) return;
      await lockOriginal(tx.client, tx.context.tenantId, source.document_id, true);
      if (
        (
          await tx.client.query('SELECT id FROM dms.security_candidate WHERE upload_id=$1', [
            row.id,
          ])
        ).rowCount
      )
        return;
      const ref = (
        await tx.client.query(
          `SELECT c.*,r.source_generation,old.document_id AS source_document_id FROM dms.binary_restore r JOIN dms.security_candidate c ON c.id=r.source_candidate_id JOIN dms.upload_admission old ON old.id=c.upload_id WHERE r.id=$1`,
          [row.id],
        )
      ).rows[0];
      let valid =
        ref &&
        ref.source_document_id === source.document_id &&
        ref.source_generation === ref.invalidation_generation &&
        ref.sha256 === source.descriptor.sha256;
      if (valid) {
        try {
          const head = await storage.forRole('originalRead').head({
            area: 'originals',
            tenantId: tx.context.tenantId,
            applicationId: source.application_id,
            id: ref.object_id,
          });
          valid = head.size === Number(ref.size) && head.etag === ref.etag;
        } catch (error) {
          if (!(error instanceof StorageFailure) || error.code !== 'not-found') throw error;
          valid = false;
        }
      }
      if (!valid) {
        await tx.client.query(
          "UPDATE dms.upload_session SET upload_state='FAILED',failure_code='SECURITY_ASSESSMENT_FAILED' WHERE id=$1",
          [row.id],
        );
        await tx.client.query(
          "UPDATE dms.document_version SET availability='UNAVAILABLE' WHERE id=$1",
          [source.version_id],
        );
        await appendDocumentAudit(tx, {
          documentId: source.document_id,
          applicationId: source.application_id,
          action: 'upload.failed',
        });
        return;
      }
      await tx.client.query(
        `INSERT INTO dms.security_candidate (id,tenant_id,application_id,upload_id,object_id,etag,size,invalidation_generation) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          randomUUID(),
          tx.context.tenantId,
          source.application_id,
          row.id,
          ref.object_id,
          ref.etag,
          ref.size,
          ref.invalidation_generation,
        ],
      );
      await enqueueWork(tx, row.id, 'document.scan');
    });
}

export async function settleFailedRestores(work: WorkService) {
  const rows = await work.internal(
    async (tx) =>
      (
        await tx.client.query(
          "SELECT r.id,a.application_id FROM dms.binary_restore r JOIN dms.upload_admission a ON a.id=r.id JOIN dms.upload_session s ON s.id=r.id WHERE a.state='RESERVED' AND s.upload_state IN ('FAILED','CANCELLED','EXPIRED') AND NOT EXISTS(SELECT 1 FROM dms.security_candidate c WHERE c.upload_id=r.id) ORDER BY r.id LIMIT 10",
        )
      ).rows,
  );
  for (const row of rows)
    await work.internal(async (tx) => {
      await tx.client.query('SELECT id FROM dms.application_registration WHERE id=$1 FOR SHARE', [
        row.application_id,
      ]);
      await lockUsage(tx.client, tx.context.tenantId, row.application_id);
      const source = await lockWorkSource(tx, row.id);
      if (
        source.admission_state !== 'RESERVED' ||
        !['FAILED', 'CANCELLED', 'EXPIRED'].includes(source.upload_state)
      )
        return;
      await reconcileAdmission(tx, row.id, { stagingBytes: 0, originalBytes: 0 }, 'SETTLED');
      await releaseWorkReservation(tx, row.id);
    });
}
