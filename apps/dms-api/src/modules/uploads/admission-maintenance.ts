import { stat, statfs } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  assertDatabaseRole,
  createPool,
  withTenant,
} from '../../infrastructure/database/postgres.js';
import {
  bindPrincipal,
  type CoordinatorContext,
  type DmsTransaction,
} from '../access/resource-policy.js';
import { appendDocumentAudit } from '../audit/document-audit.js';
import { type AdmissionReceipt, lockUsage, measuredStorageBytes } from './admission.service.js';

export async function withCoordinator<T>(
  pool: Pool,
  identity: { tenantId: string; customerKey: string },
  work: (tx: DmsTransaction<CoordinatorContext>) => Promise<T>,
) {
  await assertDatabaseRole(pool, 'thaarei_dms_coordinator', 'dms');
  return withTenant(pool, identity.tenantId, async (client) => {
    const { rows } = await client.query(
      'SELECT tenant_id,customer_key FROM dms.installation WHERE singleton=1',
    );
    if (rows[0]?.tenant_id !== identity.tenantId || rows[0]?.customer_key !== identity.customerKey)
      throw new Error('Installation mismatch');
    if (!(await client.query('SELECT dms.recovery_open() AS open')).rows[0]?.open)
      throw new Error('Recovery remains closed');
    await client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [
      `dms-lifecycle:${identity.tenantId}`,
    ]);
    const context: CoordinatorContext = {
      kind: 'coordinator',
      tenantId: identity.tenantId,
      subjectId: 'thaarei_dms_coordinator',
    };
    await bindPrincipal(client, context);
    return work({ client, context });
  });
}
export async function observeCapacity(
  tx: DmsTransaction<CoordinatorContext>,
  storagePath: string,
  scratchPath: string,
  independentFilesystems = false,
) {
  if (!isAbsolute(storagePath) || !isAbsolute(scratchPath))
    throw new Error('Explicit trusted filesystem roots required');
  await tx.client.query(
    'INSERT INTO dms.admission_tenant_usage (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [tx.context.tenantId],
  );
  const usage = (await tx.client.query('SELECT * FROM dms.admission_tenant_usage FOR UPDATE'))
    .rows[0];
  // Keep the accounting lock across real filesystem sampling; measurements and the usage
  // baseline must describe the same admission boundary, including shared-device pressure.
  const [storage, scratch, storageInfo, scratchInfo] = await Promise.all([
    statfs(storagePath, { bigint: true }),
    statfs(scratchPath, { bigint: true }),
    stat(storagePath),
    stat(scratchPath),
  ]);
  const bounded = (bytes: bigint) => Number(bytes > 2n ** 50n ? 2n ** 50n : bytes);
  await tx.client.query(
    `INSERT INTO dms.admission_capacity (tenant_id,storage_free_bytes,scratch_free_bytes,used_at_observation,shared_device,observed_at)
    VALUES ($1,$2,$3,$4,$5,clock_timestamp()) ON CONFLICT (tenant_id) DO UPDATE SET storage_free_bytes=EXCLUDED.storage_free_bytes,scratch_free_bytes=EXCLUDED.scratch_free_bytes,used_at_observation=EXCLUDED.used_at_observation,shared_device=EXCLUDED.shared_device,observed_at=EXCLUDED.observed_at`,
    [
      tx.context.tenantId,
      bounded(storage.bavail * storage.bsize),
      bounded(scratch.bavail * scratch.bsize),
      measuredStorageBytes(usage),
      !independentFilesystems || storageInfo.dev === scratchInfo.dev,
    ],
  );
}
// Trusted control-plane accounting kernel. Measurements come from owning verified storage
// operations, never a public request or private operator-supplied byte count.
export async function reconcileAdmission(
  tx: DmsTransaction<CoordinatorContext>,
  admissionId: string,
  measurement: { stagingBytes: number; originalBytes: number },
  outcome: 'RELEASED' | 'SETTLED',
) {
  const found = (
    await tx.client.query<AdmissionReceipt>('SELECT * FROM dms.upload_admission WHERE id=$1', [
      admissionId,
    ])
  ).rows[0];
  if (!found) throw new Error('Admission unavailable');
  await lockUsage(tx.client, tx.context.tenantId, found.application_id);
  const row = (
    await tx.client.query<AdmissionReceipt>(
      'SELECT * FROM dms.upload_admission WHERE id=$1 FOR UPDATE',
      [admissionId],
    )
  ).rows[0];
  if (!row) throw new Error('Admission unavailable');
  if (row.state !== 'RESERVED') {
    if (
      row.state === outcome &&
      Number(row.staging_bytes) === measurement.stagingBytes &&
      Number(row.original_bytes) === measurement.originalBytes
    )
      return { changed: false };
    throw new Error('Conflicting measured outcome');
  }
  for (const bytes of Object.values(measurement))
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > Number(row.size))
      throw new Error('Unverified measurement');
  if (
    outcome === 'SETTLED' &&
    (row.storage_mode === 'REUSE'
      ? measurement.stagingBytes !== 0 || measurement.originalBytes !== 0
      : measurement.stagingBytes !== Number(row.size) ||
        measurement.originalBytes !== Number(row.size))
  )
    throw new Error('Complete snapshot measurements required');
  if (outcome === 'RELEASED') {
    const held = (
      await tx.client.query(
        "SELECT capability_expires_at IS NOT NULL AND capability_expires_at+interval '60 seconds'>now() AS held FROM dms.upload_admission WHERE id=$1",
        [admissionId],
      )
    ).rows[0]?.held;
    if (held) throw new Error('Transfer capability still live');
  }
  const releaseWork = outcome === 'RELEASED';
  const delta = [
    Number(row.reserved_storage),
    releaseWork ? Number(row.reserved_scratch) : 0,
    measurement.stagingBytes,
    measurement.originalBytes,
    releaseWork ? 1 : 0,
  ];
  const update = `SET reserved_storage=reserved_storage-$1,reserved_scratch=reserved_scratch-$2,staging_bytes=staging_bytes+$3,original_bytes=original_bytes+$4,active=active-1,queued=queued-$5`;
  await tx.client.query(`UPDATE dms.admission_tenant_usage ${update}`, delta);
  await tx.client.query(
    `UPDATE dms.admission_application_usage ${update} WHERE application_id=$6`,
    [...delta, row.application_id],
  );
  await tx.client.query(
    'UPDATE dms.upload_admission SET state=$1,reserved_storage=0,reserved_scratch=reserved_scratch-$2,staging_bytes=$3,original_bytes=$4,work_released=$5 WHERE id=$6',
    [
      outcome,
      delta[1],
      measurement.stagingBytes,
      measurement.originalBytes,
      releaseWork,
      admissionId,
    ],
  );
  await appendDocumentAudit(tx, {
    documentId: row.document_id,
    applicationId: row.application_id,
    action: 'admission.reconciled',
  });
  return { changed: true };
}
export async function releaseWorkReservation(
  tx: DmsTransaction<CoordinatorContext>,
  admissionId: string,
) {
  const initial = (
    await tx.client.query<AdmissionReceipt>('SELECT * FROM dms.upload_admission WHERE id=$1', [
      admissionId,
    ])
  ).rows[0];
  if (!initial) throw new Error('Admission unavailable');
  await lockUsage(tx.client, tx.context.tenantId, initial.application_id);
  const row = (
    await tx.client.query<AdmissionReceipt>(
      'SELECT * FROM dms.upload_admission WHERE id=$1 FOR UPDATE',
      [admissionId],
    )
  ).rows[0];
  if (row?.state !== 'SETTLED') throw new Error('Work not ready to release');
  if (row.work_released) return { changed: false };
  await tx.client.query(
    'UPDATE dms.admission_tenant_usage SET queued=queued-1,reserved_scratch=reserved_scratch-$1',
    [row.reserved_scratch],
  );
  await tx.client.query(
    'UPDATE dms.admission_application_usage SET queued=queued-1,reserved_scratch=reserved_scratch-$1 WHERE application_id=$2',
    [row.reserved_scratch, row.application_id],
  );
  await tx.client.query(
    'UPDATE dms.upload_admission SET work_released=true,reserved_scratch=0 WHERE id=$1',
    [admissionId],
  );
  await appendDocumentAudit(tx, {
    documentId: row.document_id,
    applicationId: row.application_id,
    action: 'admission.reconciled',
  });
  return { changed: true };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  let pool: Pool | undefined;
  try {
    const config = z
      .object({
        INSTALLATION_TENANT_ID: z.uuid(),
        INSTALLATION_CUSTOMER_KEY: z.string().min(1).max(128),
      })
      .parse(process.env);
    const url = process.env.DMS_COORDINATOR_DATABASE_URL;
    const storage = process.env.DMS_STORAGE_CAPACITY_PATH,
      scratch = process.env.DMS_SCRATCH_CAPACITY_PATH;
    if (!url || !storage || !scratch) throw new Error('Private capacity configuration required');
    const independent =
      z
        .enum(['false', 'true'])
        .default('false')
        .parse(process.env.DMS_CAPACITY_INDEPENDENT_FILESYSTEMS) === 'true';
    pool = createPool(url, 1);
    await withCoordinator(
      pool,
      { tenantId: config.INSTALLATION_TENANT_ID, customerKey: config.INSTALLATION_CUSTOMER_KEY },
      (tx) => observeCapacity(tx, storage, scratch, independent),
    );
    console.log('Private admission capacity observation recorded');
  } catch {
    console.error(
      'Capacity observation rejected; check private role, installation and trusted filesystem roots',
    );
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}
