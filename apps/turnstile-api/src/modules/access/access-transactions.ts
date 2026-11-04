import { createHash, randomUUID } from 'node:crypto';
import { configurationNameKey, SYSTEM_ROLE_TEMPLATES } from '@thaarei/turnstile-contracts';
import type { PoolClient } from 'pg';
import { lockConfiguration } from '../../infrastructure/database/configuration-lock.js';
import { accessCounts } from './access-evaluator.js';

export class AccessInvariantError extends Error {
  constructor(
    readonly code:
      | 'ACCESS_CONFLICT'
      | 'LAST_ADMINISTRATOR_REQUIRED'
      | 'LAST_CONFIGURATION_MANAGER_REQUIRED'
      | 'ACCESS_IMPORT_REQUIRED'
      | 'ACCESS_REVISION_EXHAUSTED',
  ) {
    super(code);
  }
}

// The caller first locks the fixed installation. Configuration precedes access,
// including operations which do not currently need the organization tree.
export async function lockAccess(client: PoolClient, tenantId: string, expectedRevision?: number) {
  if (!(await lockConfiguration(client, tenantId)))
    throw new Error('Setup initialization required');
  const context = (
    await client.query<{ revision: number }>(
      'SELECT revision FROM turnstile.access_context WHERE tenant_id = $1 FOR UPDATE',
      [tenantId],
    )
  ).rows[0];
  if (!context) throw new AccessInvariantError('ACCESS_IMPORT_REQUIRED');
  if (expectedRevision !== undefined && expectedRevision !== context.revision)
    throw new AccessInvariantError('ACCESS_CONFLICT');
  return context;
}

export async function enforceProtectedCounts(
  client: PoolClient,
  tenantId: string,
  before: Awaited<ReturnType<typeof accessCounts>>,
) {
  const after = await accessCounts(client, tenantId);
  if (before.administrators > 0 && after.administrators === 0)
    throw new AccessInvariantError('LAST_ADMINISTRATOR_REQUIRED');
  if (before.managers > 0 && after.managers === 0)
    throw new AccessInvariantError('LAST_CONFIGURATION_MANAGER_REQUIRED');
}

export async function recordAccessChange(
  client: PoolClient,
  tenantId: string,
  revision: number,
  event: {
    operatorId: string;
    requestId: string;
    action: string;
    subjectId?: string;
    userId?: string;
    additionalSubject?: { id: string; userId: string };
  },
) {
  if (revision >= 2147483647) throw new AccessInvariantError('ACCESS_REVISION_EXHAUSTED');
  const result = await client.query(
    'UPDATE turnstile.access_context SET revision = revision + 1 WHERE tenant_id = $1 AND revision = $2',
    [tenantId, revision],
  );
  if (result.rowCount !== 1) throw new AccessInvariantError('ACCESS_CONFLICT');
  await client.query(
    `INSERT INTO turnstile.access_audit
    (tenant_id,id,actor_kind,actor_id,request_id,action,subject_id,subject_user_id,revision_before,revision_after)
    VALUES ($1,$2,'operator',$3,$4,$5,$6,$7,$8,$8 + 1)`,
    [
      tenantId,
      randomUUID(),
      event.operatorId,
      event.requestId,
      event.action,
      event.subjectId ?? null,
      event.userId ?? null,
      revision,
    ],
  );
  if (event.additionalSubject)
    await client.query(
      `INSERT INTO turnstile.access_audit
    (tenant_id,id,actor_kind,actor_id,request_id,action,subject_id,subject_user_id,revision_before,revision_after)
    VALUES ($1,$2,'operator',$3,$4,$5,$6,$7,$8,$8 + 1)`,
      [
        tenantId,
        randomUUID(),
        event.operatorId,
        event.requestId,
        event.action,
        event.additionalSubject.id,
        event.additionalSubject.userId,
        revision,
      ],
    );
}

