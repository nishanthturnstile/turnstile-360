import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { z } from 'zod';
import { createPool } from './postgres.js';

type Owner = 'turnstile';

export async function migrateDatabase(owner: Owner, environment = process.env) {
  const value = environment[`${owner.toUpperCase()}_MIGRATION_DATABASE_URL`];
  if (!value || !URL.canParse(value)) throw new Error('Missing migration connection');
  const url = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.password ||
    !url.pathname.slice(1) ||
    url.username !== `thaarei_${owner}_migrator`
  )
    throw new Error('Use the dedicated migration role');
  const pool = createPool(value, 1);
  try {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        'SELECT current_user AS name, session_user AS login, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user',
      );
      const role = rows[0];
      if (
        role?.name !== `thaarei_${owner}_migrator` ||
        role.login !== role.name ||
        role.rolsuper ||
        role.rolbypassrls ||
        role.rolcreaterole ||
        role.rolcreatedb
      )
        throw new Error('Unsafe migration role');
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [`thaarei:${owner}:migration`]);
      try {
        await migrate(drizzle(client), {
          migrationsFolder: fileURLToPath(
            new URL('../../../' + 'database/migrations', import.meta.url),
          ),
          migrationsSchema: `${owner}_migrations`,
        });
      } finally {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [
          `thaarei:${owner}:migration`,
        ]);
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

export async function bootstrapInstallation(environment = process.env) {
  const owner = 'turnstile';
  const tenantId = z.uuid().toLowerCase().parse(environment.INSTALLATION_TENANT_ID);
  const customerKey = z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
    .parse(environment.INSTALLATION_CUSTOMER_KEY);
  const applicationId = z.uuid().toLowerCase().parse(environment.TURNSTILE_APPLICATION_ID);
  const value = environment[`${owner.toUpperCase()}_MIGRATION_DATABASE_URL`];
  if (!value || !URL.canParse(value) || new URL(value).username !== `thaarei_${owner}_migrator`)
    throw new Error('Use the dedicated migration role');
  const pool = createPool(value, 1);
  try {
    const client = await pool.connect();
    try {
      const {
        rows: [role],
      } = await client.query(
        'SELECT current_user AS name, session_user AS login, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user',
      );
      if (
        role?.name !== `thaarei_${owner}_migrator` ||
        role.login !== role.name ||
        role.rolsuper ||
        role.rolbypassrls ||
        role.rolcreaterole ||
        role.rolcreatedb
      )
        throw new Error('Unsafe migration role');
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO turnstile.installation (singleton, tenant_id, customer_key, application_id) VALUES (1, $1, $2, $3) ON CONFLICT (singleton) DO NOTHING',
        [tenantId, customerKey, applicationId],
      );
      const { rows } = await client.query(
        'SELECT tenant_id, customer_key, application_id FROM turnstile.installation WHERE singleton = 1 FOR UPDATE',
      );
      const row = rows[0];
      if (
        row?.tenant_id !== tenantId ||
        row.customer_key !== customerKey ||
        row.application_id !== applicationId
      )
        throw new Error('Installation identity cannot be replaced');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const action = process.argv[2];
    if (action === 'bootstrap') await bootstrapInstallation();
    else if (['turnstile'].includes(action ?? '')) await migrateDatabase(action as Owner);
    else throw new Error('Unknown database operation');
    console.log('Owned database operation completed');
  } catch {
    console.error(
      'Owned database operation failed; check configuration, role ownership, migrations and installation identity',
    );
    process.exitCode = 1;
  }
}
