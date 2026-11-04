import type { PoolClient } from 'pg';
export async function peopleSchemaSafe(db: PoolClient) {
  const table = (
    await db.query<{
      safe: boolean;
    }>(`SELECT c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='thaarei_turnstile_migrator'
    AND has_table_privilege('thaarei_turnstile_runtime',c.oid,'SELECT')
    AND has_table_privilege('thaarei_turnstile_runtime',c.oid,'INSERT')
    AND has_table_privilege('thaarei_turnstile_runtime',c.oid,'UPDATE')
    AND has_table_privilege('thaarei_turnstile_runtime',c.oid,'DELETE')
    AND NOT has_table_privilege('thaarei_turnstile_runtime',c.oid,'TRUNCATE,REFERENCES,TRIGGER') AS safe FROM pg_class c WHERE c.oid=to_regclass('turnstile.member_display')`)
  ).rows[0];
  const functions = (
    await db.query<{
      safe: boolean;
    }>(`SELECT count(*)=3 AND bool_and(pg_get_userbyid(p.proowner)='thaarei_turnstile_migrator'
    AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[]
    AND has_function_privilege('thaarei_turnstile_runtime',p.oid,'EXECUTE')
    AND (p.proname<>'apply_people_command' OR p.prosecdef)
    AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) AS safe
    FROM pg_proc p WHERE p.oid=ANY(ARRAY[to_regprocedure('turnstile.people_covers(uuid,text,text[],jsonb)'),to_regprocedure('turnstile.people_admin(uuid,text)'),to_regprocedure('turnstile.apply_people_command(uuid,text,uuid,text,jsonb,uuid,text,uuid,text,text)')])`)
  ).rows[0];
  return table?.safe === true && functions?.safe === true;
}
