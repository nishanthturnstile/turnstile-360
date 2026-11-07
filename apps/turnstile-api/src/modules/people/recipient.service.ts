import { randomUUID } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';
import {
  invitationAcceptanceResultSchema,
  invitationAcceptSchema,
  invitationExchangeSchema,
  PEOPLE_LIMITS,
  type RestrictedInvitationContextDto,
  recipientActionSchema,
  recipientReviewSchema,
  recipientSwitchSchema,
  restrictedInvitationContextSchema,
} from '@thaarei/turnstile-contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { IdentityClientService } from '../../integrations/identity/identity-client.service.js';
import { hasShell, readAccess } from '../access/access-evaluator.js';
import { featureWritesOpen } from '../access/release-state.js';
import type { InvitationContinuation } from '../auth/browser-auth/bff-state.js';
import { opaque } from '../auth/browser-auth/bff-state.js';
import { BrowserAuthService } from '../auth/browser-auth/browser-auth.service.js';
import type { DeploymentMode } from '../deployment/access.js';
import { type InvitationRow, InvitationService } from './invitation.service.js';
import { hash, invitationAudit } from './invitation-policy.js';
import { InvitationStoreService } from './invitation-store.service.js';

const fail = (status: number, code: string, extra: object = {}): never => {
  throw new HttpException({ code, ...extra }, status);
};
const conflict = () => fail(409, 'INVITATION_CONFLICT', { reason: 'state' });
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    return fail(400, 'INVITATION_INVALID_REQUEST', {
      fieldErrors: [{ field: 'body', reason: 'invalid' }],
    });
  return result.data;
}

@Injectable()
export class RecipientService {
  constructor(
    private readonly store: InvitationStoreService,
    private readonly invitations: InvitationService,
    private readonly auth: BrowserAuthService,
    private readonly authority: IdentityClientService,
  ) {}

  private run<T>(
    request: FastifyRequest,
    work: (
      db: PoolClient,
      tenant: string,
      config: NonNullable<InvitationStoreService['config']>,
    ) => Promise<T>,
    deployment: DeploymentMode = 'recovery',
  ) {
    return this.store.run(
      async (db, tenant, config) => {
        if (!(await featureWritesOpen(db, tenant)))
          return fail(503, 'INVITATION_UNAVAILABLE_RETRY', { reason: 'readiness' });
        return work(db, tenant, config);
      },
      undefined,
      request.recipientDeadlineAt,
      deployment,
    );
  }

