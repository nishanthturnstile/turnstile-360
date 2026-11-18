import { randomUUID } from 'node:crypto';
import { appendDocumentAudit } from '../audit/document-audit.js';
import { StorageFailure } from '../storage/s3-storage.js';
import type { StorageService } from '../storage/storage.service.js';
import { lockUsage } from '../uploads/admission.service.js';
import { reconcileAdmission, releaseWorkReservation } from '../uploads/admission-maintenance.js';
import { synchronizeProcessingRuns } from './results-state.js';
import type { WorkService } from './work.service.js';
import { enqueueWork, lockWorkSource, sourceActive, wall } from './work-state.js';

// Persist destination identity before copying. Concurrent coordinators choose one intent.
// Stale/ambiguous copies remain tracked and quarantined; physical cleanup stays deferred.
export async function selectCandidates(work: WorkService, storage: StorageService) {
  const rows = await work.internal(
    async (tx) =>
      (
        await tx.client.query(
          "SELECT s.id FROM dms.upload_session s WHERE upload_state='OBJECT_VERIFIED' AND NOT EXISTS (SELECT 1 FROM dms.binary_restore r WHERE r.id=s.id) AND NOT EXISTS (SELECT 1 FROM dms.security_candidate c WHERE c.upload_id=s.id) ORDER BY s.id LIMIT 5",
        )
      ).rows,
  );
  for (const row of rows) {
    const claim = await work.internal(async (tx) => {
      const source = await lockWorkSource(tx, row.id);
      if (!sourceActive(source, await wall(tx.client)) || source.upload_state !== 'OBJECT_VERIFIED')
        return null;
      const objectId = randomUUID(),
        candidateId = randomUUID();
      const inserted = await tx.client.query(
        "INSERT INTO dms.security_candidate (id,tenant_id,application_id,upload_id,object_id,etag,size,state) VALUES ($1,$2,$3,$4,$5,'pending',$6,'COPYING') ON CONFLICT (tenant_id,upload_id) DO NOTHING RETURNING id",
        [
          candidateId,
          tx.context.tenantId,
          source.application_id,
          row.id,
          objectId,
          source.observed_size,
        ],
      );
      if (!inserted.rowCount) return null;
      return {
        candidateId,
        objectId,
        source,
        ref: {
          area: 'staging' as const,
          tenantId: tx.context.tenantId,
          applicationId: source.application_id as string,
          id: source.staging_id as string,
        },
      };
    });
    if (!claim) continue;
    let copy: Awaited<ReturnType<ReturnType<StorageService['forRole']>['snapshot']>> | null = null;
    try {
      copy = await storage
        .forRole('snapshot')
        .snapshot(claim.ref, claim.source.observed_etag, claim.objectId);
    } catch {
      // The destination is persisted before I/O, including ambiguous copies. Never retry
      // a copy onto it or release its reserved physical capacity based on a network error.
    }
    await work.internal(async (tx) => {
      const source = await lockWorkSource(tx, row.id);
      const current = (
        await tx.client.query('SELECT * FROM dms.security_candidate WHERE id=$1 FOR UPDATE', [
          claim.candidateId,
        ])
      ).rows[0];
      if (current?.state !== 'COPYING') return;
      if (
        !copy ||
        !sourceActive(source, await wall(tx.client)) ||
        source.upload_state !== 'OBJECT_VERIFIED' ||
        copy.size !== Number(source.observed_size)
      ) {
        await tx.client.query(
          "UPDATE dms.security_candidate SET state='INCONCLUSIVE' WHERE id=$1",
          [claim.candidateId],
        );
        await tx.client.query(
          "UPDATE dms.upload_session SET upload_state='FAILED',failure_code='SECURITY_ASSESSMENT_FAILED' WHERE id=$1 AND upload_state='OBJECT_VERIFIED'",
          [row.id],
        );
        return;
      }
      await tx.client.query(
        "UPDATE dms.security_candidate SET state='PENDING',etag=$1 WHERE id=$2",
        [copy.etag, claim.candidateId],
      );
      await enqueueWork(tx, row.id, 'document.scan');
    });
  }
  // A crashed copy supervisor never silently chooses different bytes on its next tick.
  await work.internal(async (tx) => {
    const stranded = (
      await tx.client.query(
        "SELECT upload_id FROM dms.security_candidate WHERE state='COPYING' AND created_at<clock_timestamp()-interval '120 seconds' ORDER BY id LIMIT 5",
      )
    ).rows;
    for (const row of stranded) {
      await lockWorkSource(tx, row.upload_id);
      await tx.client.query(
        "UPDATE dms.security_candidate SET state='INCONCLUSIVE' WHERE upload_id=$1 AND state='COPYING'",
        [row.upload_id],
      );
      await tx.client.query(
        "UPDATE dms.upload_session SET upload_state='FAILED',failure_code='SECURITY_ASSESSMENT_FAILED' WHERE id=$1 AND upload_state='OBJECT_VERIFIED'",
        [row.upload_id],
      );
    }
  });
}
// Accounting follows verified snapshots even when security rejects them: quarantine
// still occupies disk. Do not release retained bytes or live staging capabilities.
export async function settleCandidates(work: WorkService) {
  const rows = await work.internal(
    async (tx) =>
      (
        await tx.client.query(
          "SELECT c.upload_id,a.application_id FROM dms.security_candidate c JOIN dms.upload_admission a ON a.id=c.upload_id JOIN dms.work_job j ON j.upload_id=c.upload_id AND j.task='document.scan' WHERE (a.state='RESERVED' OR NOT a.work_released) AND j.state IN ('SUCCEEDED','FAILED','UNSUPPORTED','CANCELLED') ORDER BY c.upload_id LIMIT 10",
        )
      ).rows,
  );
  for (const row of rows)
    await work.internal(async (tx) => {
      // Match usage settlement's global order, before source/admission row fences.
      await tx.client.query('SELECT id FROM dms.application_registration WHERE id=$1 FOR SHARE', [
        row.application_id,
      ]);
      await lockUsage(tx.client, tx.context.tenantId, row.application_id);
      const source = await lockWorkSource(tx, row.upload_id);
      const job = (
        await tx.client.query(
          "SELECT state FROM dms.work_job WHERE upload_id=$1 AND task='document.scan' FOR SHARE",
          [row.upload_id],
        )
      ).rows[0];
      if (!job || !['SUCCEEDED', 'FAILED', 'UNSUPPORTED', 'CANCELLED'].includes(job.state)) return;
      const candidate = (
        await tx.client.query(
          'SELECT * FROM dms.security_candidate WHERE upload_id=$1 FOR UPDATE',
          [row.upload_id],
        )
      ).rows[0];
      if (!candidate) return;
      if (candidate.state === 'PENDING') {
        await tx.client.query(
          "UPDATE dms.security_candidate SET state='INCONCLUSIVE' WHERE id=$1",
          [candidate.id],
        );
        await tx.client.query(
          "UPDATE dms.upload_session SET upload_state='FAILED',failure_code='SECURITY_ASSESSMENT_FAILED' WHERE id=$1 AND upload_state='OBJECT_VERIFIED'",
          [row.upload_id],
        );
        await appendDocumentAudit(tx, {
          documentId: source.document_id,
          applicationId: row.application_id,
          action: 'security.assessed',
        });
      }
      if (candidate.state !== 'PASSED')
        await tx.client.query(
          "UPDATE dms.upload_session SET upload_state='FAILED',failure_code='SECURITY_ASSESSMENT_FAILED' WHERE id=$1 AND upload_state='OBJECT_VERIFIED'",
          [row.upload_id],
        );
      if (source.admission_state === 'RESERVED')
        await reconcileAdmission(
          tx,
          row.upload_id,
          source.storage_mode === 'REUSE'
            ? { stagingBytes: 0, originalBytes: 0 }
            : { stagingBytes: Number(source.observed_size), originalBytes: Number(candidate.size) },
          'SETTLED',
        );
      const pending = (
        await tx.client.query(
          "SELECT id FROM dms.work_job WHERE upload_id=$1 AND task<>'document.scan' AND state IN ('QUEUED','RUNNING','RETRY_WAIT') LIMIT 1",
          [row.upload_id],
        )
      ).rows[0];
      await synchronizeProcessingRuns(tx, row.upload_id);
      if (!pending) await releaseWorkReservation(tx, row.upload_id);
      await tx.client.query(
        "UPDATE dms.lifecycle_restore q SET state=CASE WHEN c.state='PASSED' THEN 'COMPLETE' ELSE 'FAILED' END,failure_code=CASE WHEN c.state='PASSED' THEN NULL ELSE 'SECURITY_ASSESSMENT_FAILED' END FROM dms.security_candidate c WHERE q.upload_id=$1 AND c.upload_id=q.upload_id AND q.generation=$2 AND q.state='SCANNING'",
        [row.upload_id, source.document_generation],
      );
    });
}

