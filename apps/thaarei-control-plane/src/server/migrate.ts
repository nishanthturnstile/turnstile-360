import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const url = process.env.CONTROL_PLANE_MIGRATION_DATABASE_URL;
if (!url || new URL(url).username !== 'control_plane_migrator')
  throw new Error('Owning migration role required');
const pool = new Pool({ connectionString: url, max: 1 });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(860020)');
  await client.query('CREATE SCHEMA IF NOT EXISTS control_plane_migrations');
  await client.query(
    'CREATE TABLE IF NOT EXISTS control_plane_migrations.applied(name text PRIMARY KEY, digest text NOT NULL)',
  );
  const folder = fileURLToPath(new URL('../../database/', import.meta.url));
  for (const name of (await readdir(folder)).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = await readFile(`${folder}/${name}`, 'utf8');
    const digest = createHash('sha256').update(sql).digest('hex');
    const applied = await client.query(
      'SELECT digest FROM control_plane_migrations.applied WHERE name=$1',
      [name],
    );
    if (applied.rowCount) {
      if (applied.rows[0].digest !== digest) throw new Error('Applied migration changed');
      continue;
    }
    await client.query(sql);
    await client.query('INSERT INTO control_plane_migrations.applied VALUES($1,$2)', [
      name,
      digest,
    ]);
  }
  await client.query('COMMIT');
  console.log('Central migrations applied');
} catch {
  await client.query('ROLLBACK');
  throw new Error('Central migration failed');
} finally {
  client.release();
  await pool.end();
}
