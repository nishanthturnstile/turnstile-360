import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

export const roleConnections = ['auth', 'dms', 'turnstile'].flatMap((boundary) =>
  ['runtime', 'migrator'].map((kind) => ({
    key: `${boundary.toUpperCase()}_${kind === 'runtime' ? '' : 'MIGRATION_'}DATABASE_URL`,
    role: `thaarei_${boundary}_${kind}`,
  })),
);
export function replacementCredentials(environment) {
  const replacement = { ...environment };
  for (const { key } of roleConnections) {
    const url = new URL(environment[key]);
    url.password = randomBytes(48).toString('base64url');
    replacement[key] = url.toString();
  }
  return replacement;
}
// Explicit private administrative operation; never imported by an application or
// called at startup. The rehearsal uses this same function in a disposable cluster.
export async function retireDatabaseCredentials(previous, replacement) {
  const target = new URL(previous.PROVISION_DATABASE_URL);
  for (const environment of [previous, replacement])
    for (const { key, role } of roleConnections) {
      const url = new URL(environment[key]);
      assert.equal(url.username, role);
      assert.equal(url.host, target.host);
      assert.equal(url.pathname, target.pathname);
      assert.ok(url.password.length >= 32 && !url.hash);
    }
  assert.equal(
    new Set(roleConnections.map(({ key }) => new URL(replacement[key]).password)).size,
    roleConnections.length,
    'Each replacement role requires a distinct credential',
  );
  const admin = new pg.Pool({
    connectionString: previous.PROVISION_DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 1500,
  });
  let client;
  try {
    client = await admin.connect();
    const installed = (
      await client.query(
        'SELECT tenant_id,customer_key,application_id FROM turnstile.installation WHERE singleton=1',
      )
    ).rows[0];
    assert.deepEqual(installed, {
      tenant_id: previous.INSTALLATION_TENANT_ID,
      customer_key: previous.INSTALLATION_CUSTOMER_KEY,
      application_id: previous.TURNSTILE_APPLICATION_ID,
    });
    const roles = roleConnections.map(({ role }) => role);
    assert.equal(
      (
        await client.query(
          'SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename=ANY($1::text[]) AND datname<>current_database()',
          [roles],
        )
      ).rows[0].n,
      0,
      'Dedicated roles must not serve another database',
    );
    await client.query('BEGIN');
    try {
      for (const { key, role } of roleConnections) {
        const before = new URL(previous[key]);
        const after = new URL(replacement[key]);
        assert.notEqual(before.password, after.password);
        const sql = (
          await client.query(
            "SELECT format('ALTER ROLE %I PASSWORD %L',$1::text,$2::text) AS sql",
            [role, decodeURIComponent(after.password)],
          )
        ).rows[0].sql;
        await client.query(sql);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
    const established = (
      await client.query(
        'SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND usename=ANY($1::text[])',
        [roles],
      )
    ).rows[0].n;
    const retired = await client.query(
      'SELECT pg_terminate_backend(pid) AS stopped FROM pg_stat_activity WHERE datname=current_database() AND usename=ANY($1::text[]) AND pid<>pg_backend_pid()',
      [roles],
    );
    for (const { key, role } of roleConnections) {
      const oldPool = new pg.Pool({
        connectionString: previous[key],
        max: 1,
        connectionTimeoutMillis: 1500,
      });
      try {
        await assert.rejects(oldPool.query('SELECT 1'), { code: '28P01' });
      } finally {
        await oldPool.end();
      }
      const current = new pg.Pool({
        connectionString: replacement[key],
        max: 1,
        connectionTimeoutMillis: 1500,
      });
      try {
        assert.equal((await current.query('SELECT current_user AS role')).rows[0].role, role);
      } finally {
        await current.end();
      }
    }
    return {
      roles,
      establishedConnectionsBeforeTermination: established,
      terminatedConnections: retired.rows.filter((r) => r.stopped).length,
      previousCredentialsDenied: true,
      replacementCredentialsVerified: true,
    };
  } finally {
    client?.release();
    await admin.end();
  }
}
