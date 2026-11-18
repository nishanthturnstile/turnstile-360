import { Pool } from 'pg';

// One-off only, against a NEW dedicated central database. Passwords arrive via protected stdin.
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 4096) throw new Error('Input too large');
}
let data;
try {
  data = JSON.parse(input);
} catch {
  throw new Error('Invalid private provisioning input');
}
if (!data || typeof data !== 'object') throw new Error('Invalid private provisioning input');
for (const key of ['migrationPassword', 'runtimePassword']) {
  if (typeof data[key] !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(data[key]))
    throw new Error('Use independent random base64url passwords');
}
if (data.migrationPassword === data.runtimePassword) throw new Error('Distinct passwords required');
// biome-ignore lint/suspicious/noUndeclaredEnvVars: Private uncached provisioning command, never a build input.
const provisionUrl = process.env.CONTROL_PLANE_PROVISION_DATABASE_URL;
if (!provisionUrl || !/^postgres(?:ql)?:/.test(provisionUrl))
  throw new Error('Explicit central provisioning URL required');
const pool = new Pool({ connectionString: provisionUrl, max: 1 });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const existing = await client.query(
    "SELECT 1 FROM pg_roles WHERE rolname IN ('control_plane_migrator','control_plane_runtime')",
  );
  if (existing.rowCount) throw new Error('Roles already exist');
  const database = (await client.query('SELECT current_database() AS name')).rows[0].name;
  const quotedDatabase = `"${database.replaceAll('"', '""')}"`;
  await client.query(
    `CREATE ROLE control_plane_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${data.migrationPassword}'`,
  );
  await client.query(
    `CREATE ROLE control_plane_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${data.runtimePassword}'`,
  );
  await client.query(`REVOKE ALL ON DATABASE ${quotedDatabase} FROM PUBLIC`);
  await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await client.query(
    `GRANT CONNECT,CREATE ON DATABASE ${quotedDatabase} TO control_plane_migrator`,
  );
  await client.query(`GRANT CONNECT ON DATABASE ${quotedDatabase} TO control_plane_runtime`);
  await client.query('COMMIT');
  console.log('Central roles provisioned');
} catch {
  await client.query('ROLLBACK');
  throw new Error('Central provisioning failed; no role changes committed');
} finally {
  client.release();
  await pool.end();
}
