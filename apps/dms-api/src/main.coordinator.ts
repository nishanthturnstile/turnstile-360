import { existsSync } from 'node:fs';
import { z } from 'zod';
import { startDeploymentReporter } from './modules/deployment/reporter.js';
import { disposeObjects } from './modules/lifecycle/disposal.js';
import { restoreLifecycleVersions } from './modules/lifecycle/lifecycle-restoration.js';
import { observeService } from './modules/processing/operations.js';
import { selectRestores, settleFailedRestores } from './modules/processing/restore-discovery.js';
import {
  selectCandidates,
  settleAbandonedUploads,
  settleCandidates,
} from './modules/processing/security-publication.js';
import {
  discoverUploads,
  expireBatches,
  expireUploads,
} from './modules/processing/upload-discovery.js';
import { WorkService } from './modules/processing/work.service.js';
import { StorageService } from './modules/storage/storage.service.js';
import { observeCapacity } from './modules/uploads/admission-maintenance.js';
import { createWorkApplication } from './work-bootstrap.js';

if (existsSync('.env.coordinator')) process.loadEnvFile('.env.coordinator');
const config = z
  .object({
    DMS_WORK_HOST: z.string().default('0.0.0.0'),
    DMS_WORK_PORT: z.coerce.number().int().min(1).max(65535).default(3003),
    DMS_STORAGE_CAPACITY_PATH: z.string().min(1),
    DMS_SCRATCH_CAPACITY_PATH: z.string().min(1),
    DMS_CAPACITY_INDEPENDENT_FILESYSTEMS: z.enum(['true', 'false']).default('false'),
  })
  .parse(process.env);
const app = await createWorkApplication(),
  work = app.get(WorkService),
  storage = app.get(StorageService);
await app.listen(config.DMS_WORK_PORT, config.DMS_WORK_HOST);
const stopDeployment = startDeploymentReporter(
  work.pool,
  process.env.INSTALLATION_TENANT_ID as string,
);
let stopped = false,
  running = false;
let active: Promise<void> | undefined;
const tick = async () => {
  if (stopped || running) return;
  running = true;
  try {
    const steps = [
      () =>
        work.internal((tx) =>
          observeCapacity(
            tx,
            config.DMS_STORAGE_CAPACITY_PATH,
            config.DMS_SCRATCH_CAPACITY_PATH,
            config.DMS_CAPACITY_INDEPENDENT_FILESYSTEMS === 'true',
          ),
        ),
      () => expireBatches(work),
      () => expireUploads(work),
      () => discoverUploads(work, storage),
      () => selectCandidates(work, storage),
      () => selectRestores(work, storage),
      () => restoreLifecycleVersions(work, storage),
      () => settleFailedRestores(work),
      () => work.recover(),
      () => settleCandidates(work),
      () => settleAbandonedUploads(work, storage),
      () => disposeObjects(work, storage),
    ];
    let healthy = true;
    for (const [index, step] of steps.entries()) {
      if (stopped) break;
      const started = Date.now();
      try {
        await step();
      } catch {
        healthy = false;
        if (process.stdout.writableLength < 65536)
          process.stdout.write(
            `${JSON.stringify({ type: 'coordinator', step: index, outcome: 'unavailable', durationMs: Math.min(60000, Date.now() - started) })}\n`,
          );
      }
    }
    if (process.env.DMS_OPERATIONS_ENABLED === 'true') {
      if (!stopped)
        try {
          if (
            !(await storage.forRole('snapshot').probe(process.env.INSTALLATION_TENANT_ID as string))
          )
            healthy = false;
        } catch {
          healthy = false;
        }
      await work.internal((tx) =>
        observeService(tx, 'coordinator', stopped ? 'stopping' : healthy ? 'ready' : 'degraded'),
      );
    }
  } finally {
    running = false;
  }
};
const startTick = () => {
  if (!running && !stopped) {
    active = tick().catch(() => {
      if (process.stdout.writableLength < 65536)
        process.stdout.write(
          `${JSON.stringify({ type: 'coordinator', outcome: 'unavailable' })}\n`,
        );
    });
    void active;
  }
};
const timer = setInterval(startTick, 5000);
work.registerDrain(async () => {
  stopped = true;
  clearInterval(timer);
  await stopDeployment();
  const timeout = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 60000);
    timer.unref();
  });
  await Promise.race([active, timeout]);
});
startTick();
