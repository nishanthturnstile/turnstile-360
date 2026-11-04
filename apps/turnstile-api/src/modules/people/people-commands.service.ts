import { randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  COMPANY_ONLY_PERMISSIONS,
  configurationNameKey,
  impactReviewRequestSchema,
  impactReviewSchema,
  peopleCommandResultSchema,
  peopleCommandSchema,
  peopleIdSchema,
  peopleMutationRequestSchema,
  type ResolvedRoleAssignmentDto,
  roleDefinitionSchema,
} from '@thaarei/turnstile-contracts';
import type { z } from 'zod';
import type { ConfigurationActor } from '../../infrastructure/configuration-context.js';
import { IdentityClientService } from '../../integrations/identity/identity-client.service.js';
import { covers, coversGrants, readAccess, scopeKey } from '../access/access-evaluator.js';
import { featureWritesOpen } from '../access/release-state.js';
import { AdministrationService, peopleParse } from './administration.service.js';
import { InvitationService } from './invitation.service.js';
import { ceiling, hash, resolveAssignments } from './invitation-policy.js';
import { memberRow, roleRows } from './people-projections.js';
import {
  PeopleStoreService,
  type PeopleTransaction,
  peopleFailure,
} from './people-store.service.js';

type Command = z.infer<typeof peopleCommandSchema>;
type Receipt = {
  operation: string;
  digest: string;
  subject_id: string;
  people_changed: boolean | null;
};
type Assessment = {
  members: string[];
  invitations: string[];
  proposed: ResolvedRoleAssignmentDto[];
  snapshot: unknown;
  confirmation: boolean;
  roles: z.infer<typeof roleDefinitionSchema>[];
};
const conflict = (reason = 'state'): never => peopleFailure(409, 'PEOPLE_CONFLICT', { reason });
const denied = (): never => peopleFailure(403, 'ACCESS_COVERAGE_DENIED');
export function canonicalCommand(command: Command): Command {
  if ('permissions' in command) command.permissions.sort();
  if ('assignments' in command) {
    for (const a of command.assignments) if (a.scope.kind === 'units') a.scope.unitIds.sort();
    command.assignments.sort((a, b) =>
      `${a.roleId}:${scopeKey(a.scope)}`.localeCompare(`${b.roleId}:${scopeKey(b.scope)}`),
    );
  }
  return command;
}
@Injectable()
export class PeopleCommandsService {
  constructor(
    private readonly store: PeopleStoreService,
    private readonly reader: AdministrationService,
    private readonly invitations: InvitationService,
    private readonly identity: IdentityClientService,
  ) {}
  // Opened only by the coordinated release operator, never a request/env override.
  async requireOpen(tx: PeopleTransaction) {
    if (!(await featureWritesOpen(tx.db, tx.tenant)))
      return peopleFailure(503, 'PEOPLE_UNAVAILABLE', { reason: 'readiness' });
  }
  private policy(command: Command) {
    return command.operation.startsWith('role.') ? ('roles' as const) : ('people' as const);
  }
  private async receipt(tx: PeopleTransaction, key: string, command?: Command) {
    if (
      (
        await tx.db.query(
          'SELECT 1 FROM turnstile.configuration_create_receipt WHERE tenant_id=$1 AND actor_id=$2 AND key=$3 AND expires_at>statement_timestamp()',
          [tx.tenant, tx.actor.userId, key],
        )
      ).rowCount
    )
      return command ? conflict('idempotency_mismatch') : peopleFailure(404, 'PEOPLE_NOT_FOUND');
    const row = (
      await tx.db.query<Receipt>(
        'SELECT operation,digest,subject_id,people_changed FROM turnstile.access_command_receipt WHERE tenant_id=$1 AND actor_id=$2 AND key=$3 AND expires_at>statement_timestamp()',
        [tx.tenant, tx.actor.userId, key],
      )
    ).rows[0];
    if (row && command && (row.operation !== command.operation || row.digest !== hash(command)))
      conflict('idempotency_mismatch');
    return row;
  }
  private async result(
    tx: PeopleTransaction,
    key: string,
    receipt: Receipt,
    replayed: boolean,
    authorizedMutation = false,
  ) {
    const base = {
      commandId: key,
      changed: receipt.people_changed ?? true,
      replayed,
      accessRevision: tx.access.context.accessRevision,
    };
    if (receipt.operation.startsWith('role.')) {
      if (!authorizedMutation && !covers(tx.access, 'turnstile:roles:manage', { kind: 'company' }))
        return peopleFailure(403, 'PERMISSION_DENIED');
      const role = (await roleRows(tx.db, tx.tenant)).find((r) => r.id === receipt.subject_id);
      return peopleCommandResultSchema.parse(
        role
          ? { ...base, kind: 'role', current: role }
          : { ...base, kind: 'deleted_role', id: receipt.subject_id },
      );
    }
    if (!authorizedMutation && !covers(tx.access, 'turnstile:people:manage', { kind: 'company' }))
      return peopleFailure(403, 'PERMISSION_DENIED');
    if (receipt.operation.startsWith('member.'))
      return peopleCommandResultSchema.parse({
        ...base,
        kind: 'member',
        current: await memberRow(tx.db, tx.tenant, receipt.subject_id),
      });
    if (receipt.operation.startsWith('invitation.')) {
      const op = (
        await tx.db.query(
          'SELECT state FROM turnstile.invitation_operation WHERE tenant_id=$1 AND actor_id=$2 AND key=$3',
          [tx.tenant, tx.actor.userId, key],
        )
      ).rows[0];
      if (op?.state !== 'completed')
        return peopleFailure(503, 'PEOPLE_UNAVAILABLE', { reason: 'dependency' });
      return peopleCommandResultSchema.parse({
        ...base,
        kind: 'invitation',
        current: await this.invitations.readInTransaction(tx.db, tx.tenant, receipt.subject_id),
      });
    }
    return peopleFailure(404, 'PEOPLE_NOT_FOUND');
  }
  async readback(actor: ConfigurationActor, keyInput: string) {
    const key = peopleParse(peopleIdSchema, keyInput);
    return this.store.run(actor, 'either', async (tx) => {
      const receipt = await this.receipt(tx, key);
      if (!receipt) return peopleFailure(404, 'PEOPLE_NOT_FOUND');
      return this.result(tx, key, receipt, true);
    });
  }
  private async assess(tx: PeopleTransaction, command: Command): Promise<Assessment> {
    if (
      command.expectedAccessRevision !== tx.access.context.accessRevision ||
      ('expectedOrganizationRevision' in command &&
        command.expectedOrganizationRevision !== tx.organizationRevision)
    )
      conflict('revision');
    const out: Assessment = {
      members: [],
      invitations: [],
      proposed: [],
      snapshot: [],
      confirmation: false,
      roles: [],
    };
    if (command.operation.startsWith('role.')) {
      const all = await roleRows(tx.db, tx.tenant);
      if (command.operation === 'role.create') {
        const source =
          command.source === 'copy' ? all.find((r) => r.id === command.copyFromRoleId) : undefined;
        if (
          command.source === 'copy' &&
          (!source || source.version !== command.expectedRoleVersion)
        )
          conflict('version');
        const permissions =
          command.source === 'new' ? command.permissions : (source?.permissions ?? []);
        if (all.length >= 128)
          return peopleFailure(503, 'PEOPLE_UNAVAILABLE', { reason: 'capacity' });
        if (all.some((r) => configurationNameKey(r.name) === configurationNameKey(command.name)))
          conflict('duplicate_name');
        if (
          !coversGrants(tx.access, [
            { sourceId: randomUUID(), permissions, scope: { kind: 'company' } },
          ])
        )
          denied();
        out.roles = source ? [source] : [];
        out.snapshot = { source, permissions };
        return out;
      }
      if (command.operation !== 'role.patch' && command.operation !== 'role.delete')
        return conflict();
      const role = all.find((r) => r.id === command.id);
      if (!role) return peopleFailure(404, 'PEOPLE_NOT_FOUND');
      if (role.version !== command.expectedVersion) conflict('version');
      if (role.systemKey) conflict('protected_role');
      out.roles = [role];
      out.snapshot = role;
      if (command.operation === 'role.patch' && command.change === 'details') {
        if (
          command.name &&
          all.some(
            (r) =>
              r.id !== role.id &&
              configurationNameKey(r.name) === configurationNameKey(command.name ?? ''),
          )
        )
          conflict('duplicate_name');
        return out;
      }
      const members = (
        await tx.db.query<{ id: string }>(
          'SELECT DISTINCT member_id AS id FROM turnstile.access_assignment WHERE tenant_id=$1 AND role_id=$2 ORDER BY member_id LIMIT 1001',
          [tx.tenant, role.id],
        )
      ).rows.map((r) => r.id);
      const invitations = (
        await tx.db.query<{ id: string }>(
          'SELECT DISTINCT invitation_id AS id FROM turnstile.invitation_reference WHERE tenant_id=$1 AND role_id=$2 ORDER BY invitation_id LIMIT 1001',
          [tx.tenant, role.id],
        )
      ).rows.map((r) => r.id);
      if (command.operation === 'role.delete') {
        if (members.length || invitations.length) conflict('reference_in_use');
        return out;
      }
      if (command.change !== 'permissions') return conflict();
      const added = command.permissions.filter((p) => !role.permissions.includes(p));
      if (
        !coversGrants(tx.access, [
          { sourceId: role.id, permissions: added, scope: { kind: 'company' } },
        ])
      )
        denied();
      const changed =
        JSON.stringify([...role.permissions].sort()) !==
        JSON.stringify([...command.permissions].sort());
      if (!changed) return out;
      if (members.length + invitations.length > 1000)
        return peopleFailure(503, 'PEOPLE_UNAVAILABLE', { reason: 'capacity' });
      if (members.length || invitations.length) {
        if (!covers(tx.access, 'turnstile:people:manage', { kind: 'company' })) denied();
        out.confirmation = true;
      }
      const memberSnapshots = [];
      for (const id of members) {
        const member = await memberRow(tx.db, tx.tenant, id);
        for (const a of member.assignments.filter((a) => a.role.id === role.id)) {
          ceiling(tx.access, [a]);
          const after = { ...a, role: { ...role, permissions: command.permissions } };
          if (
            after.scope.kind === 'units' &&
            after.role.permissions.some((p) => COMPANY_ONLY_PERMISSIONS.includes(p))
          )
            conflict('reference_in_use');
          ceiling(tx.access, [after]);
        }
        memberSnapshots.push({
          id: member.id,
          version: member.version,
          status: member.status,
          assignments: member.assignments,
        });
      }
      const invitationSnapshots = [];
      for (const id of invitations) {
        const inv = await this.invitations.readInTransaction(tx.db, tx.tenant, id);
        for (const a of inv.assignments.filter((a) => a.role.id === role.id)) {
          ceiling(tx.access, [a]);
          const after = { ...a, role: { ...role, permissions: command.permissions } };
          if (
            after.scope.kind === 'units' &&
            after.role.permissions.some((p) => COMPANY_ONLY_PERMISSIONS.includes(p))
          )
            conflict('reference_in_use');
          ceiling(tx.access, [after]);
        }
        invitationSnapshots.push({
          id: inv.id,
          version: inv.version,
          generation: inv.generation,
          assignments: inv.assignments,
        });
      }
      out.members = members;
      out.invitations = invitations;
      out.snapshot = { role, memberSnapshots, invitationSnapshots };
      return out;
    }
    if (command.operation.startsWith('member.')) {
      if (!('id' in command)) return conflict();
      const member = await memberRow(tx.db, tx.tenant, command.id);
      if (member.version !== command.expectedVersion) conflict('version');
      out.members = [member.id];
      out.confirmation = true;
      out.snapshot = {
        id: member.id,
        userId: member.userId,
        version: member.version,
        status: member.status,
        assignments: member.assignments,
        legacy: member.legacySource,
      };
      if (command.operation === 'member.assignments') {
        const proposed = command.assignments.length
          ? await resolveAssignments(tx.db, tx.tenant, command.assignments, tx.access, false)
          : [];
        // Resolve all roles/versions, then check only changed pairs. Retained independent sources stay untouched.
        const key = (a: ResolvedRoleAssignmentDto) => `${a.role.id}:${scopeKey(a.scope)}`;
        const removed = member.assignments.filter((a) => !proposed.some((p) => key(p) === key(a)));
        const added = proposed.filter((a) => !member.assignments.some((p) => key(p) === key(a)));
        ceiling(tx.access, [...removed, ...added]);
        if (command.retireLegacyVersion !== null) {
          if (!member.legacySource || member.legacySource.version !== command.retireLegacyVersion)
            return conflict('version');
          if (
            !member.legacySource.retired &&
            !coversGrants(tx.access, [
              {
                sourceId: member.id,
                permissions: member.legacySource.permissions,
                scope: { kind: 'company' },
              },
            ])
          )
            denied();
        }
        out.proposed = proposed;
      } else {
        ceiling(tx.access, member.assignments);
        if (
          member.legacySource &&
          !member.legacySource.retired &&
          !coversGrants(tx.access, [
            {
              sourceId: member.id,
              permissions: member.legacySource.permissions,
              scope: { kind: 'company' },
            },
          ])
        )
          denied();
        out.proposed = member.assignments;
      }
      return out;
    }
    let before: Awaited<ReturnType<InvitationService['readInTransaction']>> | undefined;
    if (command.operation !== 'invitation.issue') {
      if (!('id' in command) || !('expectedGeneration' in command)) return conflict();
      before = await this.invitations.readInTransaction(tx.db, tx.tenant, command.id);
      if (
        before.version !== command.expectedVersion ||
        before.generation !== command.expectedGeneration
      )
        conflict('version');
      if (!['pending', 'needs_reapproval'].includes(before.state)) conflict('state');
      ceiling(tx.access, before.assignments);
      out.invitations = [before.id];
    }
    out.proposed = (
      await this.invitations.reviewInTransaction(tx.db, tx.tenant, tx.actor, command)
    ).assignments;
    out.snapshot = before
      ? {
          id: before.id,
          version: before.version,
          generation: before.generation,
          state: before.state,
          approval: before.approval,
          assignments: before.assignments,
        }
      : null;
    out.confirmation = command.operation !== 'invitation.cancel';
    return out;
  }
  private bound(command: Command, assessment: Assessment) {
    return hash({
      command,
      snapshot: assessment.snapshot,
      proposed: assessment.proposed.map((a) => ({ role: a.role, scope: a.scope })),
      members: assessment.members,
      invitations: assessment.invitations,
    });
  }
  private async confirm(
    tx: PeopleTransaction,
    command: Command,
    assessment: Assessment,
    confirmation: string | null,
  ) {
    if (!assessment.confirmation) return;
    if (!confirmation) conflict('impact_stale');
    const proof = await tx.db.query(
      `SELECT 1 FROM turnstile.access_impact_receipt WHERE tenant_id=$1 AND actor_id=$2 AND token_hash=$3 AND command_digest=$4 AND actor_fingerprint=$5 AND access_revision=$6 AND organization_revision=$7 AND expires_at>clock_timestamp()`,
      [
        tx.tenant,
        tx.actor.userId,
        hash(confirmation),
        this.bound(command, assessment),
        tx.access.context.fingerprint,
        tx.access.context.accessRevision,
        tx.organizationRevision,
      ],
    );
    if (!proof.rowCount) conflict('impact_stale');
  }
  async preview(actor: ConfigurationActor, input: unknown) {
    const command = canonicalCommand(peopleParse(impactReviewRequestSchema, input).command);
    return this.store.run(actor, this.policy(command), async (tx) => {
      const assessment = await this.assess(tx, command),
        token = randomBytes(32).toString('base64url');
      const expires = (
        await tx.db.query<{ expires: Date }>(
          'SELECT turnstile.save_structure_impact($1,$2,$3,$4,$5,$6,$7,$8) AS expires',
          [
            tx.tenant,
            actor.userId,
            randomUUID(),
            hash(token),
            this.bound(command, assessment),
            tx.access.context.fingerprint,
            tx.access.context.accessRevision,
            tx.organizationRevision,
          ],
        )
      ).rows[0]?.expires;
      const base = {
        actorId: actor.userId,
        commandDigest: hash(command),
        accessRevision: tx.access.context.accessRevision,
        organizationRevision: tx.organizationRevision,
        confirmation: token,
        expiresAt: expires?.toISOString(),
      };
      return impactReviewSchema.parse(
        covers(tx.access, 'turnstile:people:manage', { kind: 'company' })
          ? {
              ...base,
              visibility: 'people',
              affectedMemberIds: assessment.members.slice(0, 100),
              affectedInvitationIds: assessment.invitations.slice(0, 100),
              memberCount: assessment.members.length,
              invitationCount:
                command.operation === 'invitation.issue' ? 1 : assessment.invitations.length,
              assignments: assessment.proposed,
            }
          : { ...base, visibility: 'definitions', roles: assessment.roles },
      );
    });
  }
  async execute(
    actor: ConfigurationActor,
    keyInput: unknown,
    input: unknown,
    expectedOperation?: string,
    pathId?: string,
  ) {
    const key = peopleParse(peopleIdSchema, keyInput),
      request = peopleParse(peopleMutationRequestSchema, input),
      command = canonicalCommand(request.command);
    if (
      (expectedOperation && command.operation !== expectedOperation) ||
      (pathId && (!('id' in command) || command.id !== peopleParse(peopleIdSchema, pathId)))
    )
      return peopleFailure(400, 'PEOPLE_INVALID', {
        fieldErrors: [{ field: 'body', reason: 'invalid' }],
      });
    const replay = await this.store.run(actor, this.policy(command), async (tx) => {
      const receipt = await this.receipt(tx, key, command);
      if (
        receipt &&
        (!command.operation.startsWith('invitation.') ||
          (
            await tx.db.query(
              "SELECT 1 FROM turnstile.invitation_operation WHERE tenant_id=$1 AND actor_id=$2 AND key=$3 AND state='completed'",
              [tx.tenant, actor.userId, key],
            )
          ).rowCount)
      )
        return this.result(tx, key, receipt, true);
      await this.requireOpen(tx);
      await this.confirm(tx, command, await this.assess(tx, command), request.confirmation);
      return undefined;
    });
    if (replay) return replay;
    if (command.operation === 'invitation.issue' || command.operation === 'invitation.reapprove')
      await this.reader.recycledAddress(actor, command.email);
    if (command.operation === 'member.reactivate') {
      const member = await this.store.run(actor, 'people', (tx) =>
        memberRow(tx.db, tx.tenant, command.id),
      );
      if (member.status === 'suspended') {
        let response: Awaited<ReturnType<IdentityClientService['projectMembers']>>;
        try {
          response = await this.identity.projectMembers(actor, [member.id]);
        } catch {
          return peopleFailure(503, 'PEOPLE_UNAVAILABLE', { reason: 'dependency' });
        }
        if (response.subjects[0]?.state !== 'present' || !response.subjects[0].emailVerified)
          conflict('state');
      }
    }
    if (command.operation.startsWith('invitation.')) {
      let finalized = false;
      await this.invitations.execute(actor, key, command, async (db, tenant) => {
        const access = await readAccess(db, tenant, actor.userId),
          org = (
            await db.query(
              'SELECT revision FROM turnstile.organization_configuration WHERE tenant_id=$1',
              [tenant],
            )
          ).rows[0];
        const tx = { db, tenant, actor, access, organizationRevision: org.revision };
        await this.requireOpen(tx);
        await this.confirm(tx, command, await this.assess(tx, command), request.confirmation);
        if (
          command.operation === 'invitation.issue' ||
          command.operation === 'invitation.reapprove'
        ) {
          if (
            (
              await db.query(
                `SELECT 1 FROM turnstile.access_member m JOIN turnstile.member_display d ON d.tenant_id=m.tenant_id AND d.member_id=m.id WHERE m.tenant_id=$1 AND m.status='active' AND d.state='deleted' AND (d.email=$2 OR d.email IS NULL) LIMIT 1`,
                [tenant, command.email],
              )
            ).rowCount
          )
            conflict('membership_exists');
        }
        // The owner skips this callback for a completed reservation. After execute
        // succeeds, this distinguishes our commit from a concurrent command replay.
        finalized = true;
      });
      return this.store.run(actor, 'people', async (tx) => {
        const receipt = await this.receipt(tx, key, command);
        if (!receipt) throw new Error('Missing receipt');
        return this.result(tx, key, receipt, !finalized);
      });
    }
    return this.store.run(actor, this.policy(command), async (tx) => {
      const previous = await this.receipt(tx, key, command);
      if (previous) return this.result(tx, key, previous, true);
      await this.requireOpen(tx);
      const assessment = await this.assess(tx, command);
      await this.confirm(tx, command, assessment, request.confirmation);
      const name = 'name' in command && command.name ? configurationNameKey(command.name) : null;
      await tx.db.query('SELECT turnstile.apply_people_command($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
        tx.tenant,
        actor.userId,
        key,
        hash(command),
        command,
        randomUUID(),
        name,
        actor.requestId,
        request.confirmation ? hash(request.confirmation) : null,
        this.bound(command, assessment),
      ]);
      tx.access = await readAccess(tx.db, tx.tenant, actor.userId);
      const receipt = await this.receipt(tx, key, command);
      if (!receipt) throw new Error('Missing command result');
      return this.result(tx, key, receipt, false, true);
    });
  }
}
