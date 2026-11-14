import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type ImportJobDto,
  type ImportRowDto,
  importActionSchema,
  importCreateSchema,
  importDetailSchema,
  importErrorsSchema,
  importJobSchema,
  importListSchema,
  importRowsQuerySchema,
  PEOPLE_IMPORT_LIMITS,
  peopleIdSchema,
  type ResolvedRoleAssignmentDto,
  type RoleAssignmentRequestDto,
  resolvedRoleAssignmentsSchema,
} from '@thaarei/turnstile-contracts';
import type { ConfigurationActor } from '../../infrastructure/configuration-context.js';
import { featureWritesOpen } from '../access/release-state.js';
import { AdministrationService, peopleParse } from './administration.service.js';
import { parseImportCsv } from './import-csv.js';
import { hash, resolveAssignments } from './invitation-policy.js';
import { InvitationStoreService } from './invitation-store.service.js';
import {
  PeopleStoreService,
  type PeopleTransaction,
  peopleFailure,
} from './people-store.service.js';

export interface ImportRecord {
  id: string;
  actor_id: string;
  filename: string;
  digest: string;
  state: ImportJobDto['state'];
  version: number;
  assignments: RoleAssignmentRequestDto[];
  snapshot: ResolvedRoleAssignmentDto[];
  organization_revision: number;
  recovery_epoch: string;
  reason: ImportJobDto['reason'];
  lease_id: string | null;
  lease_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  review_expires_at: Date;
  next_attempt_at: Date;
}
export interface ImportRowRecord {
  number: number;
  email: string;
  state: ImportRowDto['state'];
  reason: ImportRowDto['reason'];
  invitation_id: string | null;
  command_key: string;
  command: unknown;
  attempts: number;
}
export const assignmentHash = (assignments: ResolvedRoleAssignmentDto[]) =>
  hash(
    resolvedRoleAssignmentsSchema.parse(assignments).map((a) => ({ role: a.role, scope: a.scope })),
  );
