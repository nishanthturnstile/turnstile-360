// Private fixture instrumentation; never a consumer dependency or HTTP endpoint.
// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: Private fixture uses the deployed coordinator environment; it is not a cached Turbo task.
import { Client } from 'pg';

const db = new Client({
  connectionString: process.env.DMS_COORDINATOR_DATABASE_URL,
  connectionTimeoutMillis: 3000,
});
try {
  await db.connect();
  await db.query('BEGIN READ ONLY');
  await db.query("SELECT set_config('app.tenant_id',$1,true)", [
    process.env.INSTALLATION_TENANT_ID,
  ]);
  const jobs = (
    await db.query(
      `SELECT j.task,count(*)::int jobs,count(*) FILTER(WHERE j.state IN ('QUEUED','RUNNING','RETRY_WAIT'))::int pending,coalesce(max(extract(epoch FROM clock_timestamp()-j.created_at)) FILTER(WHERE j.state IN ('QUEUED','RETRY_WAIT')),0)::float8 oldest_queued_seconds,coalesce(max(extract(epoch FROM a.first_start-j.created_at)),0)::float8 max_queue_wait_seconds FROM dms.work_job j LEFT JOIN LATERAL(SELECT min(started_at) first_start FROM dms.work_attempt WHERE tenant_id=j.tenant_id AND job_id=j.id) a ON true WHERE j.tenant_id=$1 GROUP BY j.task`,
      [process.env.INSTALLATION_TENANT_ID],
    )
  ).rows;
  const connections = (
    await db.query(
      "SELECT count(*)::int total,count(*) FILTER(WHERE state='active')::int active FROM pg_stat_activity WHERE datname=current_database()",
    )
  ).rows[0];
  await db.query('COMMIT');
  console.log(JSON.stringify({ jobs, connections }));
} catch {
  console.error('Private fixture observation unavailable');
  process.exitCode = 1;
} finally {
  await db.end();
}
