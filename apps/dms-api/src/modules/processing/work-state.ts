import { randomUUID } from 'node:crypto';
import { WORK_TASK_ROLE, type WorkTask } from '@thaarei/dms-contracts/private';
import type { PoolClient } from 'pg';
import type { CoordinatorContext, DmsTransaction } from '../access/resource-policy.js';
import { appendDocumentAudit } from '../audit/document-audit.js';
import { WorkError } from './work-configuration.js';
export type CoordinatorTx = DmsTransaction<CoordinatorContext>;
export type JobRow = {
  id: string;
  tenant_id: string;
  application_id: string;
  upload_id: string;
  task: WorkTask;
  processing_run_id: string | null;
  state: string;
  generation: number;
  lifecycle_generation: number;
  executions: number;
  recoveries: number;
  current_attempt_id: string | null;
  deadline: Date | null;
  next_eligible_at: Date | null;
  recover_at: Date | null;
  created_at: Date;
};
export async function wall(client: PoolClient) {
  return (await client.query<{ wall: Date }>('SELECT clock_timestamp() AS wall')).rows[0]
    ?.wall as Date;
}
export const later = (time: Date, seconds: number) => new Date(time.getTime() + seconds * 1000);
// An explicit reprocess has its own admitted work window. It must not mutate
// lifecycle reassessment state, which also fences contributor upload authority.
export const WORK_SOURCE_EXPIRY = `greatest(coalesce(a.reassessment_until,a.expires_at),(SELECT max(pr.expires_at) FROM dms.processing_run pr WHERE pr.tenant_id=a.tenant_id AND pr.application_id=a.application_id AND pr.upload_id=a.id AND pr.lifecycle_generation=a.lifecycle_generation AND pr.key_hash IS NOT NULL))`;
export async function lockWorkSource(tx: CoordinatorTx, uploadId: string) {
  const source = (
    await tx.client.query(
      `SELECT a.*,s.batch_id,s.upload_state,d.lifecycle,d.lifecycle_generation AS document_generation,r.status AS application_status FROM dms.upload_admission a JOIN dms.upload_session s ON s.id=a.id JOIN dms.document d ON d.id=a.document_id JOIN dms.application_registration r ON r.id=a.application_id WHERE a.id=$1`,
      [uploadId],
    )
  ).rows[0];
  if (!source) throw new WorkError('WORK_STALE');
  await tx.client.query('SELECT id FROM dms.application_registration WHERE id=$1 FOR SHARE', [
    source.application_id,
  ]);
  if (source.batch_id)
    await tx.client.query('SELECT id FROM dms.upload_batch WHERE id=$1 FOR UPDATE', [
      source.batch_id,
    ]);
  const current = (
    await tx.client.query(
      `SELECT s.*,r.status AS application_status,d.lifecycle,a.document_id,a.version_id,a.application_id,${WORK_SOURCE_EXPIRY} AS expires_at,a.lifecycle_generation,d.lifecycle_generation AS document_generation,a.state AS admission_state,a.work_released,a.storage_mode FROM dms.upload_session s JOIN dms.upload_admission a ON a.id=s.id JOIN dms.application_registration r ON r.id=a.application_id JOIN dms.document d ON d.id=a.document_id WHERE s.id=$1 FOR UPDATE OF s`,
      [uploadId],
    )
  ).rows[0];
  // Match public issuance's session -> admission order, then read accounting after
  // acquiring its fence so release/settlement cannot race eligibility acceptance.
  const accounting = (
    await tx.client.query(
      `SELECT a.state AS admission_state,a.work_released,${WORK_SOURCE_EXPIRY} AS expires_at FROM dms.upload_admission a WHERE a.id=$1 FOR SHARE OF a`,
      [uploadId],
    )
  ).rows[0];
  if (!current || !accounting) throw new WorkError('WORK_STALE');
  return { ...current, ...accounting };
}
export function sourceActive(
  source: Record<string, unknown>,
  now: Date,
  task: WorkTask = 'document.scan',
) {
  return (
    source.application_status === 'active' &&
    source.lifecycle_generation === source.document_generation &&
    ['RESERVED', 'SETTLED'].includes(String(source.admission_state)) &&
    source.work_released === false &&
    source.lifecycle === 'ACTIVE' &&
    (task === 'document.scan'
      ? ['INITIATED', 'OBJECT_VERIFIED']
      : ['OBJECT_VERIFIED', 'COMPLETED']
    ).includes(String(source.upload_state)) &&
    (source.expires_at as Date) > now
  );
}
export async function jobAudit(
  tx: CoordinatorTx,
  job: Pick<JobRow, 'application_id' | 'upload_id'>,
  action: 'work.queued' | 'work.completed' | 'work.recovered' | 'work.cancelled',
) {
  const row = (
    await tx.client.query('SELECT document_id FROM dms.upload_admission WHERE id=$1', [
      job.upload_id,
    ])
  ).rows[0];
  if (!row) throw new WorkError('WORK_STALE');
  await appendDocumentAudit(tx, {
    documentId: row.document_id,
    applicationId: job.application_id,
    action,
  });
}
export async function createDispatch(
  tx: CoordinatorTx,
  job: Pick<JobRow, 'id' | 'generation' | 'task'>,
) {
  if (!WORK_TASK_ROLE[job.task]) throw new WorkError('WORK_INVALID', 400);
  const id = randomUUID();
  await tx.client.query(
    'INSERT INTO dms.work_dispatch (id,tenant_id,job_id,generation,task) VALUES ($1,$2,$3,$4,$5)',
    [id, tx.context.tenantId, job.id, job.generation, job.task],
  );
  return id;
}
// Owning implemented features call this kernel; there is no HTTP enqueue/handler-selection API.
// I07 does not automatically dispatch unavailable scanner/parser implementations.
export async function enqueueWork(
  tx: CoordinatorTx,
  uploadId: string,
  task: WorkTask,
  processingRunId: string | null = null,
) {
  const source = await lockWorkSource(tx, uploadId),
    now = await wall(tx.client);
  if (!sourceActive(source, now, task)) throw new WorkError('WORK_STALE');
  const old = (
    await tx.client.query<JobRow>(
      'SELECT * FROM dms.work_job WHERE upload_id=$1 AND task=$2 AND processing_run_id IS NOT DISTINCT FROM $3::uuid FOR UPDATE',
      [uploadId, task, processingRunId],
    )
  ).rows[0];
  if (old) {
    if (task !== 'document.scan' && old.lifecycle_generation !== source.document_generation) {
      const updated = (
        await tx.client.query<JobRow>(
          "UPDATE dms.work_job SET state='QUEUED',lifecycle_generation=$2,generation=generation+1,executions=0,recoveries=0,current_attempt_id=NULL,budget_started_at=NULL,deadline=NULL,next_eligible_at=NULL,recover_at=NULL,result_code=NULL,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",
          [old.id, source.document_generation],
        )
      ).rows[0];
      if (!updated) throw new WorkError('WORK_UNAVAILABLE', 503);
      await createDispatch(tx, updated);
      await jobAudit(tx, updated, 'work.queued');
      return updated;
    }
    return old;
  }
  const job = (
    await tx.client.query<JobRow>(
      'INSERT INTO dms.work_job (id,tenant_id,application_id,upload_id,task,lifecycle_generation,processing_run_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [
        randomUUID(),
        tx.context.tenantId,
        source.application_id,
        uploadId,
        task,
        source.document_generation,
        processingRunId,
      ],
    )
  ).rows[0];
  if (!job) throw new WorkError('WORK_UNAVAILABLE', 503);
  await createDispatch(tx, job);
  await jobAudit(tx, job, 'work.queued');
  return job;
}