export function commandDigest(value: unknown) {
  // Inputs are strict objects with canonical property order before this boundary.
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

// Check receipts before versions. Replay callers read current state, never a saved
// result which could restore permissions removed after the original command.
export async function replayCommand(
  client: PoolClient,
  tenantId: string,
  command: { operatorId: string; key: string; operation: string; digest: string },
) {
  const legacy = await client.query(
    `SELECT 1 FROM turnstile.configuration_create_receipt WHERE tenant_id=$1 AND actor_id=$2 AND key=$3 AND expires_at>statement_timestamp()`,
    [tenantId, command.operatorId, command.key],
  );
  if (legacy.rowCount) throw new AccessInvariantError('ACCESS_CONFLICT');
  const row = (
    await client.query<{ operation: string; digest: string }>(
      `SELECT operation,digest
    FROM turnstile.access_command_receipt WHERE tenant_id = $1 AND actor_id = $2 AND key = $3
    AND expires_at > statement_timestamp() FOR UPDATE`,
      [tenantId, command.operatorId, command.key],
    )
  ).rows[0];
  if (!row) return false;
  if (row.operation !== command.operation || row.digest !== command.digest)
    throw new AccessInvariantError('ACCESS_CONFLICT');
  return true;
}

export async function saveCommand(
  client: PoolClient,
  tenantId: string,
  command: { operatorId: string; key: string; operation: string; digest: string },
  subjectId?: string,
) {
  await client.query(
    `DELETE FROM turnstile.access_command_receipt WHERE tenant_id = $1 AND actor_id = $2
    AND key = $3 AND expires_at <= statement_timestamp()`,
    [tenantId, command.operatorId, command.key],
  );
  await client.query(
    `INSERT INTO turnstile.access_command_receipt (tenant_id,actor_id,key,operation,digest,subject_id)
    VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      tenantId,
      command.operatorId,
      command.key,
      command.operation,
      command.digest,
      subjectId ?? null,
    ],
  );
}

export async function importLegacyAccess(client: PoolClient, tenantId: string, operatorId: string) {
  if (!(await lockConfiguration(client, tenantId)))
    throw new Error('Setup initialization required');
  if (
    (
      await client.query('SELECT 1 FROM turnstile.access_context WHERE tenant_id = $1 FOR UPDATE', [
        tenantId,
      ])
    ).rowCount
  )
    return false;
  await client.query(
    'INSERT INTO turnstile.access_context (tenant_id,initialized_by) VALUES ($1,$2)',
    [tenantId, operatorId],
  );
  for (const template of SYSTEM_ROLE_TEMPLATES) {
    const id = randomUUID();
    await client.query(
      'INSERT INTO turnstile.access_role (tenant_id,id,system_key,name,name_key) VALUES ($1,$2,$3,$4,$5)',
      [tenantId, id, template.systemKey, template.name, configurationNameKey(template.name)],
    );
    await client.query(
      `INSERT INTO turnstile.access_role_permission (tenant_id,role_id,permission)
      SELECT $1,$2,unnest($3::text[])`,
      [tenantId, id, template.permissions],
    );
  }
  await client.query(
    `INSERT INTO turnstile.access_member (tenant_id,id,user_id,status)
    SELECT tenant_id,gen_random_uuid(),user_id,CASE WHEN enabled THEN 'active' ELSE 'suspended' END
      FROM turnstile.user_access WHERE tenant_id = $1`,
    [tenantId],
  );
  await client.query(
    `INSERT INTO turnstile.access_legacy_source (tenant_id,member_id,id,permissions)
    SELECT a.tenant_id,m.id,gen_random_uuid(),ARRAY(SELECT DISTINCT p FROM unnest(a.permissions) p ORDER BY p)
      FROM turnstile.user_access a JOIN turnstile.access_member m ON m.tenant_id = a.tenant_id AND m.user_id = a.user_id
      WHERE a.tenant_id = $1`,
    [tenantId],
  );
  await recordAccessChange(client, tenantId, 0, {
    operatorId,
    requestId: randomUUID(),
    action: 'legacy_imported',
  });
  return true;
}

// This payload REPLACES only the legacy source. It never removes roles, resurrects
// a retired source, or treats enabled as source-local.
export async function replaceLegacyAccess(
  client: PoolClient,
  tenantId: string,
  value: { userId: string; enabled: boolean; permissions: readonly string[]; operatorId: string },
) {
  const context = await lockAccess(client, tenantId);
  const before = await accessCounts(client, tenantId);
  let member = (
    await client.query<{ id: string; status: string }>(
      'SELECT id,status FROM turnstile.access_member WHERE tenant_id = $1 AND user_id = $2 FOR UPDATE',
      [tenantId, value.userId],
    )
  ).rows[0];
  const previous = member
    ? (
        await client.query<{ permissions: string[]; retired: boolean }>(
          'SELECT permissions,retired FROM turnstile.access_legacy_source WHERE tenant_id = $1 AND member_id = $2 FOR UPDATE',
          [tenantId, member.id],
        )
      ).rows[0]
    : undefined;
  const status = value.enabled ? 'active' : 'suspended';
  const changed =
    !member ||
    !previous ||
    member.status !== status ||
    previous.permissions.length !== value.permissions.length ||
    value.permissions.some((p) => !previous.permissions.includes(p));
  if (changed) {
    if (!member) {
      member = { id: randomUUID(), status };
      await client.query(
        'INSERT INTO turnstile.access_member (tenant_id,id,user_id,status) VALUES ($1,$2,$3,$4)',
        [tenantId, member.id, value.userId, status],
      );
    } else
      await client.query(
        'UPDATE turnstile.access_member SET status = $3,version = version + 1 WHERE tenant_id = $1 AND id = $2',
        [tenantId, member.id, status],
      );
    await client.query(
      `INSERT INTO turnstile.access_legacy_source (tenant_id,member_id,id,permissions) VALUES ($1,$2,$3,$4)
      ON CONFLICT (tenant_id,member_id) DO UPDATE SET permissions = EXCLUDED.permissions,version = access_legacy_source.version + 1`,
      [tenantId, member.id, randomUUID(), value.permissions],
    );
    await enforceProtectedCounts(client, tenantId, before);
    await recordAccessChange(client, tenantId, context.revision, {
      operatorId: value.operatorId,
      requestId: randomUUID(),
      action: 'legacy_replaced',
      subjectId: member.id,
      userId: value.userId,
    });
  }
  return { changed, revision: context.revision + Number(changed) };
}
