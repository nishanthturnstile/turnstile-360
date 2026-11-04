import { randomBytes, randomUUID } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';
import {
  type InvitationDto,
  invitationCancelCommandSchema,
  invitationIssueCommandSchema,
  invitationReapproveCommandSchema,
  invitationResendCommandSchema,
  invitationSchema,
  peopleIdSchema,
  type ResolvedRoleAssignmentDto,
} from '@thaarei/turnstile-contracts';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { ConfigurationActor } from '../../infrastructure/configuration-context.js';
import { IdentityClientService } from '../../integrations/identity/identity-client.service.js';
import { readAccess } from '../access/access-evaluator.js';
import { sealPayload } from './invitation-crypto.js';
import {
  ceiling,
  conflict,
  digests,
  hash,
  invitationAudit,
  resolveAssignments,
  unavailable,
} from './invitation-policy.js';
import { InvitationStoreService } from './invitation-store.service.js';

const commandSchema = z.union([
  invitationIssueCommandSchema,
  invitationResendCommandSchema,
  invitationCancelCommandSchema,
  invitationReapproveCommandSchema,
]);
type Command = z.infer<typeof commandSchema>;
function parseCommand(input: unknown): Command {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success)
    throw new HttpException(
      { code: 'PEOPLE_INVALID', fieldErrors: [{ field: 'body', reason: 'invalid' }] },
      400,
    );
  return parsed.data;
}
export interface InvitationRow {
  id: string;
  email: string;
  version: number;
  generation: number;
  state: InvitationDto['state'];
  approver_id: string;
  approval_id: string | null;
  assignments: ResolvedRoleAssignmentDto[];
  recovery_epoch: string;
  created_at: Date;
  expires_at: Date;
  invalidated_at: Date | null;
  cancelled_at: Date | null;
  accepted_at: Date | null;
  accepted_user_id: string | null;
  checked_at?: Date;
  expired?: boolean;
}
type Operation = {
  invitation_id: string;
  identity_operation_id: string;
  input: Command;
  digest: string;
  state: string;
  expires_at: Date;
};
@Injectable()
export class InvitationService {
  constructor(
    private readonly store: InvitationStoreService,
    private readonly identity: IdentityClientService,
  ) {}
  // Recipient coordination in UM-I08 adds protected exchange/rate/CSRF around this read-only lookup.
  async credential(input: unknown) {
    if (typeof input !== 'string' || !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(input))
      throw new HttpException({ code: 'INVITATION_UNAVAILABLE' }, 410);
    return this.store.run(async (db, tenant, config) => {
      const row = (
        await db.query<{ id: string; generation: number; email: string }>(
          `SELECT i.id,i.generation,i.email FROM turnstile.invitation i JOIN turnstile.invitation_generation g ON g.tenant_id=i.tenant_id AND g.invitation_id=i.id AND g.generation=i.generation AND g.id=i.approval_id WHERE i.tenant_id=$1 AND g.credential_hash=$2 AND i.state='pending' AND i.expires_at>statement_timestamp() AND g.expires_at>statement_timestamp() AND i.recovery_epoch=$3 AND g.recovery_epoch=$3 AND turnstile.invitation_approval_valid(i.tenant_id,i.id)`,
          [tenant, hash(input), config.recoveryEpoch],
        )
      ).rows[0];
      if (!row) throw new HttpException({ code: 'INVITATION_UNAVAILABLE' }, 410);
      return { invitationId: row.id, generation: row.generation, email: row.email };
    });
  }
  async maintain() {
    return this.store.run((db, tenant, config) =>
      db.query('SELECT turnstile.maintain_invitations($1,$2)', [tenant, config.recoveryEpoch]),
    );
  }
  private async versions(db: PoolClient, tenant: string, command: Command) {
    const row = (
      await db.query<{ revision: number; organization_revision: number }>(
        'SELECT a.revision,o.revision AS organization_revision FROM turnstile.access_context a JOIN turnstile.organization_configuration o USING(tenant_id) WHERE a.tenant_id=$1',
        [tenant],
      )
    ).rows[0];
    if (
      !row ||
      row.revision !== command.expectedAccessRevision ||
      ('expectedOrganizationRevision' in command &&
        row.organization_revision !== command.expectedOrganizationRevision)
    )
      conflict('revision');
    return row;
  }
  private async row(db: PoolClient, tenant: string, id: string) {
    const row = (
      await db.query<InvitationRow>(
        'SELECT *,statement_timestamp() AS checked_at,expires_at<=statement_timestamp() AS expired FROM turnstile.invitation WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
        [tenant, id],
      )
    ).rows[0];
    if (!row) throw new HttpException({ code: 'PEOPLE_NOT_FOUND' }, 404);
    return row;
  }
  private async candidate(
    db: PoolClient,
    tenant: string,
    actor: ConfigurationActor,
    command: Command,
  ) {
    const access = await readAccess(db, tenant, actor.userId);
    if (command.operation === 'invitation.issue')
      return {
        email: command.email,
        assignments: await resolveAssignments(db, tenant, command.assignments, access),
        generation: 1,
      };
    const current = await this.row(db, tenant, command.id);
    if (
      current.version !== command.expectedVersion ||
      current.generation !== command.expectedGeneration
    )
      conflict('version');
    if (!['pending', 'needs_reapproval'].includes(current.state)) conflict('state');
    if (command.operation === 'invitation.cancel')
      return {
        email: current.email,
        assignments: current.assignments,
        generation: current.generation + 1,
      };
    if (command.operation === 'invitation.resend') {
      if (current.state !== 'pending') conflict('approval_changed');
      if (
        !(
          await db.query<{ valid: boolean }>(
            'SELECT turnstile.invitation_approval_valid($1,$2) AS valid',
            [tenant, current.id],
          )
        ).rows[0]?.valid
      )
        conflict('approval_changed');
      // Resend preserves the immutable original approver; a new approver must explicitly reapprove.
      ceiling(access, current.assignments);
      return {
        email: current.email,
        assignments: current.assignments,
        generation: current.generation + 1,
      };
    }
    if (current.state !== 'needs_reapproval') conflict('state');
    return {
      email: command.email,
      assignments: await resolveAssignments(db, tenant, command.assignments, access),
      generation: current.generation + 1,
    };
  }
  // Administration impact uses the owning lifecycle eligibility under its existing Access lock.
  reviewInTransaction(db: PoolClient, tenant: string, actor: ConfigurationActor, input: unknown) {
    return this.candidate(db, tenant, actor, parseCommand(input));
  }
  private async project(
    db: PoolClient,
    tenant: string,
    row: InvitationRow,
  ): Promise<InvitationDto> {
    const expired = row.expired && ['pending', 'needs_reapproval'].includes(row.state);
    if (expired) row = { ...row, state: 'expired', approval_id: null };
    const generation = (
      await db.query<{ approval: unknown }>(
        'SELECT approval FROM turnstile.invitation_generation WHERE tenant_id=$1 AND invitation_id=$2 AND id=$3',
        [tenant, row.id, row.approval_id],
      )
    ).rows[0];
    const d = (
      await db.query<{
        state: string;
        attempts: number;
        next_attempt_at: Date;
        lease_expires_at: Date | null;
        outcome_at: Date | null;
        reason: string | null;
      }>(
        'SELECT state,attempts,next_attempt_at,lease_expires_at,outcome_at,reason FROM turnstile.invitation_delivery WHERE tenant_id=$1 AND invitation_id=$2 AND generation=$3',
        [tenant, row.id, row.generation],
      )
    ).rows[0];
    const delivery =
      expired && d && ['queued', 'sending'].includes(d.state)
        ? {
            generation: row.generation,
            state: 'failed',
            attempts: d.attempts,
            at: row.checked_at?.toISOString(),
            reason: 'expired',
          }
        : d
          ? {
              generation: row.generation,
              state: d.state,
              attempts: d.attempts,
              ...(d.state === 'queued'
                ? { nextAttemptAt: d.next_attempt_at.toISOString() }
                : d.state === 'sending'
                  ? { leaseExpiresAt: d.lease_expires_at?.toISOString() }
                  : { at: d.outcome_at?.toISOString(), ...(d.reason ? { reason: d.reason } : {}) }),
            }
          : null;
    return invitationSchema.parse({
      id: row.id,
      email: row.email,
      version: row.version,
      generation: row.generation,
      state: row.state,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      assignments: row.assignments,
      delivery,
      approval: row.approval_id ? generation?.approval : null,
      ...(row.state === 'needs_reapproval'
        ? { invalidatedAt: row.invalidated_at?.toISOString() }
        : row.state === 'cancelled'
          ? { cancelledAt: row.cancelled_at?.toISOString() }
          : row.state === 'accepted'
            ? { acceptedAt: row.accepted_at?.toISOString(), acceptedUserId: row.accepted_user_id }
            : {}),
    });
  }
  async readInTransaction(db: PoolClient, tenant: string, id: string) {
    return this.project(db, tenant, await this.row(db, tenant, id));
  }
  async read(actor: ConfigurationActor, id: string) {
    return this.store.run(
      async (db, tenant) =>
        this.project(db, tenant, await this.row(db, tenant, peopleIdSchema.parse(id))),
      actor,
    );
  }
  async readback(actor: ConfigurationActor, key: string) {
    return this.store.run(async (db, tenant) => {
      const operation = (
        await db.query<Operation>(
          'SELECT * FROM turnstile.invitation_operation WHERE tenant_id=$1 AND actor_id=$2 AND key=$3 AND expires_at>statement_timestamp()',
          [tenant, actor.userId, peopleIdSchema.parse(key)],
        )
      ).rows[0];
      if (!operation) throw new HttpException({ code: 'PEOPLE_NOT_FOUND' }, 404);
      if (operation.state !== 'completed') return { state: 'preparing' as const };
      return this.project(db, tenant, await this.row(db, tenant, operation.invitation_id));
    }, actor);
  }
  async execute(
    actor: ConfigurationActor,
    keyInput: string,
    input: unknown,
    validate?: (db: PoolClient, tenant: string) => Promise<void>,
  ): Promise<InvitationDto> {
    const key = peopleIdSchema.parse(keyInput);
    const command = parseCommand(input);
    const digest = hash(command);
    actor = { ...actor, deadlineAt: actor.deadlineAt ?? Date.now() + 10000 };
    await this.maintain();
    const reservation = await this.store.run(async (db, tenant) => {
      const old = (
        await db.query<Operation>(
          'SELECT * FROM turnstile.invitation_operation WHERE tenant_id=$1 AND actor_id=$2 AND key=$3',
          [tenant, actor.userId, key],
        )
      ).rows[0];
      if (old) {
        if (old.digest !== digest) conflict('idempotency_mismatch');
        if (old.expires_at.getTime() <= Date.now()) conflict('state');
        return old;
      }
      if (
        (
          await db.query(
            `SELECT 1 FROM turnstile.access_command_receipt WHERE tenant_id=$1 AND actor_id=$2 AND key=$3 AND expires_at>statement_timestamp() UNION ALL SELECT 1 FROM turnstile.configuration_create_receipt WHERE tenant_id=$1 AND actor_id=$2 AND key=$3 AND expires_at>statement_timestamp()`,
            [tenant, actor.userId, key],
          )
        ).rowCount
      )
        conflict('idempotency_mismatch');
      await this.versions(db, tenant, command);
      await this.candidate(db, tenant, actor, command);
      const id = command.operation === 'invitation.issue' ? randomUUID() : command.id;
      if (command.operation !== 'invitation.cancel') {
        // Persisted under the installation lock; replays reuse the reservation without counting again.
        for (const [who, seconds, maximum] of [
          [`actor:${actor.userId}`, 60, 10],
          ['installation', 3600, 100],
        ] as const) {
          const rate = await db.query<{ count: number }>(
            `INSERT INTO turnstile.invitation_rate (tenant_id,actor,"window",count) VALUES ($1,$2,to_timestamp(floor(extract(epoch FROM statement_timestamp())/$3)*$3),1) ON CONFLICT (tenant_id,actor,"window") DO UPDATE SET count=turnstile.invitation_rate.count+1 RETURNING count`,
            [tenant, who, seconds],
          );
          if ((rate.rows[0]?.count ?? maximum + 1) > maximum)
            throw new HttpException(
              { code: 'PEOPLE_RATE_LIMITED', retryAfterSeconds: seconds },
              429,
            );
        }
      }
      await db.query('SELECT turnstile.reserve_invitation_command($1,$2,$3,$4,$5,$6)', [
        tenant,
        actor.userId,
        key,
        command.operation,
        digest,
        id,
      ]);
      const operation = (
        await db.query<Operation>(
          'INSERT INTO turnstile.invitation_operation (tenant_id,actor_id,key,invitation_id,identity_operation_id,input,digest) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
          [tenant, actor.userId, key, id, randomUUID(), command, digest],
        )
      ).rows[0];
      if (!operation) return unavailable();
      return operation;
    }, actor);
    if (reservation.state === 'completed') return this.read(actor, reservation.invitation_id);
    let userId: string | undefined;
    if (command.operation !== 'invitation.cancel') {
      const candidate = await this.store.run(
        (db, tenant) => this.candidate(db, tenant, actor, command),
        actor,
      );
      try {
        const request = {
          operationId: reservation.identity_operation_id,
          invitationId: reservation.invitation_id,
          generation:
            command.operation === 'invitation.issue'
              ? candidate.generation
              : candidate.generation - 1,
          email: candidate.email,
          expiresAt: new Date(reservation.expires_at.getTime()).toISOString(),
        };
        let preparation: Awaited<ReturnType<IdentityClientService['prepare']>>;
        try {
          preparation = await this.identity.preparation(reservation.identity_operation_id);
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              'code' in error &&
              error.code === 'IDENTITY_SERVICE_NOT_FOUND'
            )
          )
            throw error;
          preparation = await this.identity.prepare(request);
        }
        if (preparation.state === 'unavailable') conflict('state');
        if (preparation.state === 'completed') userId = preparation.userId;
      } catch (error) {
        if (error instanceof HttpException) throw error;
        return unavailable();
      }
    }
    return this.store.run(async (db, tenant, config) => {
      const operation = (
        await db.query<Operation>(
          'SELECT * FROM turnstile.invitation_operation WHERE tenant_id=$1 AND actor_id=$2 AND key=$3 FOR UPDATE',
          [tenant, actor.userId, key],
        )
      ).rows[0];
      if (!operation) return unavailable();
      if (operation.state === 'completed')
        return this.project(db, tenant, await this.row(db, tenant, operation.invitation_id));
      if (validate) await validate(db, tenant);
      await this.versions(db, tenant, command);
      const candidate = await this.candidate(db, tenant, actor, command);
      if (candidate.generation > 2147483647) return unavailable();
      if (userId) {
        const member = (
          await db.query<{ status: string }>(
            'SELECT status FROM turnstile.access_member WHERE tenant_id=$1 AND user_id=$2',
            [tenant, userId],
          )
        ).rows[0];
        if (member)
          conflict(member.status === 'suspended' ? 'membership_suspended' : 'membership_exists');
      }
      const duplicate = await db.query(
        "SELECT 1 FROM turnstile.invitation WHERE tenant_id=$1 AND email=$2 AND id<>$3 AND state IN ('pending','needs_reapproval')",
        [tenant, candidate.email, operation.invitation_id],
      );
      if (duplicate.rowCount) conflict('state');
      if (command.operation === 'invitation.cancel') {
        await db.query(
          "UPDATE turnstile.invitation SET state='cancelled',approval_id=NULL,version=version+1,generation=generation+1,cancelled_at=statement_timestamp() WHERE tenant_id=$1 AND id=$2",
          [tenant, operation.invitation_id],
        );
        await db.query(
          "UPDATE turnstile.invitation_delivery SET state='failed',payload=NULL,reason='cancelled',outcome_at=statement_timestamp(),lease_id=NULL,lease_expires_at=NULL WHERE tenant_id=$1 AND invitation_id=$2 AND state IN ('queued','sending')",
          [tenant, operation.invitation_id],
        );
        await db.query(
          'DELETE FROM turnstile.invitation_reference WHERE tenant_id=$1 AND invitation_id=$2',
          [tenant, operation.invitation_id],
        );
      } else {
        const limits = await db.query<{ pending: number; unfinished: number }>(
          `SELECT (SELECT count(*)::int FROM turnstile.invitation WHERE tenant_id=$1 AND state IN ('pending','needs_reapproval')) AS pending,(SELECT count(*)::int FROM turnstile.invitation_delivery WHERE tenant_id=$1 AND state IN ('queued','sending')) AS unfinished`,
          [tenant],
        );
        const limit = limits.rows[0];
        if (
          !limit ||
          (command.operation === 'invitation.issue' && limit.pending >= 1000) ||
          limit.unfinished >= 2048
        )
          return unavailable();
        const now = (
          await db.query<{ now: Date; expires: Date }>(
            "SELECT statement_timestamp() AS now,statement_timestamp()+interval '604800 seconds' AS expires",
          )
        ).rows[0];
        if (!now) return unavailable();
        const current =
          command.operation === 'invitation.issue'
            ? undefined
            : await this.row(db, tenant, operation.invitation_id);
        const approver =
          command.operation === 'invitation.resend'
            ? (current?.approver_id ?? actor.userId)
            : actor.userId;
        const approvalId = randomUUID();
        const approval = {
          approverId: approver,
          approvedAt: now.now.toISOString(),
          accessRevision: command.expectedAccessRevision + 1,
          organizationRevision: command.expectedOrganizationRevision,
          ...digests(
            candidate.assignments,
            (await readAccess(db, tenant, approver)).context.fingerprint,
            config.recoveryEpoch,
          ),
        };
        const secret = randomBytes(32).toString('base64url');
        if (!current)
          await db.query(
            "INSERT INTO turnstile.invitation(tenant_id,id,email,state,approver_id,approval_id,assignments,recovery_epoch,created_at,expires_at) VALUES ($1,$2,$3,'pending',$4,$5,$6,$7,$8,$9)",
            [
              tenant,
              operation.invitation_id,
              candidate.email,
              approver,
              approvalId,
              JSON.stringify(candidate.assignments),
              config.recoveryEpoch,
              now.now,
              now.expires,
            ],
          );
        else
          await db.query(
            "UPDATE turnstile.invitation SET email=$3,state='pending',version=version+1,generation=$4,approver_id=$5,approval_id=$6,assignments=$7,recovery_epoch=$8,expires_at=$9,invalidated_at=NULL WHERE tenant_id=$1 AND id=$2",
            [
              tenant,
              operation.invitation_id,
              candidate.email,
              candidate.generation,
              approver,
              approvalId,
              JSON.stringify(candidate.assignments),
              config.recoveryEpoch,
              now.expires,
            ],
          );
        await db.query(
          'INSERT INTO turnstile.invitation_generation (tenant_id,invitation_id,generation,id,email,approver_id,approval,assignments,credential_hash,recovery_epoch,created_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
          [
            tenant,
            operation.invitation_id,
            candidate.generation,
            approvalId,
            candidate.email,
            approver,
            approval,
            JSON.stringify(candidate.assignments),
            hash(secret),
            config.recoveryEpoch,
            now.now,
            now.expires,
          ],
        );
        await db.query(
          "UPDATE turnstile.invitation_delivery SET state='failed',payload=NULL,reason='stale_generation',outcome_at=statement_timestamp(),lease_id=NULL,lease_expires_at=NULL WHERE tenant_id=$1 AND invitation_id=$2 AND state IN ('queued','sending')",
          [tenant, operation.invitation_id],
        );
        const payload = sealPayload(config, {
          email: candidate.email,
          invitationId: operation.invitation_id,
          generation: candidate.generation,
          expiresAt: now.expires.toISOString(),
          link: `${config.AUTH_PUBLIC_ORIGIN}/invitations/join#${secret}`,
          roles: candidate.assignments.map((a) => a.role.name),
        });
        await db.query(
          "INSERT INTO turnstile.invitation_delivery (tenant_id,invitation_id,generation,state,payload,recovery_epoch) VALUES ($1,$2,$3,'queued',$4,$5)",
          [tenant, operation.invitation_id, candidate.generation, payload, config.recoveryEpoch],
        );
        await db.query(
          'DELETE FROM turnstile.invitation_reference WHERE tenant_id=$1 AND invitation_id=$2',
          [tenant, operation.invitation_id],
        );
        for (const a of candidate.assignments) {
          await db.query(
            'INSERT INTO turnstile.invitation_reference (tenant_id,id,invitation_id,role_id) VALUES ($1,$2,$3,$4)',
            [tenant, randomUUID(), operation.invitation_id, a.role.id],
          );
          if (a.scope.kind === 'units')
            for (const id of a.scope.unitIds)
              await db.query(
                'INSERT INTO turnstile.invitation_reference (tenant_id,id,invitation_id,unit_id) VALUES ($1,$2,$3,$4)',
                [tenant, randomUUID(), operation.invitation_id, id],
              );
        }
      }
      await invitationAudit(
        db,
        tenant,
        operation.invitation_id,
        candidate.generation,
        command.operation === 'invitation.issue'
          ? 'issued'
          : command.operation === 'invitation.resend'
            ? 'resent'
            : command.operation === 'invitation.reapprove'
              ? 'reapproved'
              : 'cancelled',
        actor.userId,
      );
      await db.query(
        "UPDATE turnstile.invitation_operation SET state='completed' WHERE tenant_id=$1 AND actor_id=$2 AND key=$3",
        [tenant, actor.userId, key],
      );
      await db.query('SELECT turnstile.commit_invitation_command($1,$2,$3,$4,$5)', [
        tenant,
        actor.userId,
        key,
        actor.requestId,
        command.expectedAccessRevision,
      ]);
      return this.project(db, tenant, await this.row(db, tenant, operation.invitation_id));
    }, actor);
  }
}