export const importConflict = () => peopleFailure(409, 'PEOPLE_CONFLICT', { reason: 'state' });
export const importRowDto = (row: ImportRowRecord): ImportRowDto => ({
  number: row.number,
  email: row.email,
  state: row.state,
  reason: row.reason,
  invitationId: row.invitation_id,
});
@Injectable()
export class BulkImportService {
  constructor(
    readonly store: PeopleStoreService,
    readonly invitations: InvitationStoreService,
    private readonly reader: AdministrationService,
  ) {}
  async requireOpen(tx: PeopleTransaction) {
    if (!(await featureWritesOpen(tx.db, tx.tenant)))
      return peopleFailure(503, 'PEOPLE_UNAVAILABLE', { reason: 'readiness' });
  }
  async record(tx: Pick<PeopleTransaction, 'db' | 'tenant'>, id: string) {
    const row = (
      await tx.db.query<ImportRecord>(
        'SELECT * FROM turnstile.people_import_job WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
        [tx.tenant, id],
      )
    ).rows[0];
    if (!row) return peopleFailure(404, 'PEOPLE_NOT_FOUND');
    return row;
  }
  async check(tx: PeopleTransaction, job: ImportRecord) {
    if (
      job.recovery_epoch !== this.invitations.config?.recoveryEpoch ||
      job.organization_revision !== tx.organizationRevision
    )
      return importConflict();
    const resolved = await resolveAssignments(tx.db, tx.tenant, job.assignments, tx.access);
    if (assignmentHash(resolved) !== assignmentHash(job.snapshot)) return importConflict();
  }
  async existing(tx: Pick<PeopleTransaction, 'db' | 'tenant'>, email: string) {
    if (
      (
        await tx.db.query(
          `SELECT 1 FROM turnstile.access_member m JOIN turnstile.member_display d ON d.tenant_id=m.tenant_id AND d.member_id=m.id WHERE m.tenant_id=$1 AND lower(d.email)=$2 LIMIT 1`,
          [tx.tenant, email],
        )
      ).rowCount
    )
      return 'existing_member' as const;
    if (
      (
        await tx.db.query(
          `SELECT 1 FROM turnstile.invitation WHERE tenant_id=$1 AND email=$2 AND state IN ('pending','needs_reapproval') AND expires_at>statement_timestamp() LIMIT 1`,
          [tx.tenant, email],
        )
      ).rowCount
    )
      return 'existing_invitation' as const;
    return null;
  }
  async projection(tx: Pick<PeopleTransaction, 'db' | 'tenant'>, job: ImportRecord) {
    const counts = { pending: 0, processing: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: 0 };
    for (const row of (
      await tx.db.query<{ state: keyof typeof counts; count: number }>(
        'SELECT state,count(*)::int AS count FROM turnstile.people_import_row WHERE tenant_id=$1 AND job_id=$2 GROUP BY state',
        [tx.tenant, job.id],
      )
    ).rows)
      counts[row.state] = row.count;
    return importJobSchema.parse({
      id: job.id,
      actorId: job.actor_id,
      filename: job.filename,
      state: job.state,
      version: job.version,
      reason: job.reason,
      createdAt: job.created_at.toISOString(),
      updatedAt: job.updated_at.toISOString(),
      reviewExpiresAt: job.review_expires_at.toISOString(),
      nextAttemptAt: job.next_attempt_at.toISOString(),
      assignments: job.snapshot,
      counts,
    });
  }
  async detailTx(tx: Pick<PeopleTransaction, 'db' | 'tenant'>, job: ImportRecord, after = 0) {
    const rows = (
      await tx.db.query<ImportRowRecord>(
        'SELECT * FROM turnstile.people_import_row WHERE tenant_id=$1 AND job_id=$2 AND number>$3 ORDER BY number LIMIT 26',
        [tx.tenant, job.id, after],
      )
    ).rows;
    return importDetailSchema.parse({
      job: await this.projection(tx, job),
      rows: rows.slice(0, 25).map(importRowDto),
      nextAfter: rows.length > 25 ? rows[24]?.number : null,
    });
  }
  async create(actor: ConfigurationActor, input: unknown) {
    const body = peopleParse(importCreateSchema, input),
      rows = parseImportCsv(body.csv),
      digest = hash(body);
    await this.reader.refresh(actor);
    return this.store.run(actor, 'people', async (tx) => {
      await this.requireOpen(tx);
      const previous = (
        await tx.db.query<ImportRecord>(
          'SELECT * FROM turnstile.people_import_job WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
          [tx.tenant, body.id],
        )
      ).rows[0];
      if (previous) {
        if (previous.actor_id !== actor.userId || previous.digest !== digest)
          return importConflict();
        return this.detailTx(tx, previous);
      }
      await tx.db.query(
        `DELETE FROM turnstile.people_import_job WHERE tenant_id=$1 AND created_at<statement_timestamp()-interval '90 days' AND state IN ('draft','completed','cancelled')`,
        [tx.tenant],
      );
      const counts = (
        await tx.db.query<{ total: number; active: number }>(
          `SELECT count(*)::int AS total,count(*) FILTER (WHERE state NOT IN ('completed','cancelled'))::int AS active FROM turnstile.people_import_job WHERE tenant_id=$1`,
          [tx.tenant],
        )
      ).rows[0];
      if (
        !counts ||
        counts.active >= PEOPLE_IMPORT_LIMITS.activeJobs ||
        counts.total >= PEOPLE_IMPORT_LIMITS.retainedJobs
      )
        return peopleFailure(503, 'PEOPLE_UNAVAILABLE', { reason: 'capacity' });
      const snapshot = await resolveAssignments(tx.db, tx.tenant, body.assignments, tx.access);
      const job = (
        await tx.db.query<ImportRecord>(
          `INSERT INTO turnstile.people_import_job(tenant_id,id,actor_id,filename,digest,assignments,snapshot,organization_revision,recovery_epoch,review_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,statement_timestamp()+interval '10 minutes') RETURNING *`,
          [
            tx.tenant,
            body.id,
            actor.userId,
            body.filename,
            digest,
            JSON.stringify(body.assignments),
            JSON.stringify(snapshot),
            tx.organizationRevision,
            this.invitations.config?.recoveryEpoch,
          ],
        )
      ).rows[0];
      if (!job) throw new Error('Missing import');
      for (const row of rows) {
        const reason = row.reason ?? (await this.existing(tx, row.email));
        const state = reason
          ? ['duplicate_csv', 'existing_member', 'existing_invitation'].includes(reason)
            ? 'skipped'
            : 'failed'
          : 'pending';
        await tx.db.query(
          'INSERT INTO turnstile.people_import_row(tenant_id,job_id,number,email,state,reason,command_key) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [tx.tenant, job.id, row.number, row.email, state, reason, randomUUID()],
        );
      }
      return this.detailTx(tx, job);
    });
  }
  async list(actor: ConfigurationActor) {
    return this.store.run(actor, 'people', async (tx) => {
      const rows = (
        await tx.db.query<ImportRecord>(
          'SELECT * FROM turnstile.people_import_job WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',
          [tx.tenant],
        )
      ).rows;
      const items = [];
      for (const row of rows) items.push(await this.projection(tx, row));
      return importListSchema.parse({ items });
    });
  }
  detail(actor: ConfigurationActor, input: string, query: unknown) {
    const id = peopleParse(peopleIdSchema, input),
      { after } = peopleParse(importRowsQuerySchema, query);
    return this.store.run(actor, 'people', async (tx) =>
      this.detailTx(tx, await this.record(tx, id), after),
    );
  }
  errors(actor: ConfigurationActor, input: string) {
    const id = peopleParse(peopleIdSchema, input);
    return this.store.run(actor, 'people', async (tx) => {
      await this.record(tx, id);
      const rows = (
        await tx.db.query<ImportRowRecord>(
          `SELECT * FROM turnstile.people_import_row WHERE tenant_id=$1 AND job_id=$2 AND state IN ('failed','skipped','cancelled') ORDER BY number LIMIT 500`,
          [tx.tenant, id],
        )
      ).rows;
      return importErrorsSchema.parse({ rows: rows.map(importRowDto) });
    });
  }
  action(actor: ConfigurationActor, input: string, body: unknown) {
    const id = peopleParse(peopleIdSchema, input),
      command = peopleParse(importActionSchema, body);
    return this.store.run(actor, 'people', async (tx) => {
      await this.requireOpen(tx);
      const job = await this.record(tx, id);
      if (command.action !== 'cancel' && job.actor_id !== actor.userId)
        return peopleFailure(403, 'PERMISSION_DENIED');
      if (
        (command.action === 'cancel' && job.state === 'cancelled') ||
        (command.action !== 'cancel' && ['queued', 'running', 'completed'].includes(job.state))
      )
        return this.detailTx(tx, job);
      if (job.version !== command.expectedVersion) return importConflict();
      if (command.action === 'cancel') {
        if (job.state === 'completed') return importConflict();
        await tx.db.query(
          `UPDATE turnstile.people_import_row SET state='cancelled',reason='cancelled' WHERE tenant_id=$1 AND job_id=$2 AND state IN ('pending','processing')`,
          [tx.tenant, id],
        );
      } else {
        if (
          (command.action === 'start' &&
            (job.state !== 'draft' || job.review_expires_at.getTime() <= Date.now())) ||
          (command.action === 'resume' && job.state !== 'paused')
        )
          return importConflict();
        await this.check(tx, job);
        if (
          !(
            await tx.db.query(
              `SELECT 1 FROM turnstile.people_import_row WHERE tenant_id=$1 AND job_id=$2 AND state IN ('pending','processing') LIMIT 1`,
              [tx.tenant, id],
            )
          ).rowCount
        )
          return importConflict();
        await tx.db.query(
          `UPDATE turnstile.people_import_row SET attempts=0 WHERE tenant_id=$1 AND job_id=$2 AND state IN ('pending','processing')`,
          [tx.tenant, id],
        );
      }
      await tx.db.query(
        `UPDATE turnstile.people_import_job SET state=$3,reason=NULL,version=version+1,updated_at=statement_timestamp(),next_attempt_at=statement_timestamp(),lease_id=NULL,lease_expires_at=NULL WHERE tenant_id=$1 AND id=$2`,
        [tx.tenant, id, command.action === 'cancel' ? 'cancelled' : 'queued'],
      );
      return this.detailTx(tx, await this.record(tx, id));
    });
  }
}
