import { operationsSnapshotSchema } from '@thaarei/dms-contracts/private';
import type { DmsTransaction, OperatorContext } from '../access/resource-policy.js';
import { insertSecurityEvent } from '../audit/security-event.js';
import { requestProcessing } from './results.service.js';
import { WorkError } from './work-configuration.js';
export async function operationsSnapshot(tx: DmsTransaction) {
  return operationsSnapshotSchema.parse(
    (await tx.client.query('SELECT dms.operations_snapshot() AS snapshot')).rows[0].snapshot,
  );
}
export async function observeService(
  tx: DmsTransaction,
  component: string,
  state: string,
  identityId: string | null = null,
  evidenceAt: string | null = null,
) {
  await tx.client.query(
    `INSERT INTO dms.service_observation(tenant_id,component,state,identity_id,evidence_at,failures) VALUES($1,$2,$3,$4,$5,CASE WHEN $3='degraded' THEN 1 ELSE 0 END) ON CONFLICT(tenant_id,component) DO UPDATE SET observed_at=clock_timestamp(),state=EXCLUDED.state,identity_id=EXCLUDED.identity_id,evidence_at=EXCLUDED.evidence_at,failures=CASE WHEN EXCLUDED.state='degraded' THEN least(2147483646,dms.service_observation.failures)+1 ELSE 0 END`,
    [tx.context.tenantId, component, state, identityId, evidenceAt],
  );
}
export async function operatorOperations(
  tx: DmsTransaction<OperatorContext>,
  operation: {
    action: string;
    completedAt?: string;
    manifestSha256?: string;
    jobId?: string;
    idempotencyKey?: string;
  },
) {
  if (operation.action === 'work-redrive') {
    const row = (
      await tx.client.query(
        `SELECT j.state,j.task,a.document_id,a.version_id,r.profile FROM dms.work_job j JOIN dms.upload_admission a ON a.id=j.upload_id JOIN dms.processing_run r ON r.id=j.processing_run_id WHERE j.id=$1`,
        [operation.jobId],
      )
    ).rows[0];
    if (!row || !['FAILED', 'UNSUPPORTED'].includes(row.state) || row.task === 'document.scan')
      throw new WorkError('WORK_CONFLICT');
    const { replay: _replay, ...result } = await requestProcessing(
      tx,
      row.document_id,
      row.version_id,
      { profile: row.profile },
      operation.idempotencyKey as string,
    );
    return result;
  }
  if (operation.action === 'operations-backup-report')
    await tx.client.query('SELECT dms.report_backup($1,$2)', [
      operation.completedAt,
      operation.manifestSha256,
    ]);
  const result =
    operation.action === 'operations-prune'
      ? (await tx.client.query('SELECT dms.prune_work_history() AS result')).rows[0].result
      : await operationsSnapshot(tx);
  await insertSecurityEvent(tx.client, tx.context.tenantId, {
    action: `operator.${operation.action.replaceAll('-', '.')}`,
    actorKind: 'operator',
    actorId: tx.context.subjectId,
    subjectId: tx.context.tenantId,
    outcome: 'success',
  });
  return result;
}
