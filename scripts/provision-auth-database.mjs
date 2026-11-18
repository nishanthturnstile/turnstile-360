import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Explicit operator action for a dedicated installation database. Never called at API startup.
export async function provisionDatabase(
  environment,
  dmsAccessOnly = false,
  turnstileReporterOnly = false,
) {
  const selection = environment.DATABASE_PROFILE ?? 'combined';
  if (!['combined', 'dms', 'turnstile'].includes(selection))
    throw new Error('Invalid DATABASE_PROFILE');
  if (
    turnstileReporterOnly &&
    (selection === 'dms' || !environment.TURNSTILE_REPORTER_DATABASE_URL)
  )
    throw new Error('Turnstile reporter provisioning requires its dedicated connection');
  const adminUrl = environment.PROVISION_DATABASE_URL;
  if (!adminUrl || !URL.canParse(adminUrl)) throw new Error('Missing operator database connection');
  const admin = new URL(adminUrl);
  const connections = [];
  if (dmsAccessOnly && turnstileReporterOnly)
    throw new Error('Choose one private provisioning scope');
  for (const owner of dmsAccessOnly || turnstileReporterOnly
    ? []
    : selection === 'dms'
      ? ['auth', 'dms']
      : selection === 'turnstile'
        ? ['turnstile']
        : ['auth', 'dms', 'turnstile']) {
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
  for (const kind of turnstileReporterOnly || selection === 'turnstile'
    ? []
    : ['operator', 'coordinator']) {
    const key = `DMS_${kind.toUpperCase()}_DATABASE_URL`;
    const value = environment[key];
    const role = `thaarei_dms_${kind}`;
    if (!value) {
      connections.push({ role, kind, password: null });
      continue;
    }
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.username !== role ||
      !url.password ||
      url.host !== admin.host ||
      url.pathname !== admin.pathname ||
      url.hash
    )
      throw new Error(`Invalid ${key}`);
    connections.push({ role, kind, password: decodeURIComponent(url.password) });
  }
  if (selection !== 'dms' && !dmsAccessOnly) {
    const value = environment.TURNSTILE_REPORTER_DATABASE_URL;
    const role = 'thaarei_turnstile_reporter';
    if (value) {
      const url = new URL(value);
      if (
        !['postgres:', 'postgresql:'].includes(url.protocol) ||
        url.username !== role ||
        !url.password ||
        url.host !== admin.host ||
        url.pathname !== admin.pathname ||
        url.hash
      )
        throw new Error('Invalid TURNSTILE_REPORTER_DATABASE_URL');
      connections.push({ role, kind: 'reporter', password: decodeURIComponent(url.password) });
    } else connections.push({ role, kind: 'reporter', password: null });
  }
  if (
    new Set(connections.filter((c) => c.password).map((connection) => connection.password)).size !==
    connections.filter((c) => c.password).length
  )
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
      await client.query(
        connection.password
          ? sql.command
          : `CREATE ROLE ${connection.role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
      );
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
    throw Object.assign(
      new Error(
        `Database role provisioning failed (${stage}, ${code}); use a dedicated database and fresh roles`,
      ),
      {
        retryableBeforeEffects:
          stage === 'connect' &&
          !!error &&
          typeof error === 'object' &&
          'code' in error &&
          [
            '57P03',
            '53300',
            '08000',
            '08001',
            '08006',
            'ECONNREFUSED',
            'ETIMEDOUT',
            'ENETUNREACH',
            'EHOSTUNREACH',
            'ENOTFOUND',
            'EAI_AGAIN',
          ].includes(String(error.code)),
      },
    );
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    await provisionDatabase(
      process.env,
      process.argv.includes('--dms-access-only'),
      process.argv.includes('--turnstile-reporter-only'),
    );
    console.log(
      'Installation database roles provisioned; run each owned migration and bootstrap command next',
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Database provisioning failed');
    process.exitCode =
      error &&
      typeof error === 'object' &&
      'retryableBeforeEffects' in error &&
      error.retryableBeforeEffects === true
        ? 75
        : 1;
  }
}
