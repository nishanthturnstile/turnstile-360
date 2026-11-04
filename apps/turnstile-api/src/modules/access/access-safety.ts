import type { PoolClient } from 'pg';
import { releaseStateReady } from './release-state.js';

export const ACCESS_TABLES = [
  'access_context',
  'access_member',
  'access_legacy_source',
  'access_role',
  'access_role_permission',
  'access_assignment',
  'access_scope_anchor',
  'access_command_receipt',
  'access_impact_receipt',
  'access_audit',
] as const;

export async function accessSchemaSafe(client: PoolClient) {
  const row = (
    await client.query<{ safe: boolean }>(
      `SELECT count(*) = $2 AND bool_and(
    c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner) = 'thaarei_turnstile_migrator'
    AND NOT has_any_column_privilege('thaarei_turnstile_runtime',c.oid,'UPDATE')
    AND NOT has_table_privilege('thaarei_turnstile_runtime',c.oid,'DELETE')
    AND NOT has_table_privilege('thaarei_turnstile_runtime',c.oid,'TRUNCATE')
    AND NOT has_table_privilege('thaarei_turnstile_runtime',c.oid,'TRIGGER')
    AND CASE WHEN c.relname = 'access_audit'
      THEN has_table_privilege('thaarei_turnstile_runtime',c.oid,'INSERT') AND NOT has_any_column_privilege('thaarei_turnstile_runtime',c.oid,'SELECT')
      ELSE has_table_privilege('thaarei_turnstile_runtime',c.oid,'SELECT') AND NOT has_any_column_privilege('thaarei_turnstile_runtime',c.oid,'INSERT') END
  ) AS safe FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'turnstile' AND c.relname = ANY($1::text[])`,
      [ACCESS_TABLES, ACCESS_TABLES.length],
    )
  ).rows[0];
  return row?.safe === true;
}

export async function canonicalAccessReady(
  client: PoolClient,
  tenantId: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (!(await releaseStateReady(client, tenantId, environment))) return false;
  const lock = (
    await client.query<{ safe: boolean }>(`SELECT count(*)=4 AND bool_and(p.prosecdef
    AND pg_get_userbyid(p.proowner) = 'thaarei_turnstile_migrator'
    AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[]
    AND p.prorettype = required.return_type::regtype
    AND has_function_privilege('thaarei_turnstile_runtime',p.oid,'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS safe
    FROM (VALUES ('turnstile.lock_access_context(uuid)','void'),
      ('turnstile.save_structure_command(uuid,text,uuid,text,text,uuid,integer,integer,uuid)','void'),
      ('turnstile.save_structure_impact(uuid,text,uuid,text,text,text,integer,integer)','timestamp with time zone'),
      ('turnstile.commit_structure_access(uuid,text,uuid,uuid,integer)','integer')) required(signature,return_type)
      JOIN pg_proc p ON p.oid=to_regprocedure(required.signature)`)
  ).rows[0];
  return lock?.safe === true;
}
