import type { PoolClient } from 'pg';
export const INVITATION_TABLES = [
  'invitation',
  'invitation_generation',
  'invitation_reference',
  'invitation_delivery',
  'invitation_operation',
  'invitation_rate',
  'invitation_audit',
  'invitation_acceptance',
] as const;
export async function invitationSchemaSafe(db: PoolClient) {
  const row = (
    await db.query<{ safe: boolean }>(
      `SELECT count(*)=8 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='thaarei_turnstile_migrator' AND (has_table_privilege('thaarei_turnstile_runtime',c.oid,'INSERT')=(c.relname<>'invitation_acceptance')) AND NOT has_table_privilege('thaarei_turnstile_runtime',c.oid,'TRUNCATE') AND (has_table_privilege('thaarei_turnstile_runtime',c.oid,'DELETE')=(c.relname IN ('invitation_reference','invitation_rate'))) AND CASE WHEN c.relname='invitation_audit' THEN NOT has_table_privilege('thaarei_turnstile_runtime',c.oid,'SELECT') AND NOT has_table_privilege('thaarei_turnstile_runtime',c.oid,'UPDATE') WHEN c.relname IN ('invitation_generation','invitation_acceptance') THEN has_table_privilege('thaarei_turnstile_runtime',c.oid,'SELECT') AND NOT has_table_privilege('thaarei_turnstile_runtime',c.oid,'UPDATE') ELSE has_table_privilege('thaarei_turnstile_runtime',c.oid,'SELECT') AND has_table_privilege('thaarei_turnstile_runtime',c.oid,'UPDATE') END) AS safe FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='turnstile' AND c.relname=ANY($1)`,
      [INVITATION_TABLES],
    )
  ).rows[0];
  if (!row?.safe) return false;
  const functions = (
    await db.query<{ safe: boolean }>(
      `SELECT count(*)=6 AND bool_and(pg_get_userbyid(p.proowner)='thaarei_turnstile_migrator' AND (p.proname<>'accept_invitation' OR p.prosecdef) AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[] AND has_function_privilege('thaarei_turnstile_runtime',p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) AS safe FROM pg_proc p WHERE p.oid=ANY(ARRAY[to_regprocedure('turnstile.reserve_invitation_command(uuid,text,uuid,text,text,uuid)'),to_regprocedure('turnstile.commit_invitation_command(uuid,text,uuid,uuid,integer)'),to_regprocedure('turnstile.invitation_approval_valid(uuid,uuid)'),to_regprocedure('turnstile.invalidate_invitations(uuid,uuid[])'),to_regprocedure('turnstile.maintain_invitations(uuid,text)'),to_regprocedure('turnstile.accept_invitation(uuid,uuid,integer,integer,text,text,text,text,text,uuid)')])`,
    )
  ).rows[0];
  const triggers = (
    await db.query<{ safe: boolean }>(
      `SELECT count(*)=6 AND bool_and(tgdeferrable AND tginitdeferred AND tgenabled='O' AND tgfoid=to_regprocedure('turnstile.fence_invitation_approvals()')) AS safe FROM pg_trigger WHERE tgname='invitation_fence' AND tgrelid=ANY($1::regclass[])`,
      [
        [
          'turnstile.access_member',
          'turnstile.access_legacy_source',
          'turnstile.access_assignment',
          'turnstile.access_scope_anchor',
          'turnstile.access_role_permission',
          'turnstile.access_role',
        ],
      ],
    )
  ).rows[0];
  return functions?.safe === true && triggers?.safe === true;
}
