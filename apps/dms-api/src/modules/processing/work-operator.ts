import { randomUUID } from 'node:crypto';
import { WORK_ROLE_SCOPE, type WorkRole, workSchemas } from '@thaarei/dms-contracts/private';
import type { Pool } from 'pg';
import type { DmsTransaction, OperatorContext } from '../access/resource-policy.js';
import { insertSecurityEvent } from '../audit/security-event.js';
import { clientApproval } from '../platform-auth/oauth-policy.js';
export async function operatorWork(
  tx: DmsTransaction<OperatorContext>,
  authPool: Pool,
  issuer: string,
  operation:
    | { action: 'work-authorize'; clientId: string; role: WorkRole }
    | { action: 'work-disable'; clientId: string },
) {
  await tx.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `work-identity:${tx.context.tenantId}:${operation.clientId}`,
  ]);
  if (operation.action === 'work-authorize') {
    const row = (
      await authPool.query(
        'SELECT metadata,disabled,reference_id,scopes,client_credentials_scopes,grant_types,token_endpoint_auth_method FROM auth.oauth_client WHERE client_id=$1',
        [operation.clientId],
      )
    ).rows[0];
    const metadata = typeof row?.metadata === 'string' ? JSON.parse(row.metadata) : row?.metadata;
    const approval = clientApproval.parse(metadata?.thaarei),
      scope = WORK_ROLE_SCOPE[operation.role];
    if (
      !row ||
      row.disabled ||
      row.reference_id !== tx.context.tenantId ||
      approval.tenantId !== tx.context.tenantId ||
      approval.kind !== `work_${operation.role}` ||
      approval.resource !== `${issuer}/services/work` ||
      row.scopes?.length !== 1 ||
      row.scopes[0] !== scope ||
      row.client_credentials_scopes?.length !== 1 ||
      row.client_credentials_scopes[0] !== scope ||
      row.grant_types?.length !== 1 ||
      row.grant_types[0] !== 'client_credentials' ||
      row.token_endpoint_auth_method !== 'client_secret_basic'
    )
      throw new Error('Approved private work identity required');
    const changed = await tx.client.query(
      'INSERT INTO dms.work_identity (id,tenant_id,issuer,client_id,role,enabled) VALUES ($1,$2,$3,$4,$5,true) ON CONFLICT (tenant_id,issuer,client_id) DO UPDATE SET enabled=true WHERE work_identity.role=EXCLUDED.role RETURNING role,enabled',
      [randomUUID(), tx.context.tenantId, issuer, operation.clientId, operation.role],
    );
    if (!changed.rowCount) throw new Error('Work identity purpose cannot be changed');
  } else
    await tx.client.query(
      'UPDATE dms.work_identity SET enabled=false WHERE issuer=$1 AND client_id=$2',
      [issuer, operation.clientId],
    );
  await insertSecurityEvent(tx.client, tx.context.tenantId, {
    action: `operator.${operation.action === 'work-authorize' ? 'work.authorize' : 'work.disable'}`,
    actorKind: 'operator',
    actorId: tx.context.subjectId,
    subjectId: operation.clientId,
    outcome: 'success',
  });
  const row = (
    await tx.client.query(
      'SELECT role,enabled FROM dms.work_identity WHERE issuer=$1 AND client_id=$2',
      [issuer, operation.clientId],
    )
  ).rows[0];
  return { clientId: operation.clientId, role: row?.role ?? null, enabled: row?.enabled ?? false };
}

export async function inspectWork(tx: DmsTransaction<OperatorContext>, jobId: string) {
  const row = (await tx.client.query('SELECT * FROM dms.work_job WHERE id=$1', [jobId])).rows[0];
  if (!row) throw new Error('Work unavailable');
  const iso = (value: Date | null) => (value ? value.toISOString() : null);
  const job = workSchemas.Job.parse({
    version: 1,
    id: row.id,
    uploadId: row.upload_id,
    applicationId: row.application_id,
    task: row.task,
    state: row.state,
    generation: row.generation,
    executions: row.executions,
    recoveries: row.recoveries,
    createdAt: iso(row.created_at),
    budgetStartedAt: iso(row.budget_started_at),
    deadline: iso(row.deadline),
    nextEligibleAt: iso(row.next_eligible_at),
    recoverAt: iso(row.recover_at),
    resultCode: row.result_code,
  });
  const dispatches = (
    await tx.client.query(
      'SELECT id,generation,state,published_at,failures,last_error FROM dms.work_dispatch WHERE job_id=$1 ORDER BY generation LIMIT 4',
      [jobId],
    )
  ).rows;
  const attempts = (
    await tx.client.query(
      'SELECT id,dispatch_id,generation,execution,client_id,state,lease_expires_at,deadline,result_code FROM dms.work_attempt WHERE job_id=$1 ORDER BY execution LIMIT 3',
      [jobId],
    )
  ).rows;
  await insertSecurityEvent(tx.client, tx.context.tenantId, {
    action: 'operator.work.inspect',
    actorKind: 'operator',
    actorId: tx.context.subjectId,
    subjectId: jobId,
    outcome: 'success',
  });
  return { job, dispatches, attempts };
}
