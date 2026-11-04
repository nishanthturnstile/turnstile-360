import { type ChildProcess, fork } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { type ConfigurationSnapshotDto, type InvitationDto } from '@thaarei/turnstile-contracts';
import { Pool, type PoolClient } from 'pg';
import { createApplication } from '../src/bootstrap.js';
import { pruneInvitationRecords } from '../src/infrastructure/database/invitation-maintenance.js';
import { INVITATION_TABLES } from '../src/infrastructure/database/invitation-safety.js';
import { withTenant } from '../src/infrastructure/database/postgres.js';
import { ProductPersistenceService } from '../src/infrastructure/database/product-persistence.service.js';
import { IdentityClientService } from '../src/integrations/identity/identity-client.service.js';
import { accessOperator } from '../src/modules/access/access-operator.js';
import { releaseOperator } from '../src/modules/access/release-operator.js';
import { OrganizationService } from '../src/modules/organization/organization.service.js';
import { StructureCommandsService } from '../src/modules/organization/structure-commands.service.js';
import { InvitationService } from '../src/modules/people/invitation.service.js';
import { openPayload } from '../src/modules/people/invitation-crypto.js';
import { InvitationDeliveryService } from '../src/modules/people/invitation-delivery.service.js';
import { InvitationMailService } from '../src/modules/people/invitation-mail.service.js';
import { InvitationStoreService } from '../src/modules/people/invitation-store.service.js';
import { OwningStructureInvitations } from '../src/modules/people/invitation-structure-policy.js';
import { openAccessFixture, resetAccessFixture } from './access-fixture.js';
import { invitationSmtpFixture } from './invitation-smtp-fixture.js';

