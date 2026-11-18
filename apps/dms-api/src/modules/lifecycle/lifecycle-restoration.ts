import { randomUUID } from 'node:crypto';
import { DOCUMENT_LIMITS } from '@thaarei/dms-contracts/public';
import { lockOriginal } from '../documents/download-policy.js';
import type { WorkService } from '../processing/work.service.js';
import { createDispatch, enqueueWork, jobAudit, lockWorkSource } from '../processing/work-state.js';
import { StorageFailure } from '../storage/s3-storage.js';
import type { StorageService } from '../storage/storage.service.js';
import { lockUsage, measuredStorageBytes } from '../uploads/admission.service.js';
import { reconcileAdmission } from '../uploads/admission-maintenance.js';
import { AdmissionFeatures, readAdmissionPolicy } from '../uploads/admission-policy.js';

// Verify outside database locks; compare the captured lifecycle/object generations again
// on apply. Delete can win during I/O without waiting for a complete original GET.
export async function restoreLifecycleVersions(work: WorkService, storage: StorageService) {
  const rows = await work.internal(
    async (tx) =>
      (
        await tx.client.query(
          "SELECT q.*,c.object_id,c.etag,c.size,c.expected_sha256,c.invalidation_generation FROM dms.lifecycle_restore q JOIN dms.security_candidate c ON c.upload_id=q.upload_id JOIN dms.document d ON d.id=q.document_id WHERE q.state='PENDING' AND q.generation=d.lifecycle_generation AND d.lifecycle='ACTIVE' AND q.next_attempt_at<=clock_timestamp() ORDER BY q.next_attempt_at,q.id LIMIT 5",
        )
      ).rows,
  );
  for (const row of rows) {
    let failure: string | null = null;
    try {
      await storage.forRole('originalRead').verifyOriginal(
        {
          area: 'originals',
          tenantId: row.tenant_id,
          applicationId: row.application_id,
          id: row.object_id,
        },
        { size: Number(row.size), etag: row.etag, sha256: row.expected_sha256 },
      );
    } catch (error) {
      failure =
        error instanceof StorageFailure && error.code === 'precondition'
          ? 'INTEGRITY_MISMATCH'
          : error instanceof StorageFailure && error.code === 'not-found'
            ? 'OBJECT_UNAVAILABLE'
            : 'CAPACITY_UNAVAILABLE';
    }
    await work.internal(async (tx) => {
      await tx.client.query('SELECT id FROM dms.application_registration WHERE id=$1 FOR SHARE', [
        row.application_id,
      ]);
      await lockUsage(tx.client, tx.context.tenantId, row.application_id);
      const source = await lockWorkSource(tx, row.upload_id);
      await lockOriginal(tx.client, tx.context.tenantId, row.document_id, true);
      const q = (
        await tx.client.query('SELECT * FROM dms.lifecycle_restore WHERE id=$1 FOR UPDATE', [
          row.id,
        ])
      ).rows[0];
      const c = (
        await tx.client.query(
          'SELECT * FROM dms.security_candidate WHERE upload_id=$1 FOR UPDATE',
          [row.upload_id],
        )
      ).rows[0];
      if (
        q?.state !== 'PENDING' ||
        source.lifecycle !== 'ACTIVE' ||
        source.document_generation !== q.generation ||
        c?.invalidation_generation !== row.invalidation_generation ||
        c?.expected_sha256 !== row.expected_sha256 ||
        c?.etag !== row.etag
      )
        return;
      const defer = async (code: string) =>
        tx.client.query(
          "UPDATE dms.lifecycle_restore SET failure_code=$2,next_attempt_at=clock_timestamp()+interval '30 seconds' WHERE id=$1",
          [q.id, code],
        );
      if (failure) {
        if (failure === 'CAPACITY_UNAVAILABLE') {
          await defer(failure);
          return;
        }
        await tx.client.query(
          "UPDATE dms.lifecycle_restore SET state='FAILED',failure_code=$2 WHERE id=$1",
          [q.id, failure],
        );
        return;
      }
      const policy = await readAdmissionPolicy(tx.client, true),
        features = new AdmissionFeatures();
      if (
        !policy?.settings.enabled ||
        !policy.settings.contentTypes.includes(source.descriptor.contentType) ||
        !policy.settings.profiles.includes(source.descriptor.profile) ||
        Number(c.size) > policy.settings.maxFileBytes ||
        !features.supports(source.descriptor.contentType, source.descriptor.profile) ||
        source.application_status !== 'active'
      ) {
        await defer('POLICY_DENIED');
        return;
      }
      const capacity = (
        await tx.client.query(
          "SELECT *,observed_at>clock_timestamp()-interval '30 seconds' AND observed_at<=clock_timestamp() AS fresh FROM dms.admission_capacity",
        )
      ).rows[0];
      if (!capacity?.fresh) {
        await defer('CAPACITY_UNAVAILABLE');
        return;
      }
      const usage = await lockUsage(tx.client, tx.context.tenantId, row.application_id),
        extra = source.work_released ? DOCUMENT_LIMITS.scratchPerUploadBytes : 0;
      if (
        Number(usage.tenant.reserved_scratch) + extra > policy.settings.scratchBudgetBytes ||
        Number(usage.tenant.reserved_scratch) + extra > Number(capacity.scratch_free_bytes) ||
        Number(usage.tenant.queued) + (extra ? 1 : 0) > policy.settings.queuedWork ||
        Number(usage.app.queued) + (extra ? 1 : 0) > Math.min(25, policy.settings.queuedWork) ||
        (capacity.shared_device &&
          Number(usage.tenant.reserved_storage) +
            Math.max(0, measuredStorageBytes(usage.tenant) - Number(capacity.used_at_observation)) +
            Number(usage.tenant.reserved_scratch) +
            extra >
            Number(capacity.storage_free_bytes))
      ) {
        await defer('CAPACITY_UNAVAILABLE');
        return;
      }
      if (source.admission_state === 'RESERVED')
        await reconcileAdmission(
          tx,
          row.upload_id,
          source.storage_mode === 'REUSE'
            ? { stagingBytes: 0, originalBytes: 0 }
            : { stagingBytes: Number(source.observed_size), originalBytes: Number(c.size) },
          'SETTLED',
        );
      if (extra) {
        await tx.client.query(
          'UPDATE dms.admission_tenant_usage SET queued=queued+1,reserved_scratch=reserved_scratch+$1',
          [extra],
        );
        await tx.client.query(
          'UPDATE dms.admission_application_usage SET queued=queued+1,reserved_scratch=reserved_scratch+$1 WHERE application_id=$2',
          [extra, row.application_id],
        );
      }
      await tx.client.query(
        'INSERT INTO dms.security_assessment_history(id,tenant_id,application_id,candidate_id,generation,state,sha256,evidence,assessed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          randomUUID(),
          row.tenant_id,
          row.application_id,
          c.id,
          c.invalidation_generation,
          c.state,
          c.sha256,
          c.evidence,
          c.assessed_at,
        ],
      );
      await tx.client.query(
        "UPDATE dms.security_candidate SET state='PENDING',sha256=NULL,evidence=NULL,assessed_at=NULL,invalidation_generation=invalidation_generation+1 WHERE id=$1",
        [c.id],
      );
      await tx.client.query(
        "UPDATE dms.upload_admission SET lifecycle_generation=$2,reassessment_until=clock_timestamp()+interval '24 hours',work_released=false,reserved_scratch=reserved_scratch+$3 WHERE id=$1",
        [row.upload_id, q.generation, extra],
      );
      await tx.client.query(
        "UPDATE dms.upload_session SET upload_state='OBJECT_VERIFIED',failure_code=NULL,completion_requested_at=coalesce(completion_requested_at,clock_timestamp()) WHERE id=$1",
        [row.upload_id],
      );
      await tx.client.query(
        "UPDATE dms.document_version SET lifecycle_generation=$2,availability='UNAVAILABLE' WHERE id=$1",
        [row.version_id, q.generation],
      );
      const old = (
        await tx.client.query(
          "SELECT * FROM dms.work_job WHERE upload_id=$1 AND task='document.scan' FOR UPDATE",
          [row.upload_id],
        )
      ).rows[0];
      if (old) {
        const job = (
          await tx.client.query(
            "UPDATE dms.work_job SET lifecycle_generation=$2,generation=generation+1,state='QUEUED',executions=0,recoveries=0,current_attempt_id=NULL,budget_started_at=NULL,deadline=NULL,next_eligible_at=NULL,recover_at=NULL,result_code=NULL,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",
            [old.id, q.generation],
          )
        ).rows[0];
        await createDispatch(tx, job);
        await jobAudit(tx, job, 'work.queued');
      } else await enqueueWork(tx, row.upload_id, 'document.scan');
      await tx.client.query(
        "UPDATE dms.lifecycle_restore SET state='SCANNING',failure_code=NULL WHERE id=$1",
        [q.id],
      );
    });
  }
}
