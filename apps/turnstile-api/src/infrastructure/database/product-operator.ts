import type { PoolClient } from 'pg';
import { z } from 'zod';
import { createPool, withTenant } from './postgres.js';

const installationInput = z.object({
  INSTALLATION_TENANT_ID: z.uuid().toLowerCase(),
  INSTALLATION_CUSTOMER_KEY: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  TURNSTILE_APPLICATION_ID: z.uuid().toLowerCase(),
  TURNSTILE_MIGRATION_DATABASE_URL: z.url(),
});

export interface OperatorInstallation {
  tenant_id: string;
  customer_key: string;
  application_id: string;
}

// Private owning operations verify existing identity, never bootstrap it.
export async function withProductOperator<T>(
  environment: NodeJS.ProcessEnv,
  work: (client: PoolClient, installation: OperatorInstallation) => Promise<T>,
): Promise<T> {
  const config = installationInput.parse(environment);
  const url = new URL(config.TURNSTILE_MIGRATION_DATABASE_URL);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.username !== 'thaarei_turnstile_migrator' ||
    !url.password ||
    url.pathname.length < 2 ||
    url.hash
  )
    throw new Error('Dedicated product migrator required');
  const pool = createPool(config.TURNSTILE_MIGRATION_DATABASE_URL, 1);
  try {
    return await withTenant(pool, config.INSTALLATION_TENANT_ID, async (client) => {
      const role = (
        await client.query(`SELECT current_user = 'thaarei_turnstile_migrator' AND session_user = current_user
        AND NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)
        AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = current_user)) AS safe
        FROM pg_roles WHERE rolname = current_user`)
      ).rows[0];
      if (!role?.safe) throw new Error('Unsafe operator role');
      const installed = (
        await client.query<OperatorInstallation>(
          'SELECT tenant_id, customer_key, application_id FROM turnstile.installation WHERE singleton = 1 FOR UPDATE',
        )
      ).rows[0];
      if (
        installed?.tenant_id !== config.INSTALLATION_TENANT_ID ||
        installed?.customer_key !== config.INSTALLATION_CUSTOMER_KEY ||
        installed?.application_id !== config.TURNSTILE_APPLICATION_ID
      )
        throw new Error('Existing fixed installation required');
      return work(client, installed);
    });
  } finally {
    await pool.end();
  }
}
