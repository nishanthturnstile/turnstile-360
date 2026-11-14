import { randomUUID } from 'node:crypto';
import {
  type BeforeApplicationShutdown,
  HttpException,
  Injectable,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import {
  type ImportJobDto,
  type ImportRowDto,
  invitationIssueCommandSchema,
  PEOPLE_IMPORT_LIMITS,
} from '@thaarei/turnstile-contracts';
import type { PoolClient } from 'pg';
import { IdentityClientService } from '../../integrations/identity/identity-client.service.js';
import { readAccess } from '../access/access-evaluator.js';
import { featureWritesOpen } from '../access/release-state.js';
import { deploymentStatus } from '../deployment/access.js';
import { AdministrationService } from './administration.service.js';
import {
  BulkImportService,
  type ImportRecord,
  type ImportRowRecord,
  importConflict,
} from './bulk-import.service.js';
import { InvitationService } from './invitation.service.js';

type Claim = { job: ImportRecord; row: ImportRowRecord; lease: string };
@Injectable()
export class BulkImportWorkerService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<unknown> | undefined;
  private stopping = false;
  readonly metrics = { processed: 0, unavailable: 0 };
  constructor(
    private readonly jobs: BulkImportService,
    private readonly invitations: InvitationService,
    private readonly reader: AdministrationService,
    private readonly identity: IdentityClientService,
  ) {}
  onApplicationBootstrap() {
    if (!this.jobs.invitations.config) return;
    this.timer = setInterval(() => {
      if (this.stopping || this.running) return;
      this.running = this.drain()
        .catch(() => {
          this.metrics.unavailable++;
        })
        .finally(() => {
          this.running = undefined;
        });
    }, 5000);
    this.timer.unref();
  }
  async beforeApplicationShutdown() {
    this.stopping = true;
    clearInterval(this.timer);
    await this.running;
  }
  async claim(): Promise<Claim | undefined> {
    return this.jobs.invitations.run(async (db, tenant) => {
      if ((await deploymentStatus(db)).access !== 'full' || !(await featureWritesOpen(db, tenant)))
        return;
      await db.query(
        `DELETE FROM turnstile.people_import_job WHERE tenant_id=$1 AND id IN
        (SELECT id FROM turnstile.people_import_job WHERE tenant_id=$1 AND created_at<statement_timestamp()-interval '90 days' ORDER BY created_at LIMIT 5)`,
        [tenant],
      );
      // Expired draft reviews cannot silently become accepted background jobs.
      await db.query(
        `UPDATE turnstile.people_import_row r SET state='cancelled',reason='cancelled' FROM turnstile.people_import_job j WHERE j.tenant_id=$1 AND r.tenant_id=j.tenant_id AND r.job_id=j.id AND j.state='draft' AND j.review_expires_at<=statement_timestamp() AND r.state='pending'`,
        [tenant],
      );
      await db.query(
        `UPDATE turnstile.people_import_job SET state='cancelled',updated_at=statement_timestamp(),version=version+1 WHERE tenant_id=$1 AND state='draft' AND review_expires_at<=statement_timestamp()`,
        [tenant],
      );
      const job = (
        await db.query<ImportRecord>(
          `SELECT * FROM turnstile.people_import_job WHERE tenant_id=$1 AND next_attempt_at<=statement_timestamp() AND (state='queued' OR (state='running' AND lease_expires_at<=statement_timestamp())) ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [tenant],
        )
      ).rows[0];
      if (!job) return;
      const waiting = (
        await db.query<{ until: Date }>(
          `SELECT max("window"+CASE WHEN actor='installation' THEN interval '1 hour' ELSE interval '1 minute' END) AS until FROM turnstile.invitation_rate WHERE tenant_id=$1 AND ((actor=$2 AND count>=10 AND "window"=to_timestamp(floor(extract(epoch FROM statement_timestamp())/60)*60)) OR (actor='installation' AND count>=100 AND "window"=to_timestamp(floor(extract(epoch FROM statement_timestamp())/3600)*3600)))`,
          [tenant, `actor:${job.actor_id}`],
        )
      ).rows[0]?.until;
      if (waiting) {
        await db.query(
          `UPDATE turnstile.people_import_job SET state='queued',reason='rate_limit',next_attempt_at=$3,lease_id=NULL,lease_expires_at=NULL,updated_at=statement_timestamp() WHERE tenant_id=$1 AND id=$2`,
          [tenant, job.id, waiting],
        );
        return;
      }
      const row = (
        await db.query<ImportRowRecord>(
          `SELECT * FROM turnstile.people_import_row WHERE tenant_id=$1 AND job_id=$2 AND state IN ('processing','pending') ORDER BY (state='processing') DESC,number LIMIT 1 FOR UPDATE`,
          [tenant, job.id],
        )
      ).rows[0];
      if (!row) {
        await db.query(
          `UPDATE turnstile.people_import_job SET state='completed',version=version+1,updated_at=statement_timestamp(),reason=NULL,lease_id=NULL,lease_expires_at=NULL WHERE tenant_id=$1 AND id=$2`,
          [tenant, job.id],
        );
        return;
      }
      if (row.attempts >= 5) {
        await db.query(
          `UPDATE turnstile.people_import_job SET state='paused',reason='attempts_exhausted',version=version+1,updated_at=statement_timestamp(),lease_id=NULL,lease_expires_at=NULL WHERE tenant_id=$1 AND id=$2`,
          [tenant, job.id],
        );
        return;
      }
      const lease = randomUUID();
      await db.query(
        `UPDATE turnstile.people_import_job SET state='running',reason=NULL,lease_id=$3,lease_expires_at=statement_timestamp()+$4*interval '1 second',version=version+1,updated_at=statement_timestamp() WHERE tenant_id=$1 AND id=$2`,
        [tenant, job.id, lease, PEOPLE_IMPORT_LIMITS.leaseSeconds],
      );
      await db.query(
        `UPDATE turnstile.people_import_row SET state='processing',attempts=attempts+1 WHERE tenant_id=$1 AND job_id=$2 AND number=$3`,
        [tenant, job.id, row.number],
      );
      return { job, row: { ...row, attempts: row.attempts + 1 }, lease };
    });
  }
  private async fenced(db: PoolClient, tenant: string, claim: Claim) {
    const job = await this.jobs.record({ db, tenant }, claim.job.id);
    if (
      job.state !== 'running' ||
      job.lease_id !== claim.lease ||
      !job.lease_expires_at ||
      job.lease_expires_at.getTime() <= Date.now()
    )
      return importConflict();
    return job;
  }
  private async finish(
    db: PoolClient,
    tenant: string,
    claim: Claim,
    state: ImportRowDto['state'],
    reason: ImportRowDto['reason'],
    invitationId: string | null = null,
  ) {
    await this.fenced(db, tenant, claim);
    await db.query(
      `UPDATE turnstile.people_import_row SET state=$4,reason=$5,invitation_id=$6 WHERE tenant_id=$1 AND job_id=$2 AND number=$3 AND state='processing' AND command_key=$7`,
      [tenant, claim.job.id, claim.row.number, state, reason, invitationId, claim.row.command_key],
    );
    await db.query(
      `UPDATE turnstile.people_import_job SET state=CASE WHEN EXISTS(SELECT 1 FROM turnstile.people_import_row WHERE tenant_id=$1 AND job_id=$2 AND state IN ('pending','processing')) THEN 'queued' ELSE 'completed' END,version=version+1,reason=NULL,updated_at=statement_timestamp(),next_attempt_at=statement_timestamp()+$3*interval '1 second',lease_id=NULL,lease_expires_at=NULL WHERE tenant_id=$1 AND id=$2`,
      [tenant, claim.job.id, PEOPLE_IMPORT_LIMITS.rowIntervalSeconds],
    );
  }
  async process(claim: Claim) {
    const actor = {
      userId: claim.job.actor_id,
      requestId: randomUUID(),
      deadlineAt: Date.now() + 10000,
    };
    try {
      const command = await this.jobs.store.run(actor, 'people', async (tx) => {
        const job = await this.fenced(tx.db, tx.tenant, claim);
        await this.jobs.requireOpen(tx);
        await this.jobs.check(tx, job);
        if (claim.row.command) return invitationIssueCommandSchema.parse(claim.row.command);
        const existing = await this.jobs.existing(tx, claim.row.email);
        if (existing) {
          await this.finish(tx.db, tx.tenant, claim, 'skipped', existing);
          return;
        }
        const next = invitationIssueCommandSchema.parse({
          operation: 'invitation.issue',
          email: claim.row.email,
          assignments: job.assignments,
          expectedAccessRevision: tx.access.context.accessRevision,
          expectedOrganizationRevision: tx.organizationRevision,
        });
        await tx.db.query(
          'UPDATE turnstile.people_import_row SET command=$4 WHERE tenant_id=$1 AND job_id=$2 AND number=$3 AND command IS NULL',
          [tx.tenant, job.id, claim.row.number, next],
        );
        return next;
      });
      if (!command) return;
      const memberId = await this.jobs.store.run(
        actor,
        'people',
        async (tx) =>
          (
            await tx.db.query<{ id: string }>(
              'SELECT id FROM turnstile.access_member WHERE tenant_id=$1 AND user_id=$2',
              [tx.tenant, actor.userId],
            )
          ).rows[0]?.id,
      );
      if (!memberId) throw new HttpException({ code: 'PERMISSION_DENIED' }, 403);
      const creator = await this.identity.projectMembers(actor, [memberId]);
      if (
        !creator.subjects.some(
          (subject) =>
            subject.userId === actor.userId && subject.state === 'present' && subject.emailVerified,
        )
      )
        throw new HttpException({ code: 'PERMISSION_DENIED' }, 403);
      await this.reader.recycledAddress(actor, command.email);
      await this.invitations.execute(
        actor,
        claim.row.command_key,
        command,
        async (db, tenant) => {
          const job = await this.fenced(db, tenant, claim);
          const access = await readAccess(db, tenant, actor.userId);
          const org = (
            await db.query<{ revision: number }>(
              'SELECT revision FROM turnstile.organization_configuration WHERE tenant_id=$1',
              [tenant],
            )
          ).rows[0];
          if (!org) return importConflict();
          const tx = { db, tenant, actor, access, organizationRevision: org.revision };
          await this.jobs.requireOpen(tx);
          await this.jobs.check(tx, job);
          if (
            (
              await db.query(
                `SELECT 1 FROM turnstile.access_member m JOIN turnstile.member_display d ON d.tenant_id=m.tenant_id AND d.member_id=m.id WHERE m.tenant_id=$1 AND m.status='active' AND d.state='deleted' AND (d.email=$2 OR d.email IS NULL) LIMIT 1`,
                [tenant, command.email],
              )
            ).rowCount
          )
            return importConflict();
        },
        (db, tenant, id) => this.finish(db, tenant, claim, 'succeeded', null, id),
      );
      this.metrics.processed++;
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 503;
      const response = error instanceof HttpException ? error.getResponse() : undefined;
      const reason =
        typeof response === 'object' && response && 'reason' in response
          ? response.reason
          : undefined;
      await this.jobs.invitations.run(async (db, tenant) => {
        const job = await this.jobs.record({ db, tenant }, claim.job.id);
        // A committed row already atomically cleared its lease. Never reinterpret it.
        if (job.state !== 'running' || job.lease_id !== claim.lease) return;
        if (
          status === 409 &&
          ['membership_exists', 'membership_suspended', 'state'].includes(String(reason))
        ) {
          const existing = await this.jobs.existing({ db, tenant }, claim.row.email);
          if (existing) {
            await this.finish(db, tenant, claim, 'skipped', existing);
            return;
          }
        }
        let jobState: ImportJobDto['state'] = 'queued',
          jobReason: ImportJobDto['reason'] = 'dependency',
          delay = Math.min(300, 5 * 2 ** claim.row.attempts);
        if (status === 403) {
          jobState = 'paused';
          jobReason = 'permission_changed';
        } else if (status === 409) {
          jobState = 'paused';
          jobReason = 'context_changed';
          if (reason === 'revision')
            await db.query(
              `UPDATE turnstile.people_import_row SET state='failed',reason='context_changed' WHERE tenant_id=$1 AND job_id=$2 AND number=$3 AND state='processing'`,
              [tenant, job.id, claim.row.number],
            );
        } else if (status === 429) {
          jobReason = 'rate_limit';
          delay = 60;
          // A definite rate rejection rolls back reservation creation. Clear only if
          // both owning receipt tables prove no reservation/commit exists.
          await db.query(
            `UPDATE turnstile.people_import_row r SET command=NULL,attempts=greatest(0,attempts-1) WHERE r.tenant_id=$1 AND r.job_id=$2 AND r.number=$3 AND NOT EXISTS(SELECT 1 FROM turnstile.invitation_operation o WHERE o.tenant_id=r.tenant_id AND o.actor_id=$4 AND o.key=r.command_key) AND NOT EXISTS(SELECT 1 FROM turnstile.access_command_receipt c WHERE c.tenant_id=r.tenant_id AND c.actor_id=$4 AND c.key=r.command_key)`,
            [tenant, job.id, claim.row.number, job.actor_id],
          );
        } else if (claim.row.attempts >= 5) {
          jobState = 'paused';
          jobReason = 'attempts_exhausted';
        }
        if (
          jobState === 'paused' &&
          !(
            await db.query(
              `SELECT 1 FROM turnstile.people_import_row WHERE tenant_id=$1 AND job_id=$2 AND state IN ('pending','processing') LIMIT 1`,
              [tenant, job.id],
            )
          ).rowCount
        )
          jobState = 'completed';
        await db.query(
          `UPDATE turnstile.people_import_job SET state=$3,reason=$4,version=version+1,updated_at=statement_timestamp(),next_attempt_at=statement_timestamp()+$5*interval '1 second',lease_id=NULL,lease_expires_at=NULL WHERE tenant_id=$1 AND id=$2`,
          [tenant, job.id, jobState, jobReason, delay],
        );
      });
    }
  }
  async drain() {
    const claim = await this.claim();
    if (claim) await this.process(claim);
    return !!claim;
  }
}