  // Persist independently of lookup success: invalid guesses cannot roll back budgets.
  private async budget(request: FastifyRequest, digest: string) {
    const permitted = await this.run(request, async (db, tenant) => {
      // Bound metadata growth as well as attempts. Old public buckets have no
      // bearing on current limits; retire a bounded batch on this owning path.
      await db.query(
        `DELETE FROM turnstile.invitation_rate WHERE ctid IN (SELECT ctid FROM turnstile.invitation_rate
        WHERE tenant_id=$1 AND actor LIKE 'public:%' AND "window"<date_trunc('minute',statement_timestamp()) LIMIT 1000)`,
        [tenant],
      );
      const count =
        (
          await db.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM turnstile.invitation_rate WHERE tenant_id=$1 AND actor LIKE 'public:%'`,
            [tenant],
          )
        ).rows[0]?.n ?? 0;
      if (count >= PEOPLE_LIMITS.publicRateBuckets) return 'capacity' as const;
      for (const key of [`public:ip:${hash(request.ip)}`, `public:digest:${digest}`]) {
        const row = (
          await db.query<{ count: number }>(
            `INSERT INTO turnstile.invitation_rate(tenant_id,actor,"window",count)
          VALUES($1,$2,date_trunc('minute',statement_timestamp()),1)
          ON CONFLICT(tenant_id,actor,"window") DO UPDATE SET count=least(turnstile.invitation_rate.count+1,11) RETURNING count`,
            [tenant, key],
          )
        ).rows[0];
        if (!row || row.count > PEOPLE_LIMITS.publicAttemptsPerMinute) return false;
      }
      return true;
    });
    if (permitted === 'capacity')
      return fail(503, 'INVITATION_UNAVAILABLE_RETRY', { reason: 'capacity' });
    if (!permitted) fail(429, 'INVITATION_RATE_LIMITED', { retryAfterSeconds: 60 });
  }

  async exchange(request: FastifyRequest) {
    const config = this.store.config;
    if (!config) return fail(503, 'INVITATION_UNAVAILABLE_RETRY', { reason: 'readiness' });
    if (
      request.headers.origin !== config.AUTH_PUBLIC_ORIGIN ||
      (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')
    )
      fail(403, 'CSRF_REJECTED');
    this.query(request);
    const input = request.body as { credential?: unknown } | undefined;
    const digest = hash(typeof input?.credential === 'string' ? input.credential : 'invalid');
    await this.budget(request, digest);
    const { credential } = parse(invitationExchangeSchema, request.body);
    const binding = await this.invitations.credential(credential);
    const expiresAt = await this.run(request, async (db, tenant) => {
      const row = (
        await db.query<{ expires_at: Date }>(
          'SELECT expires_at FROM turnstile.invitation WHERE tenant_id=$1 AND id=$2',
          [tenant, binding.invitationId],
        )
      ).rows[0];
      if (!row) return fail(410, 'INVITATION_UNAVAILABLE');
      return Math.min(row.expires_at.getTime(), Date.now() + 1800000);
    });
    await this.auth.installInvitation(request, {
      id: randomUUID(),
      invitationId: binding.invitationId,
      generation: binding.generation,
      recoveryEpoch: config.recoveryEpoch,
      credentialDigest: digest,
      csrf: opaque(),
      expiresAt,
      setupOperationId: randomUUID(),
    });
    return this.context(request);
  }
  private query(request: FastifyRequest) {
    if (new URL(request.url, 'http://localhost').search)
      fail(400, 'INVITATION_INVALID_REQUEST', {
        fieldErrors: [{ field: 'body', reason: 'invalid' }],
      });
  }
  private async flow(request: FastifyRequest, mutation = false) {
    this.query(request);
    let flow: InvitationContinuation;
    try {
      flow = await this.auth.invitation(request, mutation);
    } catch (error) {
      if (error instanceof HttpException && [401, 403].includes(error.getStatus()))
        await this.budget(request, hash('invalid_continuation'));
      throw error;
    }
    if (mutation || request.method === 'GET') await this.budget(request, flow.credentialDigest);
    return flow;
  }
  private action(request: FastifyRequest, flow: InvitationContinuation, switching = false) {
    const command = parse(switching ? recipientSwitchSchema : recipientActionSchema, request.body);
    if (
      command.invitationId !== flow.invitationId ||
      command.expectedGeneration !== flow.generation
    )
      conflict();
    return command;
  }
  private async load(db: PoolClient, tenant: string, flow: InvitationContinuation, epoch: string) {
    const row = (
      await db.query<
        InvitationRow & { valid: boolean; permission_digest: string; scope_digest: string }
      >(
        `SELECT i.*, i.expires_at<=clock_timestamp() AS expired,
       turnstile.invitation_approval_valid(i.tenant_id,i.id) AS valid,
       g.approval->>'permissionDigest' AS permission_digest,g.approval->>'scopeDigest' AS scope_digest
       FROM turnstile.invitation i LEFT JOIN turnstile.invitation_generation g
       ON g.tenant_id=i.tenant_id AND g.invitation_id=i.id AND g.generation=i.generation AND g.id=i.approval_id
       WHERE i.tenant_id=$1 AND i.id=$2 FOR UPDATE OF i`,
        [tenant, flow.invitationId],
      )
    ).rows[0];
    if (!row || flow.recoveryEpoch !== epoch || row.recovery_epoch !== epoch)
      return fail(410, 'INVITATION_UNAVAILABLE');
    return row;
  }
  private unavailable(row: InvitationRow & { valid: boolean }, flow: InvitationContinuation) {
    if (row.state === 'cancelled' || row.state === 'expired' || row.state === 'needs_reapproval')
      return row.state;
    if (row.expired && row.state !== 'accepted') return 'expired' as const;
    if (row.generation !== flow.generation || (row.state === 'pending' && !row.valid))
      return 'needs_reapproval' as const;
    return undefined;
  }
  private async review(
    db: PoolClient,
    tenant: string,
    row: Awaited<ReturnType<RecipientService['load']>>,
  ) {
    const anchors = [
      ...new Set(row.assignments.flatMap((a) => (a.scope.kind === 'units' ? a.scope.unitIds : []))),
    ];
    // Only the approved anchors and their ancestor labels leave the server.
    const scopeContext = [];
    for (const id of anchors) {
      const chain = (
        await db.query<{
          id: string;
          type: 'organization' | 'site' | 'department';
          name: string;
          parent_id: string | null;
        }>(
          `WITH RECURSIVE path AS (SELECT id,type,name,parent_id,0 AS depth FROM turnstile.organization_unit WHERE tenant_id=$1 AND id=$2
         UNION ALL SELECT u.id,u.type,u.name,u.parent_id,p.depth+1 FROM turnstile.organization_unit u JOIN path p ON u.id=p.parent_id WHERE u.tenant_id=$1 AND p.depth<8)
         SELECT id,type,coalesce(name,(SELECT name FROM turnstile.organization_configuration WHERE tenant_id=$1)) AS name,parent_id FROM path ORDER BY depth DESC`,
          [tenant, id],
        )
      ).rows;
      const unit = chain.at(-1);
      if (!unit?.parent_id || unit.type === 'organization') return conflict();
      const ancestors = chain
        .slice(0, -1)
        .map((u) => ({ id: u.id, type: u.type, name: u.name, actionable: false as const }));
      scopeContext.push({
        unit: {
          id: unit.id,
          type: unit.type,
          parentId: unit.parent_id,
          name: unit.name,
          ancestorIds: ancestors.map((u) => u.id),
        },
        ancestors,
      });
    }
    const workspace = (
      await db.query('SELECT name FROM turnstile.organization_configuration WHERE tenant_id=$1', [
        tenant,
      ])
    ).rows[0];
    if (!workspace?.name) return fail(409, 'SETUP_REQUIRED');
    return recipientReviewSchema.parse({
      invitationId: row.id,
      version: row.version,
      generation: row.generation,
      expiresAt: row.expires_at.toISOString(),
      workspaceName: workspace.name,
      addressedEmail: row.email,
      assignments: row.assignments,
      scopeContext,
      permissionDigest: row.permission_digest,
      scopeDigest: row.scope_digest,
    });
  }
  async context(request: FastifyRequest): Promise<RestrictedInvitationContextDto> {
    const flow = await this.flow(request);
    const identity = flow.identity ? await this.auth.invitationIdentity(request, flow) : undefined;
    return this.run(request, async (db, tenant, config) => {
      const row = await this.load(db, tenant, flow, config.recoveryEpoch);
      const base = {
        kind: 'invitation' as const,
        action: {
          invitationId: row.id,
          expectedVersion: row.version,
          expectedGeneration: flow.generation,
        },
        csrfToken: flow.csrf,
        expiresAt: new Date(
          Math.min(
            flow.expiresAt,
            flow.identity?.expiresAt ?? flow.expiresAt,
            row.state === 'accepted' ? flow.expiresAt : row.expires_at.getTime(),
          ),
        ).toISOString(),
      };
      const unavailable = this.unavailable(row, flow);
      if (unavailable)
        return restrictedInvitationContextSchema.parse({
          ...base,
          phase: 'unavailable',
          state: unavailable,
        });
      if (row.state === 'accepted') {
        if (!identity || row.accepted_user_id !== identity.user.id)
          return fail(410, 'INVITATION_UNAVAILABLE');
        const access = await readAccess(db, tenant, identity.user.id);
        if (!access.memberId || !access.status) return fail(410, 'INVITATION_UNAVAILABLE');
        return restrictedInvitationContextSchema.parse({
          ...base,
          phase: 'accepted',
          memberId: access.memberId,
          membershipStatus: access.status,
          canEnter: hasShell(access),
        });
      }
      if (identity && identity.user.email.toLowerCase() !== row.email)
        return restrictedInvitationContextSchema.parse({
          ...base,
          phase: 'unavailable',
          state: 'identity_mismatch',
        });
      if (identity) {
        const member = (
          await db.query(
            'SELECT status FROM turnstile.access_member WHERE tenant_id=$1 AND user_id=$2',
            [tenant, identity.user.id],
          )
        ).rows[0];
        if (member)
          return restrictedInvitationContextSchema.parse({
            ...base,
            phase: 'unavailable',
            state: member.status === 'suspended' ? 'membership_suspended' : 'membership_exists',
          });
      }
      const review = await this.review(db, tenant, row);
      return restrictedInvitationContextSchema.parse({
        ...base,
        phase: identity ? 'verified' : 'identity_required',
        review,
        ...(identity ? { user: { id: identity.user.id, email: row.email } } : {}),
      });
    });
  }
  private async current(
    request: FastifyRequest,
    flow: InvitationContinuation,
    command: z.infer<typeof recipientActionSchema>,
  ) {
    return this.run(request, async (db, tenant, config) => {
      await this.auth.fenceInvitation(db, request, flow);
      const row = await this.load(db, tenant, flow, config.recoveryEpoch);
      if (
        this.unavailable(row, flow) ||
        row.state !== 'pending' ||
        row.version !== command.expectedVersion
      )
        return conflict();
      return row;
    });
  }
  async start(request: FastifyRequest) {
    const flow = await this.flow(request, true);
    await this.current(request, flow, this.action(request, flow));
    return { destination: '/api/auth/login' as const };
  }
  async setup(request: FastifyRequest) {
    const flow = await this.flow(request, true);
    const command = this.action(request, flow);
    const row = await this.current(request, flow, command);
    let prepared: Awaited<ReturnType<IdentityClientService['prepare']>>;
    try {
      try {
        prepared = await this.authority.preparation(flow.setupOperationId);
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            'code' in error &&
            error.code === 'IDENTITY_SERVICE_NOT_FOUND'
          )
        )
          throw error;
        prepared = await this.authority.prepare({
          operationId: flow.setupOperationId,
          invitationId: row.id,
          generation: row.generation,
          email: row.email,
          expiresAt: new Date(Math.min(row.expires_at.getTime(), flow.expiresAt)).toISOString(),
        });
      }
    } catch {
      return fail(503, 'INVITATION_UNAVAILABLE_RETRY', { reason: 'dependency' });
    }
    await this.current(request, flow, command);
    if (prepared.invitationId !== row.id || prepared.generation !== row.generation)
      return conflict();
    if (prepared.state !== 'authorized') return fail(410, 'INVITATION_UNAVAILABLE');
    return {
      destination: '/identity/invitation-setup/exchange' as const,
      receipt: prepared.setupReceipt,
    };
  }
  async accept(request: FastifyRequest) {
    const flow = await this.flow(request, true);
    const command = parse(invitationAcceptSchema, request.body);
    if (
      command.invitationId !== flow.invitationId ||
      command.expectedGeneration !== flow.generation
    )
      return conflict();
    const identity = await this.auth.invitationIdentity(request, flow);
    const result = await this.run(
      request,
      async (db, tenant, config) => {
        // Access lock, invitation transition, then encrypted session row lock. No HTTP under locks.
        const row = await this.load(db, tenant, flow, config.recoveryEpoch);
        await this.auth.fenceInvitation(db, request, flow, identity.sid);
        if (row.state !== 'accepted' && identity.user.email.toLowerCase() !== row.email)
          return fail(403, 'INVITATION_IDENTITY_MISMATCH');
        if (
          row.state !== 'accepted' &&
          (this.unavailable(row, flow) || row.version !== command.expectedVersion)
        )
          return conflict();
        const member = (
          await db.query<{ id: string | null }>(
            'SELECT turnstile.accept_invitation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS id',
            [
              tenant,
              row.id,
              flow.generation,
              command.expectedVersion,
              identity.user.id,
              identity.user.email.toLowerCase(),
              config.recoveryEpoch,
              command.permissionDigest,
              command.scopeDigest,
              request.id,
            ],
          )
        ).rows[0]?.id;
        if (!member) return conflict();
        await this.auth.markInvitationAccepted(db, request, flow);
        const access = await readAccess(db, tenant, identity.user.id);
        if (!access.memberId || !access.status) return conflict();
        return {
          invitationId: row.id,
          memberId: member,
          userId: identity.user.id,
          membershipStatus: access.status,
          accessRevision: access.context.accessRevision,
          session: hasShell(access) ? ('login_required' as const) : ('denied' as const),
        };
      },
      'full',
    );
    if (result.session === 'login_required') {
      try {
        await this.auth.establishInvitation(request, flow);
        return invitationAcceptanceResultSchema.parse({ ...result, session: 'established' });
      } catch {
        /* Membership is already durable. Explicit retry or ordinary login reads current grants. */
      }
    }
    return invitationAcceptanceResultSchema.parse(result);
  }
  async decline(request: FastifyRequest) {
    const flow = await this.flow(request, true);
    const command = this.action(request, flow);
    await this.run(request, async (db, tenant, config) => {
      const row = await this.load(db, tenant, flow, config.recoveryEpoch);
      await this.auth.fenceInvitation(db, request, flow);
      if (
        row.state !== 'pending' ||
        row.generation !== flow.generation ||
        row.version !== command.expectedVersion ||
        this.unavailable(row, flow)
      )
        return conflict();
      await db.query(
        `UPDATE turnstile.invitation SET state='cancelled',version=version+1,generation=generation+1,
        approval_id=NULL,cancelled_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2`,
        [tenant, row.id],
      );
      await db.query(
        `UPDATE turnstile.invitation_delivery SET state='failed',payload=NULL,reason='cancelled',outcome_at=statement_timestamp(),lease_id=NULL,lease_expires_at=NULL WHERE tenant_id=$1 AND invitation_id=$2 AND state IN ('queued','sending')`,
        [tenant, row.id],
      );
      await db.query(
        'DELETE FROM turnstile.invitation_reference WHERE tenant_id=$1 AND invitation_id=$2',
        [tenant, row.id],
      );
      await invitationAudit(db, tenant, row.id, row.generation + 1, 'declined');
    });
    return this.context(request);
  }
  async cancel(request: FastifyRequest) {
    const flow = await this.flow(request, true);
    this.action(request, flow);
    await this.auth.cancelInvitation(request, flow);
    return { local: 'complete' as const, authority: 'complete' as const };
  }
  async switchAccount(request: FastifyRequest, reply: FastifyReply) {
    const flow = await this.flow(request, true);
    this.action(request, flow, true);
    return this.auth.endInvitationParent(request, reply, flow);
  }
}
