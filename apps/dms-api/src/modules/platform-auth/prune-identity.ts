import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createPool, withTenant } from '../../infrastructure/database/postgres.js';

/** Private bounded maintenance; never exposed through HTTP or authority runtime privileges. */
export async function pruneIdentity(environment = process.env) {
  const tenantId = z.uuid().parse(environment.INSTALLATION_TENANT_ID);
  const connection = environment.AUTH_MIGRATION_DATABASE_URL;
  if (
    !connection ||
    !URL.canParse(connection) ||
    new URL(connection).username !== 'thaarei_auth_migrator'
  )
    throw new Error('Dedicated authority migration role required');
  const pool = createPool(connection, 1);
  try {
    const role = await pool.query<{ safe: boolean }>(
      `SELECT current_user='thaarei_auth_migrator' AND session_user=current_user AND NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole) AS safe FROM pg_roles WHERE rolname=current_user`,
    );
    if (!role.rows[0]?.safe) throw new Error('Unsafe maintenance role');
    return await withTenant(pool, tenantId, async (db) => {
      // Same ordering as feature operations: live client, installation, owning feature rows.
      await db.query(
        'SELECT client_id FROM auth.oauth_client WHERE client_id IN (SELECT DISTINCT client_id FROM auth.identity_preparation WHERE tenant_id=$1) ORDER BY client_id FOR UPDATE',
        [tenantId],
      );
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `identity:${tenantId}`,
      ]);
      const counts: Record<string, number> = {};
      for (const [table, condition] of [
        ['identity_setup', 'expires_at<=now()'],
        ['identity_preparation', 'retained_until<=now()'],
        [
          'identity_epoch',
          'expires_at<=now() AND NOT EXISTS (SELECT 1 FROM auth.identity_preparation p WHERE p.tenant_id=t.tenant_id AND p.application_id=t.application_id AND p.client_id=t.client_id AND p.invitation_id=t.invitation_id)',
        ],
        ['identity_limit', '"window"<now()-interval \'2 hours\''],
        ['identity_audit', "created_at<now()-interval '90 days'"],
      ] as const) {
        const result = await db.query(
          `DELETE FROM auth.${table} WHERE ctid IN (SELECT t.ctid FROM auth.${table} t WHERE tenant_id=$1 AND ${condition} LIMIT 1000)`,
          [tenantId],
        );
        counts[table] = result.rowCount ?? 0;
      }
      return counts;
    });
  } finally {
    await pool.end();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await pruneIdentity()));
  } catch {
    console.error('Authority identity maintenance failed');
    process.exitCode = 1;
  }
}
