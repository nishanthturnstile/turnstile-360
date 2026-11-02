import type { PoolClient } from 'pg';

// Shared with the private grant writer; acquire before grant/unit rows, never across HTTP.
export async function lockConfiguration(client: PoolClient, tenantId: string) {
  return (
    await client.query(
      'SELECT * FROM turnstile.organization_configuration WHERE tenant_id = $1 FOR UPDATE',
      [tenantId],
    )
  ).rows[0];
}
