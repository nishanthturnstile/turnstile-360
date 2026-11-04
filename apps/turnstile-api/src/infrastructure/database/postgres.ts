import { Pool, type PoolClient } from 'pg';

export function createPool(connectionString: string, max = 5): Pool {
  const pool = new Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 1500,
    idleTimeoutMillis: 10000,
    statement_timeout: 5000,
    query_timeout: 5000,
  });
  // No SQL, credentials or recovery material in logs. Availability is checked at use/readiness.
  pool.on('error', () => {});
  return pool;
}

export async function assertRuntimeRole(pool: Pool, owner: 'auth' | 'dms' | 'turnstile') {
  const role = `thaarei_${owner}_runtime`;
  const { rows } = await pool.query<{ safe: boolean }>(
    `
    SELECT current_user = $1 AND session_user = $1 AND NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)
      AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = current_user))
      AND NOT has_database_privilege(current_user, current_database(), 'CREATE')
      AND NOT has_database_privilege(current_user, current_database(), 'TEMP')
      AND NOT has_schema_privilege(current_user, $2, 'CREATE')
      AND NOT EXISTS (
        SELECT 1 FROM pg_namespace WHERE nspname IN ('auth', 'dms', 'turnstile')
          AND nspname <> $2 AND has_schema_privilege(current_user, oid, 'USAGE')
      ) AS safe FROM pg_roles WHERE rolname = current_user`,
    [role, owner],
  );
  if (!rows[0]?.safe) throw new Error('Unsafe database runtime role');
}

export async function withTenant<T>(
  pool: Pool,
  tenantId: string,
  work: (client: PoolClient) => Promise<T>,
  deadlineAt?: number,
): Promise<T> {
  if (deadlineAt !== undefined) return withTenantDeadline(pool, tenantId, work, deadlineAt);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function withTenantDeadline<T>(
  pool: Pool,
  tenantId: string,
  work: (client: PoolClient) => Promise<T>,
  deadlineAt: number,
): Promise<T> {
  const expired = () => new Error('Database request deadline exceeded');
  if (Date.now() >= deadlineAt) throw expired();
  let client: PoolClient | undefined;
  let released = false;
  let timedOut = false;
  const release = (destroy = false) => {
    if (client && !released) {
      released = true;
      client.release(destroy);
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => {
        timedOut = true;
        release(true);
        reject(expired());
      },
      Math.max(1, deadlineAt - Date.now()),
    );
    timer.unref();
  });
  const run = async () => {
    client = await pool.connect();
    if (timedOut) {
      release(true);
      throw expired();
    }
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await work(client);
      if (Date.now() >= deadlineAt) throw expired();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (!released) await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      release(timedOut);
    }
  };
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
