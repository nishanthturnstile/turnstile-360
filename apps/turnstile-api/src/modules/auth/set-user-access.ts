import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TURNSTILE_PERMISSIONS } from '@thaarei/turnstile-contracts';
import { z } from 'zod';
import { bootstrapInstallation } from '../../infrastructure/database/migrate.js';
import { createPool, withTenant } from '../../infrastructure/database/postgres.js';

const inputSchema = z
  .object({
    userId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
    enabled: z.boolean(),
    permissions: z
      .array(z.enum(TURNSTILE_PERMISSIONS))
      .max(TURNSTILE_PERMISSIONS.length)
      .refine((value) => new Set(value).size === value.length),
  })
  .strict();

// Private deployment/operator command. Runtime APIs retain read-only access to grants.
export async function setUserAccess(input: unknown, environment = process.env) {
  const value = inputSchema.parse(input);
  await bootstrapInstallation(environment);
  const tenantId = z.uuid().parse(environment.INSTALLATION_TENANT_ID);
  const connection = environment.TURNSTILE_MIGRATION_DATABASE_URL;
  if (!connection) throw new Error('Missing migration role');
  const pool = createPool(connection, 1);
  try {
    await withTenant(pool, tenantId, (client) =>
      client.query(
        'INSERT INTO turnstile.user_access (tenant_id, user_id, enabled, permissions) VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, user_id) DO UPDATE SET enabled = EXCLUDED.enabled, permissions = EXCLUDED.permissions',
        [tenantId, value.userId, value.enabled, value.permissions],
      ),
    );
    return {
      action: 'set-user-access',
      at: new Date().toISOString(),
      tenantId,
      applicationId: environment.TURNSTILE_APPLICATION_ID,
      ...value,
    };
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    if (process.stdin.isTTY) throw new Error('Supply private JSON input');
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > 4096) throw new Error('Input too large');
    }
    console.log(JSON.stringify(await setUserAccess(JSON.parse(input))));
  } catch {
    console.error(
      'Product access assignment failed; check input, installation and dedicated operator connection',
    );
    process.exitCode = 1;
  }
}
