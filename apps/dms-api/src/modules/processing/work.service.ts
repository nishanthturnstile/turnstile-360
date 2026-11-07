import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { BeforeApplicationShutdown } from '@nestjs/common';
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import {
  EXTRACTION_FORMATS,
  OCR_FORMATS,
  WORK_LIMITS,
  WORK_ROLE_SCOPE,
  WORK_TASK_ROLE,
  type WorkEnvelope,
  type WorkLease,
  type WorkResult,
  type WorkRole,
  workSchemas,
} from '@thaarei/dms-contracts/private';
import { createPool } from '../../infrastructure/database/postgres.js';
import type { MachinePrincipal } from '../access/access-policy.js';
import { deploymentStatus, requireDeployment } from '../deployment/access.js';
import { lockOriginal } from '../documents/download-policy.js';
import type { StorageService } from '../storage/storage.service.js';
import { hash, lockUsage, measuredStorageBytes } from '../uploads/admission.service.js';
import { withCoordinator } from '../uploads/admission-maintenance.js';
import { readAdmissionPolicy } from '../uploads/admission-policy.js';
import { acceptAssessment } from './assessment-acceptance.js';
import { observeService } from './operations.js';
import { synchronizeProcessingRuns } from './results-state.js';
import { stageSearchIndex } from './search-index.js';
import { WorkConfiguration, WorkError } from './work-configuration.js';
import {
  type CoordinatorTx,
  createDispatch,
  enqueueWork,
  type JobRow,
  jobAudit,
  later,
  lockWorkSource,
  sourceActive,
  WORK_SOURCE_EXPIRY,
  wall,
} from './work-state.js';

const terminal = (state: string) =>
  ['SUCCEEDED', 'FAILED', 'UNSUPPORTED', 'CANCELLED'].includes(state);
