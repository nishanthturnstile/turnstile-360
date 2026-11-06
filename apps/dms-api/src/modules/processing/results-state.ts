import { randomUUID } from 'node:crypto';
import { appendDocumentAudit } from '../audit/document-audit.js';
import { lockOriginal } from '../documents/download-policy.js';
import type { CoordinatorTx } from './work-state.js';

// Call while the upload/source fence is held. Initial processing has no consumer receipt.
export async function initialProcessingRun(tx: CoordinatorTx, uploadId: string) {
  const source = (
    await tx.client.query(
      `SELECT a.*,d.lifecycle_generation AS epoch,c.sha256 FROM dms.upload_admission a JOIN dms.document d ON d.id=a.document_id JOIN dms.security_candidate c ON c.upload_id=a.id WHERE a.id=$1 AND c.state='PASSED'`,
      [uploadId],
    )
  ).rows[0];
  const existing = (
    await tx.client.query(
      'SELECT id FROM dms.processing_run WHERE upload_id=$1 AND lifecycle_generation=$2 ORDER BY number DESC LIMIT 1',
      [uploadId, source.epoch],
    )
  ).rows[0];
  if (existing) return existing.id as string;
  const id = randomUUID();
  await tx.client.query(
    `INSERT INTO dms.processing_run(id,tenant_id,application_id,document_id,version_id,upload_id,number,lifecycle_generation,profile,source_sha256,actor_kind,actor_id,expires_at) SELECT $1,$2,$3,$4,$5,$6,coalesce(max(number),0)+1,$7,$8,$9,'coordinator','thaarei_dms_coordinator',coalesce($10::timestamptz,clock_timestamp()+interval '24 hours') FROM dms.processing_run WHERE version_id=$5`,
    [
      id,
      tx.context.tenantId,
      source.application_id,
      source.document_id,
      source.version_id,
      uploadId,
      source.epoch,
      source.profile,
      source.sha256,
      source.reassessment_until ?? source.expires_at,
    ],
  );
  return id;
}

// The final required stage controls promotion. Failed OCR/structure replacements cannot
// fall back to a native stage and evict a useful accepted result from an earlier run.
export async function synchronizeProcessingRuns(tx: CoordinatorTx, uploadId: string) {
  const source = (
    await tx.client.query('SELECT document_id FROM dms.upload_admission WHERE id=$1', [uploadId])
  ).rows[0];
  if (source) await lockOriginal(tx.client, tx.context.tenantId, source.document_id);
  const runs = (
    await tx.client.query(
      "SELECT * FROM dms.processing_run WHERE upload_id=$1 AND state IN ('QUEUED','RUNNING') ORDER BY number FOR UPDATE",
      [uploadId],
    )
  ).rows;
  for (const run of runs) {
    const jobs = (
      await tx.client.query(
        "SELECT * FROM dms.work_job WHERE processing_run_id=$1 ORDER BY CASE WHEN task='document.heavy' THEN 0 ELSE 1 END",
        [run.id],
      )
    ).rows;
    if (!jobs.length) continue;
    if (jobs.some((j) => ['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(j.state))) {
      if (jobs.some((j) => j.state !== 'QUEUED'))
        await tx.client.query("UPDATE dms.processing_run SET state='RUNNING' WHERE id=$1", [
          run.id,
        ]);
      continue;
    }
    const job = jobs[0];
    const stage = (
      await tx.client.query(
        "SELECT * FROM dms.extraction_stage WHERE job_id=$1 AND generation=$2 AND state='ACCEPTED' ORDER BY created_at DESC LIMIT 1",
        [job.id, job.generation],
      )
    ).rows[0];
    const status =
      job.state === 'SUCCEEDED' && stage
        ? stage.manifest.status
        : job.state === 'CANCELLED'
          ? 'CANCELLED'
          : job.state === 'UNSUPPORTED'
            ? 'UNSUPPORTED'
            : 'FAILED';
    await tx.client.query(
      'UPDATE dms.processing_run SET state=$2,accepted_stage_id=$3,completed_at=clock_timestamp() WHERE id=$1',
      [run.id, status, stage?.id ?? null],
    );
    if (!['SUCCEEDED', 'PARTIAL'].includes(status)) continue;
    const eligible = (
      await tx.client.query(
        `SELECT r.id FROM dms.processing_run r JOIN dms.document d ON d.id=r.document_id JOIN dms.document_version v ON v.id=r.version_id JOIN dms.security_candidate c ON c.upload_id=r.upload_id JOIN dms.application_registration a ON a.id=r.application_id WHERE r.id=$1 AND d.lifecycle='ACTIVE' AND d.lifecycle_generation=r.lifecycle_generation AND v.availability='AVAILABLE' AND v.lifecycle_generation=d.lifecycle_generation AND a.status='active' AND c.state='PASSED' AND c.sha256=r.source_sha256 AND NOT EXISTS(SELECT 1 FROM dms.processing_run newer WHERE newer.version_id=r.version_id AND newer.number>r.number)`,
        [run.id],
      )
    ).rows[0];
    if (!eligible) continue;
    await tx.client.query(
      'UPDATE dms.processing_run SET active=false WHERE version_id=$1 AND active',
      [run.version_id],
    );
    await tx.client.query('UPDATE dms.processing_run SET active=true WHERE id=$1', [run.id]);
    await appendDocumentAudit(tx, {
      documentId: run.document_id,
      applicationId: run.application_id,
      action: 'processing.promoted',
    });
  }
}
