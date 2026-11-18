import { binding, sameBinding } from '@thaarei/control-plane-contracts';
import {
  applyDecision,
  type DecisionState,
  initialDecisionState,
  nextSyncDelay,
  ProtectedFileStore,
  readProtectedTrust,
  type StoredProduct,
} from '@thaarei/deployment-control';
import type { Pool, PoolClient } from 'pg';
import { assertDatabaseRole, withTenant } from '../../infrastructure/database/postgres.js';
import { markerDigest } from './access.js';
export class DmsDeploymentStore extends ProtectedFileStore {
  constructor(
    directory: string,
    marker: string,
    readonly pool: Pool,
    readonly tenantId: string,
    readonly rebind = false,
    readonly readOnly = false,
  ) {
    super(directory, marker);
  }
  override async locked<T>(operation: () => Promise<T>): Promise<T> {
    // Session advisory lock spans HTTPS without keeping a database transaction open.
    // All replicas/operator commands share it; process/connection loss releases it.
    await assertDatabaseRole(this.pool, 'thaarei_dms_coordinator', 'dms');
    const connection = await this.pool.connect();
    const key = `dms-deployment:${this.tenantId}`;
    let discard = false;
    try {
      const acquired = (
        await connection.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired', [
          key,
        ])
      ).rows[0]?.acquired;
      if (!acquired) throw new Error('Deployment operation owned by another process');
      let lost = false;
      const loss = () => {
        lost = true;
      };
      connection.on('error', loss);
      try {
        const locked = this.readOnly
          ? async <R>(fn: () => Promise<R>) => fn()
          : this.lockFile.bind(this);
        return await locked(async () => {
          if (lost) throw new Error('Deployment lock lost');
          this.fence = async (db) => {
            if (lost) throw new Error('Deployment lock lost');
            await db.query('SELECT 1');
          };
          return this.readOnly ? this.reportLease(operation) : operation();
        });
      } finally {
        connection.off('error', loss);
        try {
          await connection.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]);
        } catch {
          discard = true;
        }
        this.fence = async () => {
          throw new Error('Shared operation lock required');
        };
      }
    } finally {
      connection.release(discard);
    }
  }
  private async reportLease<T>(operation: () => Promise<T>): Promise<T> {
    const eligible = await withTenant(this.pool, this.tenantId, async (db) => {
      const row = (
        await db.query(
          'SELECT credential_metadata,clock_timestamp() AS now FROM dms.deployment_control FOR UPDATE',
        )
      ).rows[0];
      const next = row?.credential_metadata?.nextAttemptAt;
      if (next && new Date(next).getTime() > new Date(row.now).getTime()) return false;
      await db.query(
        "UPDATE dms.deployment_control SET credential_metadata=coalesce(credential_metadata,'{}'::jsonb)||jsonb_build_object('nextAttemptAt',clock_timestamp()+interval '60 seconds')",
      );
      return true;
    });
    if (!eligible) throw new Error('Another elected reporter already scheduled this product');
    let succeeded = false;
    try {
      const result = await operation();
      succeeded = true;
      return result;
    } finally {
      await withTenant(this.pool, this.tenantId, async (db) => {
        await this.fence(db);
        const row = (
          await db.query('SELECT credential_metadata FROM dms.deployment_control FOR UPDATE')
        ).rows[0];
        const failures = succeeded
          ? 0
          : Math.min(10, Number(row?.credential_metadata?.reportFailures ?? 0) + 1);
        await db.query(
          "UPDATE dms.deployment_control SET credential_metadata=coalesce(credential_metadata,'{}'::jsonb)||jsonb_build_object('reportFailures',$1::int,'nextAttemptAt',clock_timestamp()+$2::int*interval '1 millisecond')",
          [failures, nextSyncDelay(failures)],
        );
      }).catch(() => {}); // Lost DB/lock cannot authorize another publication or promotion.
    }
  }
  private lockFile<T>(operation: () => Promise<T>) {
    return super.locked(operation);
  }
  private fence: (db: PoolClient) => Promise<void> = async () => {
    throw new Error('Shared operation lock required');
  };
  override async load() {
    const value = await super.load();
    if (!value) return null;
    const row = await withTenant(
      this.pool,
      this.tenantId,
      async (db) => (await db.query('SELECT dms.deployment_read() AS snapshot')).rows[0]?.snapshot,
    );
    if (this.readOnly && value.operation) throw new Error('Private credential recovery required');
    if (this.readOnly) value.report = row?.credential_metadata?.report ?? null;
    if (row?.decision && value.decision && row.decision.epoch === value.decision.epoch)
      value.decision = row.decision;
    if (row?.quarantined && value.decision && !this.rebind) value.decision.quarantined = true;
    return value;
  }
  override async save(value: StoredProduct) {
    const expected = binding.parse(value.binding);
    if (expected.product !== 'dms' || expected.tenantId !== this.tenantId)
      throw new Error('DMS binding mismatch');
    await withTenant(this.pool, this.tenantId, async (db) => {
      await this.fence(db);
      const row = (await db.query('SELECT * FROM dms.deployment_control FOR UPDATE')).rows[0];
      if (!row || row.local_installation_id !== expected.localInstallationId)
        throw new Error('Durable installation mismatch');
      if (row.binding && !sameBinding(binding.parse(row.binding), expected))
        throw new Error('Reviewed registry repair required');
      // Persist detection, including clock rollback or missing host marker, before returning
      // failure to the client. A new setup journal must not reopen restored old approval.
      if (value.decision?.quarantined) {
        await db.query('SELECT dms.deployment_quarantine()');
        return;
      }
      if (value.operation?.kind === 'activate' && !value.decision) {
        const existing = row.credential_metadata;
        const continuing = existing?.pendingSetupRequestId === value.operation.request.requestId;
        if (row.decision && !this.rebind && !(continuing && existing.pendingRebind))
          throw new Error('Reviewed rebind required');
        if (row.decision) await db.query('SELECT dms.deployment_quarantine()');
        await db.query(
          "UPDATE dms.deployment_control SET credential_metadata=coalesce(credential_metadata,'{}'::jsonb)||jsonb_build_object('pendingSetupRequestId',$1::text,'report',$2::jsonb,'pendingRebind',$3::boolean)",
          [
            value.operation.request.requestId,
            JSON.stringify(value.report),
            this.rebind || Boolean(continuing && existing?.pendingRebind),
          ],
        );
        return;
      }
      const clock = (await db.query('SELECT * FROM dms.deployment_clock_state')).rows[0];
      if (
        value.current &&
        row.credential_metadata?.epoch === value.current.epoch &&
        row.credential_metadata?.generation > value.current.generation &&
        (this.readOnly || !value.operation)
      )
        throw new Error('Credential generation advanced; reload the protected file');
      if (value.decision?.accepted) {
        const marker = await markerDigest();
        const trust = await readProtectedTrust(
          process.env.CONTROL_PLANE_VERIFICATION_KEYS_FILE ?? '',
        );
        if (value.origin !== trust.issuer || value.origin !== process.env.CONTROL_PLANE_ORIGIN)
          throw new Error('Pinned issuer mismatch');
        let old = row.decision as DecisionState | null;
        const newEpoch = !!old && old.epoch !== value.decision.epoch;
        const reviewedRebind =
          row.credential_metadata?.pendingRebind === true &&
          value.current?.operationId === row.credential_metadata?.pendingSetupRequestId;
        const freshRebind = reviewedRebind && (!old || newEpoch);
        if (newEpoch) {
          if (
            !reviewedRebind ||
            !value.current ||
            value.current.operationId !== row.credential_metadata?.pendingSetupRequestId
          )
            throw new Error('Reviewed durable rebind required');
          old = null;
        }
        if (
          (row.quarantined ||
            clock?.quarantined ||
            (row.marker_digest && row.marker_digest !== marker)) &&
          !freshRebind
        )
          throw new Error('Restore/clock quarantine requires fresh online rebind');
        if (old) old = { ...old, lastTime: Math.max(old.lastTime, Number(clock?.last_time ?? 0)) };
        const base = old ?? {
          ...initialDecisionState(value.decision.epoch),
          trustRevision: Number(row.decision?.trustRevision ?? 0),
        };
        const applied =
          old?.accepted?.digest === value.decision.accepted.digest
            ? old
            : await applyDecision(
                base,
                value.decision.accepted.token,
                expected,
                trust,
                Math.floor(Date.now() / 1000),
              );
        value.decision = applied;
        await db.query(
          "UPDATE dms.deployment_control SET binding=$1,decision=$2,marker_digest=$3,quarantined=false,credential_metadata=(coalesce(credential_metadata,'{}'::jsonb)-'pendingSetupRequestId'-'pendingRebind')||$4::jsonb",
          [
            JSON.stringify(expected),
            JSON.stringify(applied),
            marker,
            JSON.stringify(
              value.current
                ? {
                    generation: value.current.generation,
                    epoch: value.current.epoch,
                    operationId: value.current.operationId,
                    report: value.report,
                  }
                : null,
            ),
          ],
        );
        if (freshRebind)
          await db.query(
            'UPDATE dms.deployment_clock_state SET last_time=floor(extract(epoch FROM clock_timestamp())),quarantined=false',
          );
      }
      await db.query(
        "UPDATE dms.deployment_control SET credential_metadata=coalesce(credential_metadata,'{}'::jsonb)||jsonb_build_object('report',$1::jsonb)",
        [JSON.stringify(value.report)],
      );
    });
    if (!this.readOnly) await super.save(value);
  }
}