const same = (digest: string, token: string) => {
  const actual = Buffer.from(hash(token), 'hex'),
    expected = Buffer.from(digest, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
type AttemptRow = {
  id: string;
  client_id: string;
  lease_hash: string;
  state: string;
  lease_expires_at: Date;
  deadline: Date;
  result_hash: string | null;
  retry_after: number | null;
};
@Injectable()
export class WorkService implements OnApplicationShutdown, BeforeApplicationShutdown {
  readonly pool;
  private draining = false;
  private drain: (() => Promise<void>) | undefined;
  registerDrain(drain: () => Promise<void>) {
    this.drain = drain;
  }
  async beforeApplicationShutdown() {
    this.draining = true;
    await this.drain?.();
  }
  async processingReady() {
    return this.internal(async (tx) => {
      const row = (
        await tx.client.query(
          `SELECT (SELECT count(*)=5 AND bool_and(s.state='ready' AND s.observed_at>clock_timestamp()-interval '90 seconds' AND (s.identity_id IS NULL OR EXISTS(SELECT 1 FROM dms.work_identity i WHERE i.id=s.identity_id AND i.enabled AND i.role=s.component))) FROM dms.service_observation s WHERE s.component<>'backup') AND EXISTS(SELECT 1 FROM dms.service_observation WHERE component='scanner' AND evidence_at>clock_timestamp()-interval '48 hours' AND evidence_at<=clock_timestamp()+interval '1 minute') AND EXISTS(SELECT 1 FROM dms.admission_capacity WHERE observed_at>clock_timestamp()-interval '30 seconds' AND observed_at<=clock_timestamp() AND storage_free_bytes>=52428800 AND scratch_free_bytes>=268435456) AS ready`,
        )
      ).rows[0];
      return row?.ready === true;
    });
  }
  presence(
    principal: MachinePrincipal,
    input: { state: 'ready' | 'degraded' | 'stopping'; signatureTime?: string | undefined },
  ) {
    const role = (Object.keys(WORK_ROLE_SCOPE) as WorkRole[]).find(
      (role) => principal.scopes.length === 1 && principal.scopes[0] === WORK_ROLE_SCOPE[role],
    );
    if (!role) throw new WorkError('WORK_DENIED', 403);
    if (
      input.signatureTime &&
      (role !== 'scanner' || new Date(input.signatureTime).getTime() > Date.now() + 60000)
    )
      throw new WorkError('WORK_INVALID', 400);
    return this.authorized(
      principal,
      role,
      async (tx) => {
        const identity = (
          await tx.client.query(
            'SELECT id FROM dms.work_identity WHERE issuer=$1 AND client_id=$2',
            [principal.issuer, principal.clientId],
          )
        ).rows[0];
        await observeService(tx, role, input.state, identity.id, input.signatureTime ?? null);
        return { accepted: true as const };
      },
      'recovery',
    );
  }

  constructor(private readonly config: WorkConfiguration) {
    this.pool = createPool(config.value.DMS_COORDINATOR_DATABASE_URL, 5);
  }
  internal<T>(work: (tx: CoordinatorTx) => Promise<T>) {
    return withCoordinator(
      this.pool,
      {
        tenantId: this.config.value.INSTALLATION_TENANT_ID,
        customerKey: this.config.value.INSTALLATION_CUSTOMER_KEY,
      },
      async (tx) => {
        const safe = (
          await tx.client.query(
            "SELECT count(*)=20 AND bool_and(relrowsecurity AND relforcerowsecurity AND pg_get_userbyid(relowner)='thaarei_dms_migrator') AS safe FROM pg_class WHERE oid IN ('dms.work_identity'::regclass,'dms.work_job'::regclass,'dms.work_dispatch'::regclass,'dms.work_attempt'::regclass,'dms.security_candidate'::regclass,'dms.binary_restore'::regclass,'dms.lifecycle_restore'::regclass,'dms.security_assessment_history'::regclass,'dms.extraction_stage'::regclass,'dms.processing_run'::regclass,'dms.search_generation'::regclass,'dms.search_chunk'::regclass,'dms.service_observation'::regclass,'dms.recovery_state'::regclass,'dms.backup_catalog'::regclass,'dms.disposal_intent'::regclass,'dms.deployment_control'::regclass,'dms.deployment_clock_state'::regclass,'dms.deployment_usage'::regclass,'dms.deployment_usage_event'::regclass)",
          )
        ).rows[0]?.safe;
        if (!safe) throw new WorkError('WORK_UNAVAILABLE', 503);
        return work(tx);
      },
    );
  }
  private authorized<T>(
    principal: MachinePrincipal,
    role: WorkRole,
    work: (tx: CoordinatorTx) => Promise<T>,
    deployment: 'completion' | 'recovery' = 'completion',
  ) {
    return this.internal(async (tx) => {
      await tx.client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [
        `work-identity:${tx.context.tenantId}:${principal.clientId}`,
      ]);
      const identity = (
        await tx.client.query(
          'SELECT role,enabled FROM dms.work_identity WHERE issuer=$1 AND client_id=$2',
          [principal.issuer, principal.clientId],
        )
      ).rows[0];
      if (
        !identity?.enabled ||
        identity.role !== role ||
        principal.scopes.length !== 1 ||
        principal.scopes[0] !== WORK_ROLE_SCOPE[role]
      )
        throw new WorkError('WORK_DENIED', 403);
      await requireDeployment(tx.client, deployment);
      return work(tx);
    });
  }
  claimDispatches(principal: MachinePrincipal) {
    if (this.draining) throw new WorkError('WORK_UNAVAILABLE', 503);
    return this.authorized(principal, 'publisher', async (tx) => {
      await requireDeployment(tx.client, 'full');
      const candidates = (
        await tx.client.query(
          `SELECT d.id,d.job_id FROM dms.work_dispatch d
          JOIN dms.work_job j ON j.tenant_id=d.tenant_id AND j.id=d.job_id AND j.generation=d.generation
          WHERE j.state IN ('QUEUED','RUNNING','RETRY_WAIT')
          AND ((d.state='READY' AND d.next_publish_at<=clock_timestamp()) OR (d.state='LEASED' AND d.delivery_until<=clock_timestamp()))
          ORDER BY row_number() OVER(PARTITION BY j.application_id ORDER BY d.next_publish_at,d.id),d.next_publish_at,d.id LIMIT 40`,
        )
      ).rows;
      const items = [];
      for (const candidate of candidates) {
        const job = (
          await tx.client.query<JobRow>(
            'SELECT * FROM dms.work_job WHERE id=$1 FOR UPDATE SKIP LOCKED',
            [candidate.job_id],
          )
        ).rows[0];
        if (!job || terminal(job.state)) continue;
        const row = (
          await tx.client.query('SELECT * FROM dms.work_dispatch WHERE id=$1 FOR UPDATE', [
            candidate.id,
          ])
        ).rows[0];
        const now = await wall(tx.client);
        if (
          !row ||
          row.generation !== job.generation ||
          !(
            (row.state === 'READY' && row.next_publish_at <= now) ||
            (row.state === 'LEASED' && row.delivery_until <= now)
          )
        )
          continue;
        const token = randomBytes(32).toString('base64url');
        await tx.client.query(
          "UPDATE dms.work_dispatch SET state='LEASED',delivery_hash=$1,delivery_client=$2,delivery_until=$3 WHERE id=$4",
          [hash(token), principal.clientId, later(now, WORK_LIMITS.dispatchLeaseSeconds), row.id],
        );
        items.push({
          dispatch: {
            version: 1,
            jobId: job.id,
            dispatchId: row.id,
            generation: job.generation,
            task: job.task,
          },
          deliveryToken: token,
        });
        if (items.length === WORK_LIMITS.batch) break;
      }
      return { items };
    });
  }
  delivery(
    principal: MachinePrincipal,
    input: {
      dispatchId: string;
      deliveryToken: string;
      code?: 'UNROUTABLE' | 'BROKER_UNAVAILABLE';
    },
  ) {
    return this.authorized(principal, 'publisher', async (tx) => {
      const found = (
        await tx.client.query('SELECT job_id FROM dms.work_dispatch WHERE id=$1', [
          input.dispatchId,
        ])
      ).rows[0];
      if (!found) throw new WorkError('WORK_STALE');
      const job = (
        await tx.client.query<JobRow>('SELECT * FROM dms.work_job WHERE id=$1 FOR UPDATE', [
          found.job_id,
        ])
      ).rows[0];
      const row = (
          await tx.client.query('SELECT * FROM dms.work_dispatch WHERE id=$1 FOR UPDATE', [
            input.dispatchId,
          ])
        ).rows[0],
        now = await wall(tx.client);
      if (
        !job ||
        !row ||
        job.generation !== row.generation ||
        row.delivery_client !== principal.clientId ||
        !row.delivery_hash ||
        !same(row.delivery_hash, input.deliveryToken)
      )
        throw new WorkError('WORK_STALE');
      if (row.state === 'DELIVERED' && !input.code) return { accepted: true as const };
      if (row.state !== 'LEASED' || row.delivery_until <= now) throw new WorkError('WORK_STALE');
      if (input.code)
        await tx.client.query(
          "UPDATE dms.work_dispatch SET state='READY',failures=least(failures+1,2147483647),last_error=$1,next_publish_at=$2,delivery_hash=NULL,delivery_client=NULL,delivery_until=NULL WHERE id=$3",
          [input.code, later(now, 10), row.id],
        );
      else {
        await tx.client.query(
          "UPDATE dms.work_dispatch SET state='DELIVERED',published_at=coalesce(published_at,$1),delivery_until=NULL,last_error=NULL WHERE id=$2",
          [now, row.id],
        );
        if (job.state === 'QUEUED' && job.executions === 0)
          await tx.client.query('UPDATE dms.work_job SET recover_at=$1 WHERE id=$2', [
            later(now, WORK_LIMITS.deliverySeconds),
            job.id,
          ]);
      }
      return { accepted: true as const };
    });
  }
  private async job(tx: CoordinatorTx, envelope: WorkEnvelope, allowTerminal = false) {
    const found = (
      await tx.client.query<JobRow>('SELECT * FROM dms.work_job WHERE id=$1', [envelope.jobId])
    ).rows[0];
    if (!found) throw new WorkError('WORK_STALE');
    const source = await lockWorkSource(tx, found.upload_id);
    const job = (
      await tx.client.query<JobRow>('SELECT * FROM dms.work_job WHERE id=$1 FOR UPDATE', [found.id])
    ).rows[0];
    const dispatch = (
      await tx.client.query(
        'SELECT id FROM dms.work_dispatch WHERE id=$1 AND job_id=$2 AND generation=$3 AND task=$4',
        [envelope.dispatchId, envelope.jobId, envelope.generation, envelope.task],
      )
    ).rows[0];
    const now = await wall(tx.client);
    if (
      !job ||
      !dispatch ||
      job.generation !== envelope.generation ||
      job.task !== envelope.task ||
      job.lifecycle_generation !== source.document_generation ||
      source.lifecycle_generation !== source.document_generation ||
      !(
        sourceActive(source, now, job.task) ||
        (allowTerminal &&
          terminal(job.state) &&
          source.application_status === 'active' &&
          source.lifecycle === 'ACTIVE')
      )
    )
      throw new WorkError('WORK_STALE');
    return { job, source, now };
  }
  claim(principal: MachinePrincipal, envelope: WorkEnvelope) {
    if (this.draining) throw new WorkError('WORK_UNAVAILABLE', 503);
    return this.authorized(principal, WORK_TASK_ROLE[envelope.task], async (tx) => {
      await requireDeployment(tx.client, 'full');
      const { job, now } = await this.job(tx, envelope);
      if (terminal(job.state)) return { state: 'terminal' };
      if (job.state === 'RUNNING') return { state: 'busy' };
      if (job.state === 'RETRY_WAIT' && job.next_eligible_at && job.next_eligible_at > now)
        return {
          state: 'wait',
          retryAfterSeconds: Math.min(
            60,
            Math.max(1, Math.ceil((job.next_eligible_at.getTime() - now.getTime()) / 1000)),
          ),
        };
      if (job.executions >= WORK_LIMITS.executions || (job.deadline && job.deadline <= now)) {
        await tx.client.query(
          "UPDATE dms.work_job SET state='FAILED',result_code='EXECUTION_BUDGET_EXHAUSTED',updated_at=$1 WHERE id=$2",
          [now, job.id],
        );
        await jobAudit(tx, job, 'work.completed');
        return { state: 'terminal' };
      }
      const deadline = job.deadline ?? later(now, WORK_LIMITS.executionSeconds),
        attemptDeadline = new Date(
          Math.min(deadline.getTime(), later(now, WORK_LIMITS.attemptSeconds).getTime()),
        ),
        leaseEnd = new Date(
          Math.min(attemptDeadline.getTime(), later(now, WORK_LIMITS.leaseSeconds).getTime()),
        );
      const id = randomUUID(),
        token = randomBytes(32).toString('base64url');
      await tx.client.query(
        'INSERT INTO dms.work_attempt (id,tenant_id,job_id,dispatch_id,generation,execution,client_id,lease_hash,lease_expires_at,deadline,started_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [
          id,
          tx.context.tenantId,
          job.id,
          envelope.dispatchId,
          job.generation,
          job.executions + 1,
          principal.clientId,
          hash(token),
          leaseEnd,
          attemptDeadline,
          now,
        ],
      );
      await tx.client.query(
        "UPDATE dms.work_job SET state='RUNNING',executions=executions+1,current_attempt_id=$1,budget_started_at=coalesce(budget_started_at,$2),deadline=$3,recover_at=$4,next_eligible_at=NULL,updated_at=$2 WHERE id=$5",
        [id, now, deadline, later(leaseEnd, WORK_LIMITS.recoveryGraceSeconds), job.id],
      );
      if (job.processing_run_id)
        await tx.client.query(
          "UPDATE dms.processing_run SET state='RUNNING' WHERE id=$1 AND state='QUEUED'",
          [job.processing_run_id],
        );
      return {
        state: 'claimed',
        lease: { ...envelope, attemptId: id, leaseToken: token },
        leaseExpiresAt: leaseEnd.toISOString(),
        attemptDeadline: attemptDeadline.toISOString(),
        remainingExecutions: 2 - job.executions,
      };
    });
  }
  private async attempt(
    tx: CoordinatorTx,
    principal: MachinePrincipal,
    input: WorkLease,
    job: JobRow,
  ) {
    const attempt = (
      await tx.client.query<AttemptRow>(
        'SELECT * FROM dms.work_attempt WHERE id=$1 AND job_id=$2 AND dispatch_id=$3 AND generation=$4 FOR UPDATE',
        [input.attemptId, job.id, input.dispatchId, input.generation],
      )
    ).rows[0];
    if (
      !attempt ||
      attempt.client_id !== principal.clientId ||
      !same(attempt.lease_hash, input.leaseToken) ||
      job.current_attempt_id !== attempt.id
    )
      throw new WorkError('WORK_STALE');
    return attempt;
  }
  heartbeat(principal: MachinePrincipal, input: WorkLease) {
    return this.authorized(principal, WORK_TASK_ROLE[input.task], async (tx) => {
      const { job } = await this.job(tx, input),
        attempt = await this.attempt(tx, principal, input, job),
        now = await wall(tx.client);
      if (
        job.state !== 'RUNNING' ||
        attempt.state !== 'RUNNING' ||
        attempt.lease_expires_at <= now ||
        attempt.deadline <= now
      )
        throw new WorkError('WORK_STALE');
      const end = new Date(
        Math.min(attempt.deadline.getTime(), later(now, WORK_LIMITS.leaseSeconds).getTime()),
      );
      await tx.client.query('UPDATE dms.work_attempt SET lease_expires_at=$1 WHERE id=$2', [
        end,
        attempt.id,
      ]);
      await tx.client.query('UPDATE dms.work_job SET recover_at=$1,updated_at=$2 WHERE id=$3', [
        later(end, WORK_LIMITS.recoveryGraceSeconds),
        now,
        job.id,
      ]);
      return { leaseExpiresAt: end.toISOString() };
    });
  }
  candidate(principal: MachinePrincipal, input: WorkLease, storage: StorageService) {
    if (input.task !== 'document.scan') throw new WorkError('WORK_DENIED', 403);
    return this.authorized(principal, 'scanner', async (tx) => {
      const { job, source } = await this.job(tx, input),
        attempt = await this.attempt(tx, principal, input, job),
        now = await wall(tx.client);
      if (
        job.state !== 'RUNNING' ||
        attempt.state !== 'RUNNING' ||
        attempt.lease_expires_at <= now ||
        attempt.deadline <= now
      )
        throw new WorkError('WORK_STALE');
      const c = (
        await tx.client.query(
          "SELECT * FROM dms.security_candidate WHERE upload_id=$1 AND state='PENDING'",
          [job.upload_id],
        )
      ).rows[0];
      if (!c) throw new WorkError('WORK_STALE');
      const transfer = await storage.forRole('originalRead').downloadInternal({
        area: 'originals',
        tenantId: tx.context.tenantId,
        applicationId: source.application_id,
        id: c.object_id,
      });
      return {
        candidateId: c.id,
        url: transfer.url,
        size: Number(c.size),
        contentType: source.descriptor.contentType,
        sha256: c.expected_sha256 ?? source.descriptor.sha256 ?? null,
      };
    });
  }
  extractionInput(principal: MachinePrincipal, input: WorkLease, storage: StorageService) {
    return this.authorized(principal, WORK_TASK_ROLE[input.task], async (tx) => {
      const { job, source, attempt } = await this.extractionLease(tx, principal, input);
      const candidate = (
        await tx.client.query(
          "SELECT * FROM dms.security_candidate WHERE upload_id=$1 AND state='PASSED'",
          [job.upload_id],
        )
      ).rows[0];
      if (!candidate) throw new WorkError('WORK_STALE');
      const transfer = await storage.forRole('originalRead').downloadInternal({
        area: 'originals',
        tenantId: tx.context.tenantId,
        applicationId: source.application_id,
        id: candidate.object_id,
      });
      return {
        request: {
          schemaVersion: 1,
          documentId: source.document_id,
          versionId: source.version_id,
          runId: job.processing_run_id ?? job.id,
          generation: job.generation,
          lifecycleGeneration: job.lifecycle_generation,
          sourceSha256: candidate.sha256,
          contentType: source.descriptor.contentType,
          profile: source.processing_profile ?? source.descriptor.profile,
          stage:
            source.processing_profile === 'structured'
              ? 'structure'
              : input.task === 'document.heavy'
                ? 'ocr'
                : 'native',
        },
        deadline: attempt.deadline.toISOString(),
        url: transfer.url,
        size: Number(candidate.size),
      };
    });
  }
  private async extractionLease(tx: CoordinatorTx, principal: MachinePrincipal, input: WorkLease) {
    if (!['document.extract', 'document.heavy'].includes(input.task))
      throw new WorkError('WORK_DENIED', 403);
    const { job, source, now } = await this.job(tx, input);
    const attempt = await this.attempt(tx, principal, input, job);
    if (job.processing_run_id) {
      const run = (
        await tx.client.query('SELECT profile FROM dms.processing_run WHERE id=$1', [
          job.processing_run_id,
        ])
      ).rows[0];
      source.processing_profile = run?.profile;
    }
    await lockOriginal(tx.client, tx.context.tenantId, source.document_id);
    if (
      job.state !== 'RUNNING' ||
      attempt.state !== 'RUNNING' ||
      attempt.lease_expires_at <= now ||
      attempt.deadline <= now ||
      !['searchable', 'structured'].includes(source.processing_profile ?? source.descriptor.profile)
    )
      throw new WorkError('WORK_STALE');
    if (
      (input.task === 'document.heavy' && !OCR_FORMATS.includes(source.descriptor.contentType)) ||
      (input.task === 'document.extract' && source.descriptor.contentType.startsWith('image/'))
    )
      throw new WorkError('WORK_DENIED', 403);
    const candidate = (
      await tx.client.query(
        "SELECT id FROM dms.security_candidate WHERE upload_id=$1 AND state='PASSED'",
        [job.upload_id],
      )
    ).rows[0];
    if (!candidate) throw new WorkError('WORK_STALE');
    return { job, source, attempt, now };
  }
  extractionOutput(
    principal: MachinePrincipal,
    input: WorkLease & { size: number; sha256: string },
    storage: StorageService,
  ) {
    return this.authorized(principal, WORK_TASK_ROLE[input.task], async (tx) => {
      const found = (
        await tx.client.query('SELECT application_id FROM dms.work_job WHERE id=$1', [input.jobId])
      ).rows[0];
      if (!found) throw new WorkError('WORK_STALE');
      await tx.client.query('SELECT id FROM dms.application_registration WHERE id=$1 FOR SHARE', [
        found.application_id,
      ]);
      const usage = await lockUsage(tx.client, tx.context.tenantId, found.application_id);
      const { job, source, attempt, now } = await this.extractionLease(tx, principal, input);
      let row = (
        await tx.client.query('SELECT * FROM dms.extraction_stage WHERE attempt_id=$1', [
          attempt.id,
        ])
      ).rows[0];
      if (row && (Number(row.size) !== input.size || row.sha256 !== input.sha256))
        throw new WorkError('WORK_CONFLICT');
      if (!row) {
        if (job.processing_run_id) {
          const used = Number(
            (
              await tx.client.query(
                'SELECT coalesce(sum(e.size),0) AS bytes FROM dms.extraction_stage e JOIN dms.work_job j ON j.id=e.job_id WHERE j.processing_run_id=$1',
                [job.processing_run_id],
              )
            ).rows[0].bytes,
          );
          if (used + input.size > 26214400) throw new WorkError('WORK_INVALID', 400);
        }
        const policy = await readAdmissionPolicy(tx.client, true),
          limits = policy?.settings;
        const capacity = (await tx.client.query('SELECT * FROM dms.admission_capacity')).rows[0];
        if (
          !limits?.enabled ||
          !limits.profiles.includes(source.processing_profile ?? source.descriptor.profile) ||
          !limits.contentTypes.includes(source.descriptor.contentType) ||
          !capacity ||
          new Date(capacity.observed_at).getTime() < now.getTime() - 30000 ||
          Number(usage.tenant.reserved_storage) + measuredStorageBytes(usage.tenant) + input.size >
            limits.storageBudgetBytes ||
          Number(usage.app.reserved_storage) + measuredStorageBytes(usage.app) + input.size >
            limits.applicationBudgetBytes ||
          Number(usage.tenant.reserved_storage) +
            Math.max(0, measuredStorageBytes(usage.tenant) - Number(capacity.used_at_observation)) +
            input.size +
            (capacity.shared_device ? Number(usage.tenant.reserved_scratch) : 0) >
            Number(capacity.storage_free_bytes)
        )
          throw new WorkError('WORK_UNAVAILABLE', 503);
        row = (
          await tx.client.query(
            'INSERT INTO dms.extraction_stage (id,tenant_id,job_id,attempt_id,generation,object_id,size,sha256,capability_expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
            [
              randomUUID(),
              tx.context.tenantId,
              job.id,
              attempt.id,
              job.generation,
              randomUUID(),
              input.size,
              input.sha256,
              new Date(Math.min(attempt.deadline.getTime(), now.getTime() + 120000)),
            ],
          )
        ).rows[0];
        await tx.client.query(
          'UPDATE dms.admission_tenant_usage SET reserved_storage=reserved_storage+$1',
          [input.size],
        );
        await tx.client.query(
          'UPDATE dms.admission_application_usage SET reserved_storage=reserved_storage+$1 WHERE application_id=$2',
          [input.size, source.application_id],
        );
      }
      if (row.capability_expires_at <= now) throw new WorkError('WORK_STALE');
      const transfer = await storage.forRole('artifactWrite').upload(
        {
          area: 'artifacts',
          tenantId: tx.context.tenantId,
          applicationId: source.application_id,
          id: row.object_id,
        },
        Number(row.size),
        'application/json',
        120,
        row.capability_expires_at,
        true,
      );
      return {
        artifactId: row.id,
        url: transfer.url,
        size: Number(row.size),
        headers: transfer.headers,
      };
    });
  }
  async result(principal: MachinePrincipal, input: WorkResult, storage?: StorageService) {
    let indexedUnits: Parameters<typeof stageSearchIndex>[3] | undefined;
    const output = input.outcome === 'SUCCEEDED' ? input.extraction : undefined;
    if (output) {
      if (!['document.extract', 'document.heavy'].includes(input.task) || !storage)
        throw new WorkError('WORK_DENIED', 403);
      const capture = await this.authorized(principal, WORK_TASK_ROLE[input.task], async (tx) => {
        const { job, source } = await this.job(tx, input, true);
        await this.attempt(tx, principal, input, job);
        const row = (
          await tx.client.query(
            'SELECT * FROM dms.extraction_stage WHERE id=$1 AND attempt_id=$2',
            [output.artifactId, input.attemptId],
          )
        ).rows[0];
        if (!row) throw new WorkError('WORK_STALE');
        return {
          row,
          reference: {
            area: 'artifacts' as const,
            tenantId: tx.context.tenantId,
            applicationId: source.application_id as string,
            id: row.object_id as string,
          },
        };
      });
      if (capture.row.state !== 'ACCEPTED') {
        const head = await storage.forRole('artifactRead').head(capture.reference);
        const artifact = workSchemas.ExtractionArtifact.safeParse(
          await storage
            .forRole('artifactRead')
            .verifyOriginal(
              capture.reference,
              { size: Number(capture.row.size), etag: head.etag, sha256: capture.row.sha256 },
              true,
            ),
        );
        if (!artifact.success) throw new WorkError('WORK_INVALID', 400);
        indexedUnits = artifact.data.units;
        const data = artifact.data,
          units = data.units;
        if (
          JSON.stringify(data.manifest) !==
            JSON.stringify(workSchemas.ExtractionManifest.parse(output.manifest)) ||
          data.manifest.coverage.attempted !== units.length ||
          data.manifest.coverage.completed !==
            units.filter((u) => u.state === 'TEXT' || u.state === 'EMPTY').length ||
          data.manifest.coverage.omitted !== units.filter((u) => u.state === 'OMITTED').length ||
          data.manifest.coverage.ocrNeeded !==
            units.filter((u) => u.warnings.includes('OCR_REQUIRED')).length ||
          new Set(units.map((u) => u.id)).size !== units.length ||
          Object.keys(data.metadata).length > 64 ||
          units.some(
            (unit) =>
              Buffer.byteLength(unit.text, 'utf8') > 32768 ||
              (unit.source.formula !== undefined &&
                unit.source.formula !== null &&
                Buffer.byteLength(unit.source.formula, 'utf8') > 32768) ||
              (unit.ocr !== undefined &&
                (unit.ocr.width * unit.ocr.height > 25000000 ||
                  unit.ocr.words.some(
                    (word) =>
                      word.box.x + word.box.width > (unit.ocr?.width ?? 0) ||
                      word.box.y + word.box.height > (unit.ocr?.height ?? 0),
                  ))),
          ) ||
          (data.manifest.status === 'SUCCEEDED' &&
            data.manifest.coverage.completed !== units.length) ||
          (['SUCCEEDED', 'PARTIAL'].includes(data.manifest.status)
            ? data.manifest.code !== 'OK'
            : ['OK', 'SECURE_ONLY'].includes(data.manifest.code)) ||
          (data.manifest.profile === 'structured' && data.manifest.processor !== 'none'
            ? !data.structure
            : data.structure !== undefined) ||
          (data.structure !== undefined &&
            (new Set(data.structure.pages.map((p) => p.index)).size !==
              data.structure.pages.length ||
              data.structure.pages.some(
                (p) =>
                  !units.some((u) => u.kind === 'page' && u.source.index === p.index) ||
                  p.elements.some(
                    (e) =>
                      (e.box !== null && (e.box.left > e.box.right || e.box.top > e.box.bottom)) ||
                      e.table?.cells.some(
                        (c) =>
                          c.row + c.rowSpan > (e.table?.rows ?? 0) ||
                          c.column + c.columnSpan > (e.table?.columns ?? 0),
                      ),
                  ),
              ))) ||
          data.manifest.status === 'OMITTED'
        )
          throw new WorkError('WORK_INVALID', 400);
      }
    }

    return this.authorized(principal, WORK_TASK_ROLE[input.task], async (tx) => {
      if (output) {
        const owner = (
          await tx.client.query('SELECT application_id FROM dms.work_job WHERE id=$1', [
            input.jobId,
          ])
        ).rows[0];
        if (!owner) throw new WorkError('WORK_STALE');
        await tx.client.query('SELECT id FROM dms.application_registration WHERE id=$1 FOR SHARE', [
          owner.application_id,
        ]);
        await lockUsage(tx.client, tx.context.tenantId, owner.application_id);
      }
      const { job, source } = await this.job(tx, input, true),
        attempt = await this.attempt(tx, principal, input, job),
        now = await wall(tx.client),
        evidence = input.outcome === 'SUCCEEDED' ? input.assessment : undefined,
        resultHash = hash(JSON.stringify([input.outcome, input.code, evidence, output]));
      if (evidence && input.task !== 'document.scan') throw new WorkError('WORK_DENIED', 403);
      if (attempt.state !== 'RUNNING') {
        if (attempt.result_hash === resultHash)
          return {
            accepted: true as const,
            duplicate: true,
            retryAfterSeconds: attempt.retry_after,
          };
        throw new WorkError('WORK_CONFLICT');
      }
      if (job.state !== 'RUNNING' || attempt.lease_expires_at <= now || attempt.deadline <= now)
        throw new WorkError('WORK_STALE');
      const candidate = (
        await tx.client.query('SELECT id FROM dms.security_candidate WHERE upload_id=$1', [
          job.upload_id,
        ])
      ).rows[0];
      if (candidate && input.task === 'document.scan' && input.outcome === 'SUCCEEDED' && !evidence)
        throw new WorkError('WORK_INVALID', 400);
      if (
        ['document.extract', 'document.heavy'].includes(input.task) &&
        input.outcome === 'SUCCEEDED' &&
        !output
      )
        throw new WorkError('WORK_INVALID', 400);
      if (output) {
        await lockOriginal(tx.client, tx.context.tenantId, source.document_id);
        const manifest = workSchemas.ExtractionManifest.parse(output.manifest);
        const candidate = (
          await tx.client.query(
            "SELECT sha256 FROM dms.security_candidate WHERE upload_id=$1 AND state='PASSED'",
            [job.upload_id],
          )
        ).rows[0];
        if (
          !candidate ||
          manifest.documentId !== source.document_id ||
          manifest.versionId !== source.version_id ||
          manifest.runId !== (job.processing_run_id ?? job.id) ||
          manifest.generation !== job.generation ||
          manifest.lifecycleGeneration !== job.lifecycle_generation ||
          manifest.sourceSha256 !== candidate.sha256 ||
          manifest.profile !==
            (job.processing_run_id
              ? (
                  await tx.client.query('SELECT profile FROM dms.processing_run WHERE id=$1', [
                    job.processing_run_id,
                  ])
                ).rows[0]?.profile
              : 'searchable') ||
          manifest.contentType !== source.descriptor.contentType ||
          (manifest.stage ?? 'native') !==
            (manifest.profile === 'structured'
              ? 'structure'
              : input.task === 'document.heavy'
                ? 'ocr'
                : 'native') ||
          (input.task === 'document.heavy' &&
            manifest.profile !== 'structured' &&
            !(manifest.status === 'FAILED' && manifest.processor === 'none') &&
            (!manifest.ocr ||
              manifest.configurationVersion !== 'english-ocr-v1' ||
              JSON.stringify(manifest.languages) !== JSON.stringify(['en']))) ||
          (manifest.profile === 'structured' &&
            !(manifest.status === 'FAILED' && manifest.processor === 'none') &&
            (!manifest.structure ||
              manifest.processorVersion !== '2.146.0' ||
              JSON.stringify(manifest.languages) !== JSON.stringify(['en']) ||
              manifest.configurationVersion !== 'docling-layout-v1' ||
              !manifest.ocr)) ||
          (input.task === 'document.extract' &&
            (manifest.ocr !== undefined ||
              manifest.configurationVersion !== 'native-extraction-v1')) ||
          (manifest.processor !==
            (manifest.profile === 'structured'
              ? 'docling'
              : input.task === 'document.heavy' && manifest.contentType === 'application/pdf'
                ? 'pdfium-tesseract'
                : EXTRACTION_FORMATS[manifest.contentType as keyof typeof EXTRACTION_FORMATS]) &&
            !(manifest.status === 'FAILED' && manifest.processor === 'none')) ||
          manifest.coverage.completed > manifest.coverage.attempted ||
          manifest.coverage.omitted > manifest.coverage.attempted ||
          new Date(manifest.completedAt) > now ||
          new Date(manifest.completedAt).getTime() < now.getTime() - 600000
        )
          throw new WorkError('WORK_INVALID', 400);
        const accepted = await tx.client.query(
          "UPDATE dms.extraction_stage SET state='ACCEPTED',manifest=$1 WHERE id=$2 AND attempt_id=$3 AND generation=$4 AND state='ISSUED' RETURNING size",
          [manifest, output.artifactId, input.attemptId, job.generation],
        );
        if (accepted.rowCount !== 1) throw new WorkError('WORK_CONFLICT');
        if (!indexedUnits) throw new WorkError('WORK_INVALID', 400);
        await stageSearchIndex(
          tx,
          job.processing_run_id,
          output.artifactId,
          indexedUnits,
          manifest.status === 'PARTIAL',
        );
        if (
          input.task === 'document.extract' &&
          manifest.contentType === 'application/pdf' &&
          manifest.coverage.ocrNeeded > 0 &&
          manifest.status === 'PARTIAL'
        )
          await enqueueWork(tx, job.upload_id, 'document.heavy', job.processing_run_id, true);
        const size = Number(accepted.rows[0].size);
        await tx.client.query(
          'UPDATE dms.admission_tenant_usage SET reserved_storage=reserved_storage-$1,artifact_bytes=artifact_bytes+$1',
          [size],
        );
        await tx.client.query(
          'UPDATE dms.admission_application_usage SET reserved_storage=reserved_storage-$1,artifact_bytes=artifact_bytes+$1 WHERE application_id=$2',
          [size, source.application_id],
        );
      }
      if (evidence) await acceptAssessment(tx, job.upload_id, evidence);
      const retry =
        input.outcome === 'RETRY' &&
        job.executions < WORK_LIMITS.executions &&
        job.deadline &&
        later(now, 8) < job.deadline;
      const delay = retry ? Math.min(30, 2 ** job.executions * 2 + randomInt(0, 3)) : null;
      const state = input.outcome === 'RETRY' ? (retry ? 'RETRY' : 'FAILED') : input.outcome;
      await tx.client.query(
        'UPDATE dms.work_attempt SET state=$1,result_hash=$2,result_code=$3,retry_after=$4,finished_at=$5 WHERE id=$6',
        [state, resultHash, input.code, delay, now, attempt.id],
      );
      await tx.client.query(
        'UPDATE dms.work_job SET state=$1,result_code=$2,next_eligible_at=$3,recover_at=$4,updated_at=$5 WHERE id=$6',
        [
          retry ? 'RETRY_WAIT' : state,
          input.outcome === 'RETRY' && !retry ? 'EXECUTION_BUDGET_EXHAUSTED' : input.code,
          delay ? later(now, delay) : null,
          delay ? later(now, delay + WORK_LIMITS.retryRecoveryGraceSeconds) : null,
          now,
          job.id,
        ],
      );
      await jobAudit(tx, job, 'work.completed');
      await synchronizeProcessingRuns(tx, job.upload_id);
      return { accepted: true as const, duplicate: false, retryAfterSeconds: delay };
    });
  }
  async recover() {
    const candidates = await this.internal(async (tx) => {
      return (
        await tx.client.query(
          `SELECT j.id FROM dms.work_job j JOIN dms.upload_session s ON s.id=j.upload_id JOIN dms.application_registration r ON r.id=j.application_id JOIN dms.upload_admission a ON a.id=j.upload_id WHERE j.state IN ('QUEUED','RUNNING','RETRY_WAIT') AND (j.recover_at<=clock_timestamp() OR r.status<>'active' OR ${WORK_SOURCE_EXPIRY}<=clock_timestamp() OR a.state='RELEASED' OR a.work_released OR s.upload_state IN ('CANCELLED','EXPIRED','FAILED')) ORDER BY j.recover_at NULLS LAST,j.id LIMIT 20`,
        )
      ).rows;
    });
    let recovered = 0;
    for (const candidate of candidates) {
      const changed = await this.internal(async (tx) => {
        const first = (
          await tx.client.query<JobRow>('SELECT * FROM dms.work_job WHERE id=$1', [candidate.id])
        ).rows[0];
        if (!first) return false;
        const source = await lockWorkSource(tx, first.upload_id);
        const job = (
            await tx.client.query<JobRow>('SELECT * FROM dms.work_job WHERE id=$1 FOR UPDATE', [
              first.id,
            ])
          ).rows[0],
          now = await wall(tx.client);
        if (!job || terminal(job.state)) return false;
        const active = sourceActive(source, now, job.task);
        if (active && (await deploymentStatus(tx.client)).access !== 'full') return false;
        if (active && (!job.recover_at || job.recover_at > now)) return false;
        if (
          active &&
          job.state === 'QUEUED' &&
          job.executions === 0 &&
          !(
            await tx.client.query('SELECT 1 FROM dms.work_dispatch WHERE job_id=$1 LIMIT 1', [
              job.id,
            ])
          ).rowCount
        ) {
          await createDispatch(tx, job);
          await tx.client.query('UPDATE dms.work_job SET recover_at=NULL WHERE id=$1', [job.id]);
          return true;
        }

        if (active && job.state === 'RUNNING' && job.current_attempt_id) {
          const lease = (
            await tx.client.query<AttemptRow>(
              'SELECT * FROM dms.work_attempt WHERE id=$1 FOR UPDATE',
              [job.current_attempt_id],
            )
          ).rows[0];
          if (
            lease?.state === 'RUNNING' &&
            later(lease.lease_expires_at, WORK_LIMITS.recoveryGraceSeconds) > now
          )
            return false;
        }
        if (
          active &&
          job.state === 'RETRY_WAIT' &&
          job.next_eligible_at &&
          later(job.next_eligible_at, WORK_LIMITS.retryRecoveryGraceSeconds) > now
        )
          return false;
        await tx.client.query(
          "UPDATE dms.work_attempt SET state=$1,finished_at=$2 WHERE job_id=$3 AND state='RUNNING'",
          [active ? 'LOST' : 'CANCELLED', now, job.id],
        );
        await tx.client.query(
          "UPDATE dms.work_dispatch SET state='OBSOLETE',delivery_hash=NULL,delivery_until=NULL WHERE job_id=$1 AND generation=$2",
          [job.id, job.generation],
        );
        const exhausted =
          job.executions >= WORK_LIMITS.executions ||
          job.recoveries >= WORK_LIMITS.recoveries ||
          (job.deadline && job.deadline <= now);
        if (!active || exhausted) {
          await tx.client.query(
            'UPDATE dms.work_job SET state=$1,result_code=$2,recover_at=NULL,updated_at=$3 WHERE id=$4',
            [
              active ? 'FAILED' : 'CANCELLED',
              active ? 'EXECUTION_BUDGET_EXHAUSTED' : 'SOURCE_UNAVAILABLE',
              now,
              job.id,
            ],
          );
          await jobAudit(tx, job, active ? 'work.completed' : 'work.cancelled');
        } else {
          await tx.client.query(
            "UPDATE dms.work_job SET state='QUEUED',generation=generation+1,recoveries=recoveries+1,current_attempt_id=NULL,next_eligible_at=NULL,recover_at=NULL,updated_at=$1 WHERE id=$2",
            [now, job.id],
          );
          await createDispatch(tx, { ...job, generation: job.generation + 1 });
          await jobAudit(tx, job, 'work.recovered');
        }
        await synchronizeProcessingRuns(tx, job.upload_id);
        return true;
      });
      if (changed) recovered++;
    }
    return { recovered };
  }
  async onApplicationShutdown() {
    await this.pool.end();
  }
}
