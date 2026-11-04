import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

export const ACCESS_RELEASE_VERSION = 1;

export function invitationRecoveryEpoch(environment: NodeJS.ProcessEnv = process.env) {
  const value = environment.TURNSTILE_INVITATION_RECOVERY_EPOCH;
  if (!value || !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value)) return undefined;
  return createHash('sha256').update(value).digest('hex');
}

export async function releaseStateReady(
  db: PoolClient,
  tenant: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const row = (
    await db.query<{
      recovery_epoch: string | null;
      safe: boolean;
    }>(
      `SELECT recovery_epoch, model_version=1 AND release_version=$2
      AND NOT has_any_column_privilege('thaarei_turnstile_runtime','turnstile.user_access','SELECT')
      AND EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
        WHERE t.tgrelid='turnstile.user_access'::regclass AND t.tgname='access_inventory_guard'
        AND t.tgenabled='O' AND t.tgfoid=to_regprocedure('turnstile.guard_access_inventory()')
        AND pg_get_userbyid(p.proowner)='thaarei_turnstile_migrator')
      AND (NOT public_writes_enabled OR (release_id IS NOT NULL AND recovery_epoch IS NOT NULL AND released_at IS NOT NULL AND released_by IS NOT NULL)) AS safe
      FROM turnstile.access_context WHERE tenant_id=$1`,
      [tenant, ACCESS_RELEASE_VERSION],
    )
  ).rows[0];
  return (
    row?.safe === true &&
    (row.recovery_epoch === null || row.recovery_epoch === invitationRecoveryEpoch(environment))
  );
}

// Called under the existing installation/configuration/access transaction locks.
export async function featureWritesOpen(db: PoolClient, tenant: string) {
  const row = (
    await db.query<{ open: boolean }>(
      `SELECT public_writes_enabled AND release_version=$2 AND recovery_epoch=$3 AS open
      FROM turnstile.access_context WHERE tenant_id=$1`,
      [tenant, ACCESS_RELEASE_VERSION, invitationRecoveryEpoch() ?? null],
    )
  ).rows[0];
  return row?.open === true;
}
