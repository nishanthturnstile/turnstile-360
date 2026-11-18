import { Pool } from 'pg';

if (process.argv.length !== 2) throw new Error('No arguments accepted');
const url = process.env.CONTROL_PLANE_MIGRATION_DATABASE_URL;
let roleName = '';
try {
  roleName = url ? new URL(url).username : '';
} catch {}
if (!url || roleName !== 'control_plane_migrator')
  throw new Error('Owning migration role required');
const pool = new Pool({ connectionString: url, max: 1, statement_timeout: 15000 });
try {
  const role = (await pool.query('SELECT current_user AS name')).rows[0].name;
  if (role !== 'control_plane_migrator') throw new Error('Owning migration role required');
  console.log(
    JSON.stringify(
      (await pool.query('SELECT control_plane.prune_reporting() AS counts')).rows[0].counts,
    ),
  );
} catch {
  throw new Error('Report retention failed');
} finally {
  await pool.end();
}
