import { dirname } from 'node:path';
import { machineReport } from '@thaarei/control-plane-contracts';
import {
  DeploymentClient,
  httpsTransport,
  nextSyncDelay,
  readProtectedTrust,
} from '@thaarei/deployment-control';
import type { Pool } from 'pg';
import { operationsSnapshot } from '../processing/operations.js';
import { withCoordinator } from '../uploads/admission-maintenance.js';
import { DmsDeploymentStore } from './store.js';
// Started after the private listener; no central dependency in bootstrap or health.
export function startDeploymentReporter(pool: Pool, tenantId: string) {
  let stopped = false,
    running: Promise<void> | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    failures = 0;
  const tick = async () => {
    try {
      const file = process.env.CONTROL_PLANE_MACHINE_SECRET_FILE;
      const marker = process.env.CONTROL_PLANE_RECOVERY_MARKER_FILE;
      const origin = process.env.CONTROL_PLANE_ORIGIN;
      const keys = process.env.CONTROL_PLANE_VERIFICATION_KEYS_FILE;
      if (!file || !marker || !origin || !keys)
        throw new Error('Private reporter configuration missing');
      if (file !== `${dirname(file)}/product.json`)
        throw new Error('Expected protected product.json');
      const store = new DmsDeploymentStore(dirname(file), marker, pool, tenantId, false, true);
      const client = new DeploymentClient(
        store,
        httpsTransport(origin),
        () => readProtectedTrust(keys),
        undefined,
        (epoch) => deploymentSummary(pool, tenantId, epoch),
      );
      await client.sync();
      failures = 0;
    } catch {
      failures = Math.min(10, failures + 1);
    } finally {
      if (!stopped) {
        timer = setTimeout(start, nextSyncDelay(failures));
        timer.unref();
      }
    }
  };
  const start = () => {
    if (!stopped) running = tick();
  };
  timer = setTimeout(start, 0);
  timer.unref();
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await running;
  };
}

export async function deploymentSummary(pool: Pool, tenantId: string, epoch: string | null) {
  if (!epoch || !process.env.DMS_BUILD_VERSION) return null;
  return withCoordinator(
    pool,
    { tenantId, customerKey: process.env.INSTALLATION_CUSTOMER_KEY ?? '' },
    async (tx) => {
      const source = await operationsSnapshot(tx);
      let ordering = {};
      if (epoch) {
        const sequence = (
          await tx.client.query(
            "UPDATE dms.deployment_control SET credential_metadata=(CASE WHEN jsonb_typeof(credential_metadata)='object' THEN credential_metadata ELSE '{}'::jsonb END)||jsonb_build_object('lastReportEpoch',$1::text,'lastReportSequence',CASE WHEN credential_metadata->>'lastReportEpoch'=$1 THEN (credential_metadata->>'lastReportSequence')::bigint+1 ELSE 1 END) WHERE credential_metadata->>'lastReportEpoch' IS DISTINCT FROM $1 OR coalesce((credential_metadata->>'lastReportSequence')::bigint,0)<9007199254740991 RETURNING (credential_metadata->>'lastReportSequence')::bigint AS sequence",
            [epoch],
          )
        ).rows[0]?.sequence;
        if (!sequence) throw new Error('Report sequence exhausted; reviewed rebind required');
        ordering = { reportEpoch: epoch, sequence: Number(sequence) };
      }
      const usage = (await tx.client.query('SELECT dms.deployment_usage_snapshot() AS value'))
        .rows[0].value;
      return machineReport.parse({
        product: 'dms',
        ...ordering,
        ...usage,
        observedAt: source.observedAt,
        buildVersion: process.env.DMS_BUILD_VERSION,
        processingReady: source.processingReady,
        pendingJobs: source.backlog.pending,
        failedJobs: source.backlog.failed,
        outbox: source.backlog.outbox,
        storageFreeBytes: source.capacity.fresh ? source.capacity.storageFreeBytes : null,
        scratchFreeBytes: source.capacity.fresh ? source.capacity.scratchFreeBytes : null,
      });
    },
  );
}
