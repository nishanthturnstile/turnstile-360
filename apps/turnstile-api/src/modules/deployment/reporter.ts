import { dirname } from 'node:path';
import { machineReport } from '@thaarei/control-plane-contracts';
import {
  DeploymentClient,
  httpsTransport,
  nextSyncDelay,
  readProtectedTrust,
} from '@thaarei/deployment-control';
import { createPool, withTenant } from '../../infrastructure/database/postgres.js';
import { TurnstileDeploymentStore } from './store.js';
// Dedicated process: no customer session, DMS credential, identity or business dependencies.
export function startReporter() {
  const url = process.env.TURNSTILE_REPORTER_DATABASE_URL;
  if (!url) throw new Error('Dedicated reporter database required');
  const pool = createPool(url, 3);
  let stopping = false,
    timer: ReturnType<typeof setTimeout> | undefined,
    active: Promise<void> | undefined,
    failures = 0;
  const tick = async () => {
    try {
      const file = process.env.TURNSTILE_CONTROL_PLANE_MACHINE_SECRET_FILE;
      const marker = process.env.TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE;
      const keys = process.env.TURNSTILE_CONTROL_PLANE_VERIFICATION_KEYS_FILE;
      const origin = process.env.TURNSTILE_CONTROL_PLANE_ORIGIN;
      const tenant = process.env.INSTALLATION_TENANT_ID;
      if (
        !file ||
        !marker ||
        !keys ||
        !origin ||
        !tenant ||
        file !== `${dirname(file)}/product.json`
      )
        throw new Error('Private reporter configuration required');
      const client = new DeploymentClient(
        new TurnstileDeploymentStore(dirname(file), marker, pool, tenant, false, true),
        httpsTransport(origin),
        () => readProtectedTrust(keys),
        undefined,
        async (epoch) => {
          if (!epoch || !process.env.TURNSTILE_BUILD_VERSION) return null;
          return withTenant(pool, tenant, async (db) => {
            const sequence = (
              await db.query(
                "UPDATE turnstile.deployment_control SET credential_metadata=(CASE WHEN jsonb_typeof(credential_metadata)='object' THEN credential_metadata ELSE '{}'::jsonb END)||jsonb_build_object('lastReportEpoch',$1::text,'lastReportSequence',CASE WHEN credential_metadata->>'lastReportEpoch'=$1 THEN (credential_metadata->>'lastReportSequence')::bigint+1 ELSE 1 END) WHERE credential_metadata->>'lastReportEpoch' IS DISTINCT FROM $1 OR coalesce((credential_metadata->>'lastReportSequence')::bigint,0)<9007199254740991 RETURNING (credential_metadata->>'lastReportSequence')::bigint AS sequence",
                [epoch],
              )
            ).rows[0]?.sequence;
            if (!sequence) throw new Error('Report sequence exhausted; reviewed rebind required');
            const summary = (await db.query('SELECT turnstile.deployment_summary() AS value'))
              .rows[0].value;
            return machineReport.parse({
              product: 'turnstile',
              reportEpoch: epoch,
              sequence: Number(sequence),
              observedAt: new Date().toISOString(),
              buildVersion: process.env.TURNSTILE_BUILD_VERSION,
              ...summary,
            });
          });
        },
      );
      await client.sync();
      failures = 0;
    } catch {
      failures = Math.min(10, failures + 1);
    } finally {
      if (!stopping) {
        timer = setTimeout(start, nextSyncDelay(failures));
        timer.unref();
      }
    }
  };
  const start = () => {
    if (!stopping) active = tick();
  };
  timer = setTimeout(start, 0);
  timer.unref();
  return async () => {
    stopping = true;
    clearTimeout(timer);
    await active;
    await pool.end();
  };
}