// Terminal uploads may never create a scanner job (abandoned PUT or failed copy).
// Observe exact keys only after every upload capability has expired, then convert
// reservations into measured retained bytes. Missing objects are authenticated absence;
// storage outages leave reservations intact for the next coordinator pass.
export async function settleAbandonedUploads(work: WorkService, storage: StorageService) {
  const rows = await work.internal(
    async (tx) =>
      (
        await tx.client.query(
          `SELECT a.id,a.application_id FROM dms.upload_admission a JOIN dms.upload_session s ON s.id=a.id
     WHERE a.state='RESERVED' AND a.storage_mode='UPLOAD' AND s.upload_state IN ('FAILED','CANCELLED','EXPIRED')
     AND coalesce(a.capability_expires_at,a.created_at)+interval '60 seconds'<clock_timestamp()
     AND NOT EXISTS(SELECT 1 FROM dms.work_job j WHERE j.upload_id=a.id)
     AND NOT EXISTS(SELECT 1 FROM dms.security_candidate c WHERE c.upload_id=a.id AND c.state='COPYING')
     ORDER BY a.id LIMIT 10`,
        )
      ).rows,
  );
  for (const row of rows) {
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
      const admission = (
        await tx.client.query(
          "SELECT *,coalesce(capability_expires_at,created_at)+interval '60 seconds'<clock_timestamp() AS expired FROM dms.upload_admission WHERE id=$1",
          [row.id],
        )
      ).rows[0];
      if (
        !admission.expired ||
        (await tx.client.query('SELECT id FROM dms.work_job WHERE upload_id=$1', [row.id])).rowCount
      )
        return;
      const candidate = (
        await tx.client.query(
          'SELECT * FROM dms.security_candidate WHERE upload_id=$1 FOR UPDATE',
          [row.id],
        )
      ).rows[0];
      if (candidate?.state === 'COPYING') return;
      const bytes = async (area: 'staging' | 'originals', id: string) => {
        try {
          return (
            await storage
              .forRole(area === 'staging' ? 'snapshot' : 'originalRead')
              .head({ area, tenantId: tx.context.tenantId, applicationId: row.application_id, id })
          ).size;
        } catch (error) {
          if (error instanceof StorageFailure && error.code === 'not-found') return 0;
          throw error;
        }
      };
      await reconcileAdmission(
        tx,
        row.id,
        {
          stagingBytes: await bytes('staging', source.staging_id),
          originalBytes: candidate ? await bytes('originals', candidate.object_id) : 0,
        },
        'RELEASED',
      );
    });
  }
}