describe('invitation approvals and durable delivery on PostgreSQL with real authority HTTP/SMTP', () => {
  const tenant = process.env.INSTALLATION_TENANT_ID as string;
  const owner = new Pool({ connectionString: process.env.TURNSTILE_MIGRATION_DATABASE_URL });
  let child: ChildProcess;
  let fixture: {
    port: number;
    secret: string;
    users: Record<string, { id: string; email: string }>;
  };
  let smtp: Awaited<ReturnType<typeof invitationSmtpFixture>>;
  let app: Awaited<ReturnType<typeof createApplication>>;
  let persistence: ProductPersistenceService;
  let store: InvitationStoreService;
  let service: InvitationService;
  let worker: InvitationDeliveryService;
  let organization: OrganizationService;
  let snapshot: ConfigurationSnapshotDto;
  let role: string;
  let roleVersion: number;
  let site: string;
  let department: string;
  let other: string;
  const actor = () => ({ userId: fixture.users.operator?.id ?? '', requestId: randomUUID() });
  const owned = <T>(work: (db: PoolClient) => Promise<T>) => withTenant(owner, tenant, work);
  async function versions() {
    return owned(async (db) => {
      const r = (
        await db.query(
          'SELECT a.revision,o.revision AS org FROM turnstile.access_context a JOIN turnstile.organization_configuration o USING(tenant_id) WHERE a.tenant_id=$1',
          [tenant],
        )
      ).rows[0];
      return {
        expectedAccessRevision: r.revision as number,
        expectedOrganizationRevision: r.org as number,
      };
    });
  }
  async function issue(
    email = `recipient-${randomUUID()}@example.test`,
    key = randomUUID(),
    unit?: string,
  ) {
    const command = {
      operation: 'invitation.issue',
      ...(await versions()),
      email,
      assignments: [
        {
          roleId: role,
          expectedRoleVersion: roleVersion,
          scope: unit
            ? { kind: 'units', unitIds: [unit], includeChildren: true }
            : { kind: 'company' },
        },
      ],
    };
    return { result: await service.execute(actor(), key, command), key, command };
  }
  async function resend(row: InvitationDto) {
    return service.execute(actor(), randomUUID(), {
      operation: 'invitation.resend',
      ...(await versions()),
      id: row.id,
      expectedVersion: row.version,
      expectedGeneration: row.generation,
    });
  }
  async function cancel(row: InvitationDto) {
    return service.execute(actor(), randomUUID(), {
      operation: 'invitation.cancel',
      expectedAccessRevision: (await versions()).expectedAccessRevision,
      id: row.id,
      expectedVersion: row.version,
      expectedGeneration: row.generation,
    });
  }
  const state = (id: string) =>
    owned(
      async (db) =>
        (
          await db.query(
            'SELECT * FROM turnstile.invitation_delivery WHERE tenant_id=$1 AND invitation_id=$2 ORDER BY generation',
            [tenant, id],
          )
        ).rows,
    );
  beforeAll(async () => {
    smtp = await invitationSmtpFixture();
    child = fork(
      fileURLToPath(new URL('../../dms-api/test/identity-authority-fixture.mjs', import.meta.url)),
      [],
      {
        env: { ...process.env, IDENTITY_FIXTURE_NAMESPACE: 'invitations' },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      },
    );
    fixture = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Authority timeout')), 25000);
      child.on('message', (m) => {
        if ((m as { ready?: boolean }).ready) {
          clearTimeout(timer);
          resolve(m as typeof fixture);
        }
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('Authority fixture exited'));
      });
    });
    // Application composition stays staged, so its lifecycle cannot race explicitly controlled delivery.
    app = await createApplication(false);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    persistence = app.get(ProductPersistenceService);
    organization = app.get(OrganizationService);
    vi.stubEnv('IDENTITY_SERVICE_CLIENT_ID', 'invitations-fixture-service');
    vi.stubEnv('IDENTITY_SERVICE_CLIENT_SECRET', fixture.secret);
    vi.stubEnv(
      'IDENTITY_SERVICE_RESOURCE_URL',
      `${process.env.AUTH_PUBLIC_ORIGIN}/identity/services/accounts`,
    );
    vi.stubEnv('IDENTITY_SERVICE_API_URL', `http://127.0.0.1:${fixture.port}`);
    vi.stubEnv('TURNSTILE_INVITATION_ENCRYPTION_KEY', randomBytes(32).toString('hex'));
    vi.stubEnv('TURNSTILE_INVITATION_RECOVERY_EPOCH', randomBytes(32).toString('base64url'));
    vi.stubEnv('TURNSTILE_SMTP_HOST', '127.0.0.1');
    vi.stubEnv('TURNSTILE_MAIL_FROM', 'turnstile@example.test');
    vi.stubEnv('TURNSTILE_SMTP_PORT', String(smtp.port));
    store = new InvitationStoreService(persistence);
    service = new InvitationService(store, new IdentityClientService(persistence));
  });
  async function rpc(action: string) {
    const requestId = randomUUID();
    const response = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fixture RPC timeout')), 5000);
      const listener = (message: unknown) => {
        const value = message as { requestId?: string; ok?: boolean };
        if (value.requestId === requestId) {
          clearTimeout(timer);
          child.off('message', listener);
          if (value.ok) resolve();
          else reject(new Error('Fixture RPC failure'));
        }
      };
      child.on('message', listener);
    });
    child.send?.({ action, requestId });
    return response;
  }
  beforeEach(async () => {
    await rpc('clear-limits');
    await owner.query(
      `TRUNCATE ${INVITATION_TABLES.map((n) => `turnstile.${n}`).join(',')} CASCADE`,
    );
    await resetAccessFixture(owner, [
      {
        userId: actor().userId,
        permissions: ['turnstile:access', 'turnstile:configuration:manage'],
      },
    ]);
    snapshot = await organization.save(actor(), {
      expectedRevision: 0,
      name: 'Invitation fixture',
      timeZone: 'UTC',
    });
    const first = await organization.createUnit(
      actor(),
      {
        expectedRevision: snapshot.revision,
        parentId: snapshot.organization.rootId,
        type: 'site',
        name: 'Site A',
      },
      randomUUID(),
    );
    snapshot = first.configuration;
    site = first.unitId;
    const child = await organization.createUnit(
      actor(),
      {
        expectedRevision: snapshot.revision,
        parentId: site,
        type: 'department',
        name: 'Department',
      },
      randomUUID(),
    );
    snapshot = child.configuration;
    department = child.unitId;
    const second = await organization.createUnit(
      actor(),
      {
        expectedRevision: snapshot.revision,
        parentId: snapshot.organization.rootId,
        type: 'site',
        name: 'Site B',
      },
      randomUUID(),
    );
    snapshot = second.configuration;
    other = second.unitId;
    snapshot = await organization.complete(actor(), { expectedRevision: snapshot.revision });
    await openAccessFixture(owner);
    await owned(async (db) => {
      await db.query(
        `INSERT INTO turnstile.access_assignment (tenant_id,id,member_id,role_id,scope_kind,include_children,scope_key) SELECT m.tenant_id,$2,m.id,r.id,'company',false,'company' FROM turnstile.access_member m JOIN turnstile.access_role r ON r.tenant_id=m.tenant_id AND r.system_key='workspace_administrator' WHERE m.tenant_id=$1 AND m.user_id=$3`,
        [tenant, randomUUID(), actor().userId],
      );
      const r = (
        await db.query(
          "SELECT id,version FROM turnstile.access_role WHERE tenant_id=$1 AND system_key='unit_manager'",
          [tenant],
        )
      ).rows[0];
      role = r.id;
      roleVersion = r.version;
    });
    vi.stubEnv('TURNSTILE_SMTP_PORT', String(smtp.port));
    smtp.setMode('accept');
    store = new InvitationStoreService(persistence);
    service = new InvitationService(store, new IdentityClientService(persistence));
    worker = new InvitationDeliveryService(store, new InvitationMailService());
  });
  afterAll(async () => {
    await owner.query(
      `TRUNCATE ${INVITATION_TABLES.map((n) => `turnstile.${n}`).join(',')} CASCADE`,
    );
    await app?.close();
    await owner.end();
    await smtp?.close();
    if (child?.connected) {
      const done = once(child, 'exit');
      child.kill('SIGTERM');
      await done;
    }
    vi.unstubAllEnvs();
  });
  it('durably issues and replays the same receipt without another generation, rate charge, account or mail', async () => {
    const value = await issue('Mixed.Address@example.test');
    expect(value.result.email).toBe('mixed.address@example.test');
    expect(value.result.delivery?.state).toBe('queued');
    const before = await state(value.result.id);
    expect(before[0].payload).not.toContain('#');
    expect(before[0].payload).not.toContain(value.result.email);
    expect(await service.execute(actor(), value.key, value.command)).toEqual(value.result);
    expect(await service.readback(actor(), value.key)).toEqual(value.result);
    expect(await state(value.result.id)).toEqual(before);
    expect(
      (
        await owned((db) =>
          db.query(
            'SELECT sum(count)::int AS count FROM turnstile.invitation_rate WHERE tenant_id=$1',
            [tenant],
          ),
        )
      ).rows[0].count,
    ).toBe(2);
    await expect(
      service.execute(actor(), value.key, { ...value.command, email: 'different@example.test' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(issue('MIXED.ADDRESS@example.test')).rejects.toMatchObject({ status: 409 });
    expect(smtp.messages).toHaveLength(0);
  });
  it('uses real separate-process identity reconciliation to refuse active and suspended existing members', async () => {
    const user = fixture.users.unverified;
    if (!user) throw new Error('Missing user');
    await owned((db) =>
      db.query(
        "INSERT INTO turnstile.access_member (tenant_id,id,user_id,status) VALUES ($1,$2,$3,'active')",
        [tenant, randomUUID(), user.id],
      ),
    );
    await expect(issue(user.email)).rejects.toMatchObject({
      response: { reason: 'membership_exists' },
    });
    await owned((db) =>
      db.query(
        "UPDATE turnstile.access_member SET status='suspended',version=version+1 WHERE tenant_id=$1 AND user_id=$2",
        [tenant, user.id],
      ),
    );
    await expect(issue(user.email)).rejects.toMatchObject({
      response: { reason: 'membership_suspended' },
    });
    expect(
      (
        await owned((db) =>
          db.query('SELECT count(*)::int AS count FROM turnstile.invitation WHERE tenant_id=$1', [
            tenant,
          ]),
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it('sends current generation to real Mailpit and purges the encrypted payload after acceptance', async () => {
    const value = await issue();
    vi.stubEnv('TURNSTILE_SMTP_PORT', process.env.TURNSTILE_TEST_MAILPIT_SMTP_PORT ?? '1');
    const mailpit = new InvitationDeliveryService(store, new InvitationMailService());
    expect(await mailpit.drain()).toBe(1);
    const status = await service.read(actor(), value.result.id);
    expect(status.delivery?.state).toBe('smtp_accepted');
    expect((await state(status.id))[0].payload).toBeNull();
    const messages = (await (
      await fetch(`${process.env.TURNSTILE_TEST_MAILPIT_URL}/api/v1/messages`)
    ).json()) as { messages: { ID: string; To: { Address: string }[] }[] };
    const message = messages.messages.find((m) => m.To.some((r) => r.Address === status.email));
    expect(message).toBeDefined();
    const detail = (await (
      await fetch(`${process.env.TURNSTILE_TEST_MAILPIT_URL}/api/v1/message/${message?.ID}`)
    ).json()) as { Text: string };
    expect(detail.Text.includes(`Generation: ${status.generation}`)).toBe(true);
    expect(detail.Text.includes(status.id)).toBe(true);
    expect(/\/invitations\/join#[A-Za-z0-9_-]{43}/.test(detail.Text)).toBe(true);
    expect(detail.Text.includes('password=')).toBe(false);
    const secret = /\/invitations\/join#([A-Za-z0-9_-]{43})/.exec(detail.Text)?.[1] ?? '';
    expect((await service.credential(secret)).invitationId).toBe(status.id);
    expect(JSON.stringify(status).includes(secret)).toBe(false);
    const audit = await owned((db) =>
      db.query('SELECT * FROM turnstile.invitation_audit WHERE tenant_id=$1', [tenant]),
    );
    expect(JSON.stringify(audit.rows).includes(secret)).toBe(false);
  });
  it('rotates before resend and fences a paused old SMTP worker without holding access locks', async () => {
    const value = await issue();
    const claims = await worker.claim();
    const first = claims[0];
    if (!first) throw new Error('Missing claim');
    const oldSecret = new URL(
      openPayload(
        store.config as NonNullable<typeof store.config>,
        first.invitation_id,
        first.generation,
        first.payload,
      ).link,
    ).hash.slice(1);
    expect((await service.credential(oldSecret)).invitationId).toBe(value.result.id);
    const entered = smtp.pause();
    const sending = worker.deliver(first);
    await entered;
    const newer = await resend(value.result);
    expect(newer.generation).toBe(2);
    await expect(service.credential(oldSecret)).rejects.toMatchObject({ status: 410 });
    smtp.release();
    expect(await sending).toBe(false);
    const rows = await state(newer.id);
    expect(rows[0]).toMatchObject({ state: 'failed', reason: 'stale_generation', payload: null });
    expect(rows[1].state).toBe('queued');
    expect(await worker.drain()).toBe(1);
    expect((await service.read(actor(), newer.id)).delivery?.state).toBe('smtp_accepted');
  });
  it('cancels queued work and retires expired invitations using database time', async () => {
    const value = await issue();
    const cancelled = await cancel(value.result);
    expect(cancelled.state).toBe('cancelled');
    expect(await worker.drain()).toBe(0);
    expect((await state(cancelled.id))[0]).toMatchObject({
      state: 'failed',
      reason: 'cancelled',
      payload: null,
    });
    await expect(resend(cancelled)).rejects.toMatchObject({ status: 409 });
    const expiry = await issue();
    await owned((db) =>
      db.query(
        "UPDATE turnstile.invitation SET created_at=statement_timestamp()-interval '8 days',expires_at=statement_timestamp()-interval '1 second' WHERE tenant_id=$1 AND id=$2",
        [tenant, expiry.result.id],
      ),
    );
    await service.maintain();
    expect((await service.read(actor(), expiry.result.id)).state).toBe('expired');
    expect((await state(expiry.result.id))[0].payload).toBeNull();
  });
  it('reclaims lost leases as unknown without retrying possible acceptance', async () => {
    const value = await issue();
    const claim = (await worker.claim())[0];
    if (!claim) throw new Error('Missing claim');
    await owned((db) =>
      db.query(
        "UPDATE turnstile.invitation_delivery SET lease_expires_at=statement_timestamp()-interval '1 second' WHERE tenant_id=$1 AND invitation_id=$2",
        [tenant, value.result.id],
      ),
    );
    const restarted = new InvitationDeliveryService(store, new InvitationMailService());
    expect(await restarted.drain()).toBe(0);
    expect((await service.read(actor(), value.result.id)).delivery).toMatchObject({
      state: 'unknown',
      reason: 'lease_lost',
    });
    expect(await worker.finish(claim, 'smtp_accepted')).toBe(false);
    expect((await state(value.result.id))[0].payload).toBeNull();
  });
  it('distinguishes definite SMTP rejection from a dropped final acknowledgement and stops retries', async () => {
    const rejected = await issue();
    smtp.setMode('reject');
    await worker.drain();
    expect((await service.read(actor(), rejected.result.id)).delivery).toMatchObject({
      state: 'failed',
      reason: 'smtp_rejected',
    });
    const unknown = await issue();
    smtp.setMode('drop');
    await worker.drain();
    expect((await service.read(actor(), unknown.result.id)).delivery).toMatchObject({
      state: 'unknown',
      reason: 'deadline',
    });
    expect(await worker.drain()).toBe(0);
    expect((await state(unknown.result.id))[0].payload).toBeNull();
  });
  it('requeues only definite unavailable transport with bounded backoff and exhausts five attempts', async () => {
    const value = await issue();
    for (let attempt = 1; attempt <= 5; attempt++) {
      const claim = (await worker.claim())[0];
      if (!claim) throw new Error('Missing claim');
      expect(claim.attempts).toBe(attempt);
      await worker.finish(claim, 'transport_unavailable');
      const row = (await state(value.result.id))[0];
      if (attempt < 5) {
        expect(row.state).toBe('queued');
        expect(row.payload).not.toBeNull();
        await owned((db) =>
          db.query(
            'UPDATE turnstile.invitation_delivery SET next_attempt_at=statement_timestamp() WHERE tenant_id=$1 AND invitation_id=$2',
            [tenant, value.result.id],
          ),
        );
      }
    }
    expect((await service.read(actor(), value.result.id)).delivery).toMatchObject({
      state: 'failed',
      reason: 'attempts_exhausted',
      attempts: 5,
    });
  });
  it('permanently invalidates revoked approvers at the source commit, including revoke then restore before any reader', async () => {
    const value = await issue();
    const assignment = (
      await owned((db) =>
        db.query(
          "SELECT a.id FROM turnstile.access_assignment a JOIN turnstile.access_role r ON r.tenant_id=a.tenant_id AND r.id=a.role_id WHERE a.tenant_id=$1 AND r.system_key='workspace_administrator'",
          [tenant],
        ),
      )
    ).rows[0].id;
    await owned((db) =>
      db.query('DELETE FROM turnstile.access_assignment WHERE tenant_id=$1 AND id=$2', [
        tenant,
        assignment,
      ]),
    );
    await owned((db) =>
      db.query(
        `INSERT INTO turnstile.access_assignment (tenant_id,id,member_id,role_id,scope_kind,include_children,scope_key) SELECT m.tenant_id,$2,m.id,r.id,'company',false,'company' FROM turnstile.access_member m JOIN turnstile.access_role r ON r.tenant_id=m.tenant_id AND r.system_key='workspace_administrator' WHERE m.tenant_id=$1 AND m.user_id=$3`,
        [tenant, assignment, actor().userId],
      ),
    );
    const invalid = await service.read(actor(), value.result.id);
    expect(invalid).toMatchObject({ state: 'needs_reapproval', generation: 2, approval: null });
    expect((await state(invalid.id))[0].payload).toBeNull();
    expect(await worker.drain()).toBe(0);
    const renewed = await service.execute(actor(), randomUUID(), {
      operation: 'invitation.reapprove',
      ...(await versions()),
      id: invalid.id,
      expectedVersion: invalid.version,
      expectedGeneration: invalid.generation,
      email: `reapproved-${randomUUID()}@example.test`,
      assignments: value.command.assignments,
    });
    expect(renewed).toMatchObject({ state: 'pending', generation: 3 });
  });
  it('retains approval for an equivalent atomic grant replacement and harmless role detail changes', async () => {
    const value = await issue();
    await owned(async (db) => {
      const a = (
        await db.query(
          "DELETE FROM turnstile.access_assignment WHERE tenant_id=$1 AND scope_kind='company' RETURNING *",
          [tenant],
        )
      ).rows[0];
      await db.query(
        'INSERT INTO turnstile.access_assignment (tenant_id,id,member_id,role_id,scope_kind,include_children,scope_key) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [tenant, a.id, a.member_id, a.role_id, a.scope_kind, a.include_children, a.scope_key],
      );
    });
    expect((await service.read(actor(), value.result.id)).state).toBe('pending');
  });
  it('coordinates real Structure moves with approval invalidation and atomic rollback', async () => {
    const value = await issue(undefined, undefined, site);
    const policy = new OwningStructureInvitations();
    expect(await owned((db) => policy.references(db, tenant, site))).toBe(true);
    const commands = app.get(StructureCommandsService);
    const command = { ...(await versions()), id: department, parentId: other };
    const review = await commands.preview(actor(), command);
    await owner.query(
      `CREATE FUNCTION turnstile.fixture_invitation_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='invalidated' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$`,
    );
    await owner.query(
      'CREATE TRIGGER fixture_invitation_failure BEFORE INSERT ON turnstile.invitation_audit FOR EACH ROW EXECUTE FUNCTION turnstile.fixture_invitation_audit_failure()',
    );
    try {
      await expect(
        commands.move(
          actor(),
          department,
          { command, confirmation: review.confirmation },
          randomUUID(),
        ),
      ).rejects.toBeDefined();
      expect((await service.read(actor(), value.result.id)).state).toBe('pending');
      expect(await versions()).toEqual({
        expectedAccessRevision: command.expectedAccessRevision,
        expectedOrganizationRevision: command.expectedOrganizationRevision,
      });
    } finally {
      await owner.query('DROP TRIGGER fixture_invitation_failure ON turnstile.invitation_audit');
      await owner.query('DROP FUNCTION turnstile.fixture_invitation_audit_failure()');
    }
    await commands.move(
      actor(),
      department,
      { command, confirmation: review.confirmation },
      randomUUID(),
    );
    expect((await service.read(actor(), value.result.id)).state).toBe('needs_reapproval');
    expect((await state(value.result.id))[0].payload).toBeNull();
    await cancel(await service.read(actor(), value.result.id));
    expect(await owned((db) => policy.references(db, tenant, site))).toBe(false);
  });
  it('keeps display edits harmless, fences role permission changes and enforces role/unit references', async () => {
    const original = role;
    role = randomUUID();
    await owned(async (db) => {
      await db.query(
        "INSERT INTO turnstile.access_role (tenant_id,id,name,name_key) VALUES ($1,$2,'Local unit editors','local unit editors')",
        [tenant, role],
      );
      await db.query(
        'INSERT INTO turnstile.access_role_permission (tenant_id,role_id,permission) SELECT tenant_id,$2,permission FROM turnstile.access_role_permission WHERE tenant_id=$1 AND role_id=$3',
        [tenant, role, original],
      );
    });
    const value = await issue(undefined, undefined, department);
    await expect(
      owned((db) =>
        db.query('DELETE FROM turnstile.organization_unit WHERE tenant_id=$1 AND id=$2', [
          tenant,
          department,
        ]),
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      owned(async (db) => {
        await db.query(
          'DELETE FROM turnstile.access_role_permission WHERE tenant_id=$1 AND role_id=$2',
          [tenant, role],
        );
        await db.query('DELETE FROM turnstile.access_role WHERE tenant_id=$1 AND id=$2', [
          tenant,
          role,
        ]);
      }),
    ).rejects.toMatchObject({ code: '23503' });
    await owned((db) =>
      db.query(
        "UPDATE turnstile.access_role SET name='Renamed editors',name_key='renamed editors',version=version+1 WHERE tenant_id=$1 AND id=$2",
        [tenant, role],
      ),
    );
    expect((await service.read(actor(), value.result.id)).state).toBe('pending');
    await owned(async (db) => {
      await db.query(
        "DELETE FROM turnstile.access_role_permission WHERE tenant_id=$1 AND role_id=$2 AND permission='turnstile:units:manage'",
        [tenant, role],
      );
      await db.query(
        'UPDATE turnstile.access_role SET version=version+1,permission_version=permission_version+1 WHERE tenant_id=$1 AND id=$2',
        [tenant, role],
      );
    });
    expect((await service.read(actor(), value.result.id)).state).toBe('needs_reapproval');
    await owned(async (db) => {
      await db.query(
        "INSERT INTO turnstile.access_role_permission VALUES ($1,$2,'turnstile:units:manage')",
        [tenant, role],
      );
      await db.query(
        'UPDATE turnstile.access_role SET version=version+1,permission_version=permission_version+1 WHERE tenant_id=$1 AND id=$2',
        [tenant, role],
      );
    });
    expect((await service.read(actor(), value.result.id)).state).toBe('needs_reapproval');
  });
  it('serializes normalized duplicates and leases each message to only one replica', async () => {
    const address = `parallel-${randomUUID()}@example.test`;
    const results = await Promise.allSettled([issue(address), issue(address.toUpperCase())]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const second = new InvitationDeliveryService(store, new InvitationMailService());
    const claims = await Promise.all([worker.claim(), second.claim()]);
    expect(claims.flat()).toHaveLength(1);
  });
  it('fails readiness on an unbound restore epoch and explicitly quarantines delivery with public grants closed', async () => {
    const value = await issue();
    vi.stubEnv('TURNSTILE_INVITATION_RECOVERY_EPOCH', randomBytes(32).toString('base64url'));
    const recovered = new InvitationStoreService(persistence);
    const restart = new InvitationDeliveryService(recovered, new InvitationMailService());
    await expect(restart.drain()).rejects.toMatchObject({ status: 503 });
    expect(
      await releaseOperator('recover', {
        operatorId: 'invitation-release-fixture',
        key: randomUUID(),
        expectedRevision: (await versions()).expectedAccessRevision,
        incompatibleProcessesStopped: true,
      }),
    ).toMatchObject({ publicWritesEnabled: false, ready: true, changed: true });
    expect(await restart.drain()).toBe(0);
    const current = new InvitationService(recovered, new IdentityClientService(persistence));
    expect((await current.read(actor(), value.result.id)).state).toBe('needs_reapproval');
    const counts = await owned((db) =>
      db.query('SELECT count(*)::int AS count FROM turnstile.access_member WHERE tenant_id=$1', [
        tenant,
      ]),
    );
    expect(counts.rows[0].count).toBe(1);
    expect(
      (
        await owned((db) =>
          db.query(
            'SELECT public_writes_enabled FROM turnstile.access_context WHERE tenant_id=$1',
            [tenant],
          ),
        )
      ).rows[0].public_writes_enabled,
    ).toBe(false);
  });
  it('enforces durable administrator/capacity limits and rolls back invitation/mail when audit fails', async () => {
    await issue();
    // Seed both possible windows so the real request can cross a minute boundary.
    await owned((db) =>
      db.query(
        `INSERT INTO turnstile.invitation_rate(tenant_id,actor,"window",count)
       SELECT $1,$2,to_timestamp(floor(extract(epoch FROM statement_timestamp())/60)*60+offset_seconds),10
       FROM unnest(ARRAY[0,60]) bucket(offset_seconds)
       ON CONFLICT(tenant_id,actor,"window") DO UPDATE SET count=EXCLUDED.count`,
        [tenant, `actor:${actor().userId}`],
      ),
    );
    await expect(issue()).rejects.toMatchObject({ status: 429 });
    await owned((db) =>
      db.query('DELETE FROM turnstile.invitation_rate WHERE tenant_id=$1', [tenant]),
    );
    await owner.query('REVOKE INSERT ON turnstile.invitation_audit FROM thaarei_turnstile_runtime');
    try {
      await expect(issue()).rejects.toMatchObject({ status: 503 });
    } finally {
      await owner.query('GRANT INSERT ON turnstile.invitation_audit TO thaarei_turnstile_runtime');
    }
    expect(
      (
        await owned((db) =>
          db.query('SELECT count(*)::int AS count FROM turnstile.invitation WHERE tenant_id=$1', [
            tenant,
          ]),
        )
      ).rows[0].count,
    ).toBe(1);
  });
  it('rejects actionable capacity without partial issuance', async () => {
    const value = await issue();
    await owned((db) =>
      db.query(
        `INSERT INTO turnstile.invitation (tenant_id,id,email,state,approver_id,assignments,recovery_epoch,invalidated_at,expires_at) SELECT $1,gen_random_uuid(),'capacity-'||n||'@example.test','needs_reapproval',$2,$3,$4,statement_timestamp(),statement_timestamp()+interval '7 days' FROM generate_series(1,999) n`,
        [
          tenant,
          actor().userId,
          JSON.stringify(value.result.assignments),
          store.config?.recoveryEpoch,
        ],
      ),
    );
    await expect(issue()).rejects.toMatchObject({ status: 503 });
    expect(
      (
        await owned((db) =>
          db.query('SELECT count(*)::int AS count FROM turnstile.invitation WHERE tenant_id=$1', [
            tenant,
          ]),
        )
      ).rows[0].count,
    ).toBe(1000);
  });
  it('rolls back late issue audit failure and resumes the exact reservation once', async () => {
    const key = randomUUID();
    const command = {
      operation: 'invitation.issue',
      ...(await versions()),
      email: `rollback-${randomUUID()}@example.test`,
      assignments: [{ roleId: role, expectedRoleVersion: roleVersion, scope: { kind: 'company' } }],
    };
    await owner.query(
      `CREATE FUNCTION turnstile.fixture_issue_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='issued' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$`,
    );
    await owner.query(
      'CREATE TRIGGER fixture_issue_audit BEFORE INSERT ON turnstile.invitation_audit FOR EACH ROW EXECUTE FUNCTION turnstile.fixture_issue_audit()',
    );
    try {
      await expect(service.execute(actor(), key, command)).rejects.toMatchObject({ status: 503 });
      expect(
        (
          await owned((db) =>
            db.query('SELECT count(*)::int AS count FROM turnstile.invitation WHERE tenant_id=$1', [
              tenant,
            ]),
          )
        ).rows[0].count,
      ).toBe(0);
      expect(await service.readback(actor(), key)).toEqual({ state: 'preparing' });
    } finally {
      await owner.query('DROP TRIGGER fixture_issue_audit ON turnstile.invitation_audit');
      await owner.query('DROP FUNCTION turnstile.fixture_issue_audit()');
    }
    const result = await service.execute(actor(), key, command);
    expect(result.delivery?.state).toBe('queued');
    expect(await service.execute(actor(), key, command)).toEqual(result);
  });
  it('guards immutable history and prunes only eligible terminal records through the owning operator', async () => {
    const value = await issue();
    await expect(
      owned((db) =>
        db.query(
          "UPDATE turnstile.invitation_generation SET credential_hash=repeat('0',64) WHERE tenant_id=$1",
          [tenant],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      owned((db) =>
        db.query(
          "UPDATE turnstile.invitation_operation SET digest=repeat('0',64) WHERE tenant_id=$1",
          [tenant],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const old = randomUUID();
    await owned((db) =>
      db.query(
        `INSERT INTO turnstile.invitation (tenant_id,id,email,state,approver_id,assignments,recovery_epoch,created_at,expires_at,cancelled_at) VALUES ($1,$2,'prune@example.test','cancelled',$3,$4,$5,statement_timestamp()-interval '120 days',statement_timestamp()-interval '113 days',statement_timestamp()-interval '100 days')`,
        [
          tenant,
          old,
          actor().userId,
          JSON.stringify(value.result.assignments),
          store.config?.recoveryEpoch,
        ],
      ),
    );
    await accessOperator('prune', { operatorId: 'invitation-fixture' });
    await expect(service.read(actor(), old)).rejects.toMatchObject({ status: 404 });
    expect((await service.read(actor(), value.result.id)).state).toBe('pending');
  });
  it('retains readable accepted approvals until the terminal parent and its known dependents fit the pruning budget', async () => {
    const source = await issue();
    async function accepted(createdDays: number, acceptedDays: number) {
      const id = randomUUID();
      const approval = randomUUID();
      await owned(async (db) => {
        await db.query('SELECT turnstile.lock_access_context($1)', [tenant]);
        await db.query(
          `INSERT INTO turnstile.invitation (tenant_id,id,email,state,approver_id,approval_id,assignments,recovery_epoch,created_at,expires_at,accepted_at,accepted_user_id)
          SELECT tenant_id,$3,$4,'accepted',approver_id,$5,assignments,recovery_epoch,
            statement_timestamp()-$6*interval '1 day',statement_timestamp()-($6-7)*interval '1 day',
            statement_timestamp()-$7*interval '1 day','retention-recipient'
          FROM turnstile.invitation WHERE tenant_id=$1 AND id=$2`,
          [
            tenant,
            source.result.id,
            id,
            `retention-${id}@example.test`,
            approval,
            createdDays,
            acceptedDays,
          ],
        );
        await db.query(
          `INSERT INTO turnstile.invitation_generation (tenant_id,invitation_id,generation,id,email,approver_id,approval,assignments,credential_hash,recovery_epoch,created_at,expires_at)
          SELECT tenant_id,$3,1,$4,$5,approver_id,
            approval||jsonb_build_object('approvedAt',to_char((statement_timestamp()-$6*interval '1 day') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
            assignments,$7,recovery_epoch,statement_timestamp()-$6*interval '1 day',
            statement_timestamp()-($6-7)*interval '1 day'
          FROM turnstile.invitation_generation WHERE tenant_id=$1 AND invitation_id=$2 AND generation=1`,
          [
            tenant,
            source.result.id,
            id,
            approval,
            `retention-${id}@example.test`,
            createdDays,
            randomBytes(32).toString('hex'),
          ],
        );
      });
      return id;
    }
    const prune = (budget: number) =>
      owned(async (db) => {
        await db.query('SELECT turnstile.lock_access_context($1)', [tenant]);
        return pruneInvitationRecords(db, tenant, budget);
      });
    const recentAcceptance = await accepted(91, 85);
    const retained = await service.read(actor(), recentAcceptance);
    expect(retained.state).toBe('accepted');
    await prune(1000);
    expect(await service.read(actor(), recentAcceptance)).toEqual(retained);

    const old = await accepted(100, 94);
    const oldResult = await service.read(actor(), old);
    await owned((db) =>
      db.query(
        `INSERT INTO turnstile.invitation_delivery (tenant_id,invitation_id,generation,state,attempts,recovery_epoch,outcome_at)
        VALUES ($1,$2,1,'smtp_accepted',1,$3,statement_timestamp())`,
        [tenant, old, store.config?.recoveryEpoch],
      ),
    );
    expect(Object.values(await prune(2)).reduce((sum, count) => sum + count, 0)).toBe(0);
    expect((await service.read(actor(), old)).approval).toEqual(oldResult.approval);
    await owned((db) =>
      db.query(
        "UPDATE turnstile.invitation_delivery SET outcome_at=statement_timestamp()-interval '91 days' WHERE tenant_id=$1 AND invitation_id=$2",
        [tenant, old],
      ),
    );
    const deliveryOnly = await prune(2);
    expect(deliveryOnly.invitation_delivery).toBe(1);
    expect(Object.values(deliveryOnly).reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(await service.read(actor(), old)).toEqual(oldResult);
    expect(Object.values(await prune(1)).reduce((sum, count) => sum + count, 0)).toBe(0);
    expect(await service.read(actor(), old)).toEqual(oldResult);
    const pair = await prune(2);
    expect(pair.invitation).toBe(1);
    expect(pair.invitation_generation).toBe(1);
    expect(Object.values(pair).reduce((sum, count) => sum + count, 0)).toBe(2);
    await expect(service.read(actor(), old)).rejects.toMatchObject({ status: 404 });
    expect(await service.read(actor(), recentAcceptance)).toEqual(retained);
  });
  it('recovers full invitation audit capacity with retention-only pruning before lifecycle maintenance', async () => {
    const value = await issue();
    await owned((db) =>
      db.query(
        "UPDATE turnstile.invitation SET created_at=statement_timestamp()-interval '8 days',expires_at=statement_timestamp()-interval '1 second' WHERE tenant_id=$1 AND id=$2",
        [tenant, value.result.id],
      ),
    );
    await owned(async (db) => {
      await db.query(
        'ALTER TABLE turnstile.invitation_audit DISABLE TRIGGER bound_invitation_audit',
      );
      try {
        await db.query(
          `INSERT INTO turnstile.invitation_audit (tenant_id,id,invitation_id,generation,actor_kind,action,created_at)
          SELECT $1,gen_random_uuid(),$2,1,'system','smtp_accepted',statement_timestamp()-interval '91 days'
          FROM generate_series(1,100000-(SELECT count(*)::int FROM turnstile.invitation_audit WHERE tenant_id=$1))`,
          [tenant, value.result.id],
        );
      } finally {
        await db.query(
          'ALTER TABLE turnstile.invitation_audit ENABLE TRIGGER bound_invitation_audit',
        );
      }
    });
    await expect(service.maintain()).rejects.toMatchObject({ status: 503 });
    const pruned = await accessOperator('prune', { operatorId: 'invitation-capacity-fixture' });
    expect(pruned).toMatchObject({ invitationsDeleted: { invitation_audit: 1000 } });
    const beforeMaintenance = await owned((db) =>
      db.query('SELECT state FROM turnstile.invitation WHERE tenant_id=$1 AND id=$2', [
        tenant,
        value.result.id,
      ]),
    );
    expect(beforeMaintenance.rows[0].state).toBe('pending');
    await service.maintain();
    expect((await service.read(actor(), value.result.id)).state).toBe('expired');
    expect((await state(value.result.id))[0].payload).toBeNull();
  });
  it('requires current company People authority and the complete action/scope ceiling', async () => {
    const peopleRole = randomUUID();
    await owned(async (db) => {
      await db.query(
        "INSERT INTO turnstile.access_role (tenant_id,id,name,name_key) VALUES ($1,$2,'Invitation coordinator','invitation coordinator')",
        [tenant, peopleRole],
      );
      await db.query(
        "INSERT INTO turnstile.access_role_permission (tenant_id,role_id,permission) SELECT $1,$2,unnest(ARRAY['turnstile:access','turnstile:people:manage'])",
        [tenant, peopleRole],
      );
      await db.query('DELETE FROM turnstile.access_assignment WHERE tenant_id=$1', [tenant]);
      await db.query(
        "UPDATE turnstile.access_legacy_source SET permissions=ARRAY['turnstile:access'],version=version+1 WHERE tenant_id=$1",
        [tenant],
      );
      const member = (
        await db.query('SELECT id FROM turnstile.access_member WHERE tenant_id=$1 AND user_id=$2', [
          tenant,
          actor().userId,
        ])
      ).rows[0].id;
      const scoped = randomUUID();
      await db.query(
        "INSERT INTO turnstile.access_assignment (tenant_id,id,member_id,role_id,scope_kind,include_children,scope_key) VALUES ($1,$2,$3,$4,'company',false,'company'),($1,$5,$3,$6,'units',true,$7)",
        [tenant, randomUUID(), member, peopleRole, scoped, role, `units:true:${site}`],
      );
      await db.query('INSERT INTO turnstile.access_scope_anchor VALUES ($1,$2,$3)', [
        tenant,
        scoped,
        site,
      ]);
    });
    await expect(issue(undefined, undefined, other)).rejects.toMatchObject({ status: 403 });
    const value = await issue(undefined, undefined, site);
    expect(value.result.state).toBe('pending');
    await expect(
      service.read(
        { userId: fixture.users.unverified?.id ?? '', requestId: randomUUID() },
        value.result.id,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
