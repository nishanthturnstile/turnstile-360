import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Explicit operator action for a dedicated installation database. Never called at API startup.
export async function provisionDatabase(environment) {
  const adminUrl = environment.PROVISION_DATABASE_URL;
  if (!adminUrl || !URL.canParse(adminUrl)) throw new Error('Missing operator database connection');
  const admin = new URL(adminUrl);
  const connections = [];
  for (const owner of ['auth', 'dms', 'turnstile']) {
    for (const kind of ['runtime', 'migrator']) {
      const key = `${owner.toUpperCase()}_${kind === 'runtime' ? '' : 'MIGRATION_'}DATABASE_URL`;
      const value = environment[key];
      if (!value || !URL.canParse(value)) throw new Error(`Invalid ${key}`);
      const url = new URL(value);
      const role = `thaarei_${owner}_${kind}`;
      if (
        !['postgres:', 'postgresql:'].includes(url.protocol) ||
        url.username !== role ||
        !url.password ||
        url.host !== admin.host ||
        url.pathname !== admin.pathname ||
        url.hash
      ) {
        throw new Error(`Invalid ${key}`);
      }
      connections.push({ role, kind, password: decodeURIComponent(url.password) });
    }
  }
  if (new Set(connections.map((connection) => connection.password)).size !== connections.length)
    throw new Error('Use separate role credentials');
  const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 3000 });
  let stage = 'connect';
  try {
    await client.connect();
    await client.query('BEGIN');
    const {
      rows: [database],
    } = await client.query('SELECT current_database() AS name');
    for (const connection of connections) {
      stage = 'create_role';
      const {
        rows: [sql],
      } = await client.query(
        "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD %L', $1::text, $2::text) AS command",
        [connection.role, connection.password],
      );
      // Re-running refuses existing roles; this command never silently rotates credentials.
      await client.query(sql.command);
    }
    stage = 'revoke_public';
    const {
      rows: [revoke],
    } = await client.query(
      "SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', $1::text) AS command",
      [database.name],
    );
    await client.query(revoke.command);
    await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    for (const connection of connections) {
      const {
        rows: [grant],
      } = await client.query(
        "SELECT format('GRANT CONNECT ON DATABASE %I TO %I', $1::text, $2::text) AS command",
        [database.name, connection.role],
      );
      await client.query(grant.command);
      if (connection.kind === 'migrator') {
        const {
          rows: [create],
        } = await client.query(
          "SELECT format('GRANT CREATE ON DATABASE %I TO %I', $1::text, $2::text) AS command",
          [database.name, connection.role],
        );
        await client.query(create.command);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    const code =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      /^[A-Z0-9]{5}$/.test(String(error.code))
        ? String(error.code)
        : 'unknown';
    throw new Error(
      `Database role provisioning failed (${stage}, ${code}); use a dedicated database and fresh roles`,
    );
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    await provisionDatabase(process.env);
    console.log(
      'Installation database roles provisioned; run each owned migration and bootstrap command next',
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Database provisioning failed');
    process.exitCode = 1;
  }
}
