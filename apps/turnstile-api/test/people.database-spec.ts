import { type ChildProcess, fork } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { HttpException } from '@nestjs/common';
import type { PeoplePermission } from '@thaarei/turnstile-contracts';
import type { FastifyRequest } from 'fastify';
import { Pool, type PoolClient } from 'pg';
import { createApplication } from '../src/bootstrap.js';
import { INVITATION_TABLES } from '../src/infrastructure/database/invitation-safety.js';
import { withTenant } from '../src/infrastructure/database/postgres.js';
import { IdentityClientService } from '../src/integrations/identity/identity-client.service.js';
import { readAccess } from '../src/modules/access/access-evaluator.js';
import { BrowserAuthService } from '../src/modules/auth/browser-auth/browser-auth.service.js';
import { OrganizationService } from '../src/modules/organization/organization.service.js';
import { AdministrationService } from '../src/modules/people/administration.service.js';
import { InvitationDeliveryService } from '../src/modules/people/invitation-delivery.service.js';
import { openAccessFixture, resetAccessFixture } from './access-fixture.js';

const databaseFailures = vi.hoisted(
  () => [] as { name: string; code?: unknown; issues?: unknown }[],
);
// Preserve real transactions and SQL; collect only finite error metadata for failed assertions.
vi.mock('../src/infrastructure/database/postgres.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/infrastructure/database/postgres.js')>();
  return {
    ...actual,
    withTenant: async (...args: Parameters<typeof actual.withTenant>) => {
      try {
        return await actual.withTenant(...args);
      } catch (error) {
        databaseFailures.push({
          name: error instanceof Error ? error.name : 'unknown',
          code: error && typeof error === 'object' && 'code' in error ? error.code : undefined,
          issues:
            error && typeof error === 'object' && 'issues' in error
              ? (error.issues as { code: string; path: unknown[] }[]).map(({ code, path }) => ({
                  code,
                  path,
                }))
              : undefined,
        });
        if (databaseFailures.length > 32) databaseFailures.shift();
        throw error;
      }
    },
  };
});

describe('People administration HTTP with real PostgreSQL and linked authority projections', () => {
  const tenant = process.env.INSTALLATION_TENANT_ID as string;
  const owner = new Pool({ connectionString: process.env.TURNSTILE_MIGRATION_DATABASE_URL });
  const owned = <T>(work: (db: PoolClient) => Promise<T>) => withTenant(owner, tenant, work);
  const origin = process.env.AUTH_PUBLIC_ORIGIN as string;
  const csrf = randomBytes(32).toString('base64url');
  let child: ChildProcess;
  let fixture: {
    port: number;
    secret: string;
    users: Record<string, { id: string; email: string }>;
  };
  let app: Awaited<ReturnType<typeof createApplication>>;
  let members: Record<string, string>;
  let templates: Record<string, string>;
  let unit: string, other: string;
  let clearIdentityProbes = () => {};
  const actor = (label = 'operator') => ({
    userId: fixture.users[label]?.id ?? '',
    requestId: randomUUID(),
  });
  const uid = (label = 'operator') => fixture.users[label]?.id ?? '';
  async function rpc(action: string, extra: object = {}) {
    const requestId = randomUUID();
    const promise = new Promise<unknown>((resolve, reject) => {
      const listener = (m: { requestId?: string; ok?: boolean; value?: unknown }) => {
        if (m.requestId !== requestId) return;
        child.off('message', listener);
        m.ok ? resolve(m.value) : reject(new Error('Authority fixture operation failed'));
      };
      child.on('message', listener);
    });
    child.send({ action, requestId, ...extra });
    return promise;
  }
  function get(path: string, label = 'operator') {
    return app.inject({
      method: 'GET',
      url: `/api/people/${path}`,
      headers: { 'x-test-user': uid(label) },
    });
  }
  function mutate(
    path: string,
    command: unknown,
    confirmation: string | null = null,
    label = 'operator',
    key = randomUUID(),
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST',
    token = csrf,
  ) {
    return app.inject({
      method,
      url: `/api/people/${path}`,
      headers: { origin, 'x-test-user': uid(label), 'x-csrf-token': token, 'idempotency-key': key },
      payload: { command, confirmation },
    });
  }
  async function versions() {
    return owned(async (db) => {
      const row = (
        await db.query(
          'SELECT a.revision,o.revision AS org FROM turnstile.access_context a JOIN turnstile.organization_configuration o USING(tenant_id) WHERE a.tenant_id=$1',
          [tenant],
        )
      ).rows[0];
      return { expectedAccessRevision: row.revision, expectedOrganizationRevision: row.org };
    });
  }
  async function preview(command: unknown, label = 'operator') {
    return app.inject({
      method: 'POST',
      url: '/api/people/impact',
      headers: { origin, 'x-test-user': uid(label), 'x-csrf-token': csrf },
      payload: { command },
    });
  }
  async function confirm(command: unknown, label = 'operator') {
    const response = await preview(command, label);
    expect(response.statusCode).toBe(200);
    return response.json().confirmation as string;
  }
  const createCommand = async (
    name = 'Custom role',
    permissions: PeoplePermission[] = ['turnstile:access'],
  ) => ({
    operation: 'role.create',
    expectedAccessRevision: (await versions()).expectedAccessRevision,
    source: 'new',
    name,
    permissions,
  });
  async function custom(
    name = 'Custom role',
    permissions: PeoplePermission[] = ['turnstile:access'],
  ) {
    const command = await createCommand(name, permissions);
    const response = await mutate('roles', command);
    expect(response.statusCode).toBe(201);
    return response.json().current;
  }
  async function grant(
    label: string,
    role: string,
    scope: { kind: 'company' } | { kind: 'units'; unitIds: string[]; includeChildren: boolean } = {
      kind: 'company',
    },
  ) {
    await owned(async (db) => {
      const id = randomUUID(),
        key =
          scope.kind === 'company'
            ? 'company'
            : `units:${scope.includeChildren}:${[...scope.unitIds].sort().join(',')}`;
      await db.query(
        'INSERT INTO turnstile.access_assignment(tenant_id,id,member_id,role_id,scope_kind,include_children,scope_key) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          tenant,
          id,
          members[label],
          role,
          scope.kind,
          scope.kind === 'units' && scope.includeChildren,
          key,
        ],
      );
      if (scope.kind === 'units')
        await db.query(
          'INSERT INTO turnstile.access_scope_anchor(tenant_id,assignment_id,unit_id) SELECT $1,$2,unnest($3::uuid[])',
          [tenant, id, scope.unitIds],
        );
    });
  }
  async function seedRole(label: string, permissions: PeoplePermission[]) {
    return owned(async (db) => {
      const id = randomUUID();
      await db.query(
        'INSERT INTO turnstile.access_role(tenant_id,id,name,name_key) VALUES($1,$2,$3,$3)',
        [tenant, id, label],
      );
      await db.query(
        'INSERT INTO turnstile.access_role_permission(tenant_id,role_id,permission) SELECT $1,$2,unnest($3::text[])',
        [tenant, id, permissions],
      );
      return id;
    });
  }
  async function targetCommand(op = 'member.assignments', label = 'verified') {
    const m = (await get(`members/${members[label]}`)).json();
    return {
      operation: op,
      ...(await versions()),
      id: m.id,
      expectedVersion: m.version,
      ...(op === 'member.assignments'
        ? {
            assignments: [
              { roleId: templates.member, expectedRoleVersion: 1, scope: { kind: 'company' } },
            ],
            retireLegacyVersion: null,
          }
        : {}),
    };
  }
  async function auditCount() {
    return owned(
      async (db) =>
        (
          await db.query(
            'SELECT count(*)::int AS n FROM turnstile.access_audit WHERE tenant_id=$1',
            [tenant],
          )
        ).rows[0].n as number,
    );
  }
  beforeAll(async () => {
    child = fork(
      fileURLToPath(new URL('../../dms-api/test/identity-authority-fixture.mjs', import.meta.url)),
      [],
      {
        env: { ...process.env, IDENTITY_FIXTURE_NAMESPACE: 'people' },
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      },
    );
    fixture = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('People authority timeout')), 25000);
      child.on('message', (m) => {
        if ((m as { ready?: boolean }).ready) {
          clearTimeout(timer);
          resolve(m as typeof fixture);
        }
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('People authority exited'));
      });
    });
    vi.stubEnv('IDENTITY_SERVICE_CLIENT_ID', 'people-fixture-service');
    vi.stubEnv('IDENTITY_SERVICE_CLIENT_SECRET', fixture.secret);
    vi.stubEnv('IDENTITY_SERVICE_RESOURCE_URL', `${origin}/identity/services/accounts`);
    vi.stubEnv('IDENTITY_SERVICE_API_URL', `http://127.0.0.1:${fixture.port}`);
    vi.stubEnv('TURNSTILE_INVITATION_ENCRYPTION_KEY', randomBytes(32).toString('hex'));
    vi.stubEnv('TURNSTILE_INVITATION_RECOVERY_EPOCH', randomBytes(32).toString('base64url'));
    vi.stubEnv('TURNSTILE_SMTP_HOST', '127.0.0.1');
    vi.stubEnv('TURNSTILE_SMTP_PORT', '1');
    vi.stubEnv('TURNSTILE_MAIL_FROM', 'turnstile@example.test');
    app = await createApplication(false);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.get(InvitationDeliveryService).beforeApplicationShutdown();
    vi.spyOn(app.get(BrowserAuthService), 'authenticate').mockImplementation(
      async (request: FastifyRequest) => {
        const id = request.headers['x-test-user'];
        if (typeof id !== 'string' || !id)
          throw new HttpException({ code: 'IDENTITY_REQUIRED' }, 401);
        const access = await owned((db) => readAccess(db, tenant, id));
        if (access.status !== 'active') throw new HttpException({ code: 'IDENTITY_REQUIRED' }, 401);
        const current = {
          identity: {
            user: { id, name: 'Fixture', email: 'fixture@example.test' },
            permissions: access.context.grants.flatMap((g) => g.permissions),
            access: access.context,
          },
          csrf,
          access,
        } as unknown as NonNullable<FastifyRequest['productUser']>;
        request.productUser = current;
        return current;
      },
    );
  }, 35000);
  beforeEach(async () => {
    databaseFailures.length = 0;
    await rpc('clear-limits');
    await rpc('reset-member-projections');
    await owned((db) =>
      db.query(`TRUNCATE ${INVITATION_TABLES.map((t) => `turnstile.${t}`).join(',')} CASCADE`),
    );
    await resetAccessFixture(owner, [
      { userId: uid(), permissions: ['turnstile:access', 'turnstile:configuration:manage'] },
    ]);
    const organization = app.get(OrganizationService);
    let snapshot = await organization.save(actor(), {
      expectedRevision: 0,
      name: 'People fixture',
      timeZone: 'UTC',
    });
    for (const name of ['A', 'B']) {
      const row = await organization.createUnit(
        actor(),
        {
          expectedRevision: snapshot.revision,
          parentId: snapshot.organization.rootId,
          type: 'site',
          name,
        },
        randomUUID(),
      );
      snapshot = row.configuration;
      if (name === 'A') unit = row.unitId;
      else other = row.unitId;
    }
    await organization.complete(actor(), { expectedRevision: snapshot.revision });
    members = {};
    templates = {};
    await owned(async (db) => {
      for (const label of ['operator', 'verified', 'unverified', 'passwordless']) {
        let row = (
          await db.query(
            'SELECT id FROM turnstile.access_member WHERE tenant_id=$1 AND user_id=$2',
            [tenant, uid(label)],
          )
        ).rows[0];
        if (!row) {
          const id = randomUUID();
          await db.query(
            "INSERT INTO turnstile.access_member(tenant_id,id,user_id,status) VALUES($1,$2,$3,'active')",
            [tenant, id, uid(label)],
          );
          row = { id };
        }
        members[label] = row.id;
      }
      for (const row of (
        await db.query('SELECT id,system_key FROM turnstile.access_role WHERE tenant_id=$1', [
          tenant,
        ])
      ).rows)
        templates[row.system_key] = row.id;
    });
    await grant('operator', templates.workspace_administrator as string);
    for (const label of ['verified', 'unverified', 'passwordless'])
      await grant(label, templates.member as string);
    await openAccessFixture(owner);
  });
  afterEach(() => {
    clearIdentityProbes();
    clearIdentityProbes = () => {};
  });
  afterAll(async () => {
    await app?.close();
    await resetAccessFixture(owner);
    await owner.end();
    if (child?.connected) {
      const done = once(child, 'exit');
      child.kill('SIGTERM');
      await done;
    }
    vi.unstubAllEnvs();
  });

  it('enforces real guards, separate policies, CSRF, strict bodies and the installed release gate', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/people/members' })).statusCode).toBe(401);
    expect((await get('members', 'verified')).statusCode).toBe(403);
    const command = await createCommand();
    expect(
      (await mutate('roles', command, null, 'operator', randomUUID(), 'POST', 'wrong')).statusCode,
    ).toBe(403);
    expect((await mutate('roles', { ...command, actorId: uid() })).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/people/roles',
          headers: { origin, 'x-test-user': uid(), 'content-type': 'text/plain' },
          payload: 'private',
        })
      ).statusCode,
    ).toBe(415);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/people/roles',
          headers: { origin, 'x-test-user': uid() },
          payload: { data: 'x'.repeat(17000) },
        })
      ).statusCode,
    ).toBe(413);
    await owned((db) =>
      db.query(
        'UPDATE turnstile.access_context SET public_writes_enabled=false,revision=revision+1 WHERE tenant_id=$1',
        [tenant],
      ),
    );
    expect((await mutate('roles', command)).statusCode).toBe(503);
    expect((await get('roles')).statusCode).toBe(200);
    await owned((db) =>
      db.query('REVOKE UPDATE ON turnstile.member_display FROM thaarei_turnstile_runtime'),
    );
    try {
      expect((await get('roles')).statusCode).toBe(503);
    } finally {
      await owned((db) =>
        db.query('GRANT UPDATE ON turnstile.member_display TO thaarei_turnstile_runtime'),
      );
    }
  });
  it('returns finite invitation throttling with Retry-After before any authority operation', async () => {
    const command = {
      operation: 'invitation.issue',
      ...(await versions()),
      email: `limited-${randomUUID()}@example.test`,
      assignments: [
        { roleId: templates.member, expectedRoleVersion: 1, scope: { kind: 'company' } },
      ],
    };
    const proof = await confirm(command);
    await owned((db) =>
      db.query(
        'INSERT INTO turnstile.invitation_rate(tenant_id,actor,"window",count) SELECT $1,$2,to_timestamp(floor(extract(epoch FROM statement_timestamp())/60)*60+offset_seconds),10 FROM unnest(ARRAY[0,60]) bucket(offset_seconds)',
        [tenant, `actor:${uid()}`],
      ),
    );
    const response = await mutate('invitations', command, proof);
    expect(response.statusCode).toBe(429);
    expect(response.json().code).toBe('PEOPLE_RATE_LIMITED');
    expect(response.headers['retry-after']).toBe('60');
    expect((await get('invitations')).json().items).toHaveLength(0);
  });
  it('projects linked identity and all sources, searches and paginates with revision-bound cursors', async () => {
    const list = await get('members?limit=2');
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(2);
    expect(list.json().nextCursor).toBeTruthy();
    expect(
      list
        .json()
        .items.every((m: { identity: { state: string } }) =>
          ['fresh', 'unavailable'].includes(m.identity.state),
        ),
    ).toBe(true);
    const second = await get(`members?limit=2&cursor=${list.json().nextCursor}`);
    expect(second.statusCode).toBe(200);
    expect(second.json().items).toHaveLength(2);
    const search = await get('members?search=people-verified');
    expect(search.statusCode).toBe(200);
    expect(search.json().total).toBe(1);
    const op = (await get(`members/${members.operator}`)).json();
    expect(op.legacySource.permissions).toEqual([
      'turnstile:access',
      'turnstile:configuration:manage',
    ]);
    expect(op.assignments[0].role.systemKey).toBe('workspace_administrator');
    await custom();
    expect((await get(`members?limit=2&cursor=${list.json().nextCursor}`)).statusCode).toBe(409);
    expect((await get('members?userIds=unrelated')).statusCode).toBe(400);
  });
  it('keeps role-only and people-only administration independent and impact identities private', async () => {
    const roleOnly = await seedRole('role editor', ['turnstile:access', 'turnstile:roles:manage']);
    await grant('verified', roleOnly);
    const peopleOnly = await seedRole('people editor', [
      'turnstile:access',
      'turnstile:people:manage',
    ]);
    await grant('unverified', peopleOnly);
    expect((await get('roles', 'verified')).statusCode).toBe(200);
    expect((await get('members', 'verified')).statusCode).toBe(403);
    expect((await get('members', 'unverified')).statusCode).toBe(200);
    expect((await get('roles', 'unverified')).statusCode).toBe(403);
    expect((await get('eligible-roles', 'unverified')).statusCode).toBe(200);
    const command = await createCommand();
    const review = await preview(command, 'verified');
    expect(review.statusCode).toBe(200);
    expect(review.json().visibility).toBe('definitions');
    expect(JSON.stringify(review.json()).includes(members.operator as string)).toBe(false);
    expect((await mutate('roles', command, null, 'unverified')).statusCode).toBe(403);
    const roleCatalog = (await get('catalog', 'verified')).json();
    expect(roleCatalog.permissions).toHaveLength(7);
    expect(roleCatalog.organizationRevision).toEqual(expect.any(Number));
    expect(roleCatalog.grantableCompanyPermissions).toEqual([
      'turnstile:access',
      'turnstile:roles:manage',
    ]);
    expect((await get('catalog', 'unverified')).json().grantableCompanyPermissions).toEqual([
      'turnstile:access',
      'turnstile:people:manage',
    ]);
  });
  it('creates, copies, renames and deletes custom roles with immutable system identities and no-op receipts', async () => {
    const command = await createCommand('  Cafe\u0301  ');
    const key = randomUUID();
    const created = await mutate('roles', command, null, 'operator', key);
    expect(created.statusCode).toBe(201);
    const role = created.json().current;
    expect(role.name).toBe('Café');
    expect(role.systemKey).toBe(null);
    const replay = await mutate('roles', command, null, 'operator', key);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().replayed).toBe(true);
    expect(
      (await mutate('roles', { ...command, name: 'Another' }, null, 'operator', key)).statusCode,
    ).toBe(409);
    const copy = {
      operation: 'role.create',
      source: 'copy',
      name: 'Copied administrator',
      copyFromRoleId: templates.workspace_administrator,
      expectedRoleVersion: 1,
      expectedAccessRevision: (await versions()).expectedAccessRevision,
    };
    const copied = await mutate('roles', copy);
    expect(copied.statusCode).toBe(201);
    expect(copied.json().current.systemKey).toBe(null);
    const before = await auditCount();
    const noop = {
      operation: 'role.patch',
      change: 'details',
      id: role.id,
      expectedVersion: 1,
      expectedAccessRevision: (await versions()).expectedAccessRevision,
      name: 'Café',
    };
    const unchanged = await mutate(
      `roles/${role.id}`,
      noop,
      null,
      'operator',
      randomUUID(),
      'PATCH',
    );
    expect(unchanged.statusCode).toBe(200);
    expect(unchanged.json().changed).toBe(false);
    expect(await auditCount()).toBe(before);
    const patch = { ...noop, name: 'Renamed' };
    const renamed = await mutate(
      `roles/${role.id}`,
      patch,
      null,
      'operator',
      randomUUID(),
      'PATCH',
    );
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().current.version).toBe(2);
    const deletion = {
      operation: 'role.delete',
      id: role.id,
      expectedVersion: 2,
      expectedAccessRevision: (await versions()).expectedAccessRevision,
    };
    const deleted = await mutate(
      `roles/${role.id}`,
      deletion,
      null,
      'operator',
      randomUUID(),
      'DELETE',
    );
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().kind).toBe('deleted_role');
    expect(
      (
        await mutate(
          `roles/${templates.member}`,
          {
            operation: 'role.delete',
            id: templates.member,
            expectedVersion: 1,
            expectedAccessRevision: (await versions()).expectedAccessRevision,
          },
          null,
          'operator',
          randomUUID(),
          'DELETE',
        )
      ).statusCode,
    ).toBe(409);
  });
  it('denies reusable permission escalation and mutation of referenced roles by a role-only editor', async () => {
    const editor = await seedRole('role-only', ['turnstile:access', 'turnstile:roles:manage']);
    await grant('verified', editor);
    expect(
      (
        await mutate(
          'roles',
          await createCommand('Too broad', ['turnstile:access', 'turnstile:units:manage']),
          null,
          'verified',
        )
      ).statusCode,
    ).toBe(403);
    const shared = await custom();
    await grant('unverified', shared.id);
    const command = {
      operation: 'role.patch',
      change: 'permissions',
      ...(await versions()),
      id: shared.id,
      expectedVersion: 1,
      permissions: ['turnstile:access', 'turnstile:units:read'],
    };
    expect((await preview(command, 'verified')).statusCode).toBe(403);
    expect(
      (await mutate(`roles/${shared.id}`, command, null, 'verified', randomUUID(), 'PATCH'))
        .statusCode,
    ).toBe(403);
    const harmless = {
      operation: 'role.patch',
      change: 'details',
      id: shared.id,
      expectedVersion: 1,
      expectedAccessRevision: (await versions()).expectedAccessRevision,
      description: 'Display only',
    };
    expect(
      (await mutate(`roles/${shared.id}`, harmless, null, 'verified', randomUUID(), 'PATCH'))
        .statusCode,
    ).toBe(200);
  });
  it('counts a same-role multi-scope invitation once in shared permission impact and invalidates it atomically', async () => {
    const shared = await custom('Two-scope reader', ['turnstile:access', 'turnstile:units:read']);
    const issue = {
      operation: 'invitation.issue',
      ...(await versions()),
      email: `two-scope-${randomUUID()}@example.test`,
      assignments: [unit, other].map((id) => ({
        roleId: shared.id,
        expectedRoleVersion: shared.version,
        scope: { kind: 'units', unitIds: [id], includeChildren: false },
      })),
    };
    const issued = await mutate('invitations', issue, await confirm(issue));
    expect(issued.statusCode).toBe(201);
    const invitation = issued.json().current;
    const command = {
      operation: 'role.patch',
      change: 'permissions',
      ...(await versions()),
      id: shared.id,
      expectedVersion: shared.version,
      permissions: ['turnstile:access', 'turnstile:units:read', 'turnstile:units:manage'],
    };
    const impact = await preview(command);
    expect(impact.statusCode).toBe(200);
    expect(impact.json().affectedInvitationIds).toEqual([invitation.id]);
    expect(impact.json().invitationCount).toBe(1);
    const saved = await mutate(
      `roles/${shared.id}`,
      command,
      impact.json().confirmation,
      'operator',
      randomUUID(),
      'PATCH',
    );
    expect(saved.statusCode).toBe(200);
    expect((await get(`invitations/${invitation.id}`)).json().state).toBe('needs_reapproval');
  });

  it('requires current bound impact for assignment writes and retires only the explicit legacy source', async () => {
    const command = await targetCommand('member.assignments', 'operator');
    const body = {
      ...command,
      assignments: [
        {
          roleId: templates.workspace_administrator,
          expectedRoleVersion: 1,
          scope: { kind: 'company' },
        },
      ],
      retireLegacyVersion: null,
    };
    const token = await confirm(body);
    const key = randomUUID();
    const response = await mutate(
      `members/${members.operator}/assignments`,
      body,
      token,
      'operator',
      key,
      'PUT',
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().changed).toBe(false);
    expect(response.json().current.legacySource.retired).toBe(false);
    const retire = { ...body, retireLegacyVersion: 1 };
    const receipt = await mutate(
      `members/${members.operator}/assignments`,
      retire,
      await confirm(retire),
      'operator',
      randomUUID(),
      'PUT',
    );
    expect(receipt.statusCode).toBe(200);
    expect(receipt.json().current.legacySource.retired).toBe(true);
    const replay = await mutate(
      `members/${members.operator}/assignments`,
      body,
      token,
      'operator',
      key,
      'PUT',
    );
    expect(replay.statusCode).toBe(200);
    expect(replay.json().current.legacySource.retired).toBe(true);
    expect(
      (
        await mutate(
          `members/${members.verified}/assignments`,
          await targetCommand(),
          randomBytes(32).toString('base64url'),
          'operator',
          randomUUID(),
          'PUT',
        )
      ).statusCode,
    ).toBe(409);
  });
  it('applies scope-paired ceilings to removals, additions, suspension and reactivation', async () => {
    const editor = await seedRole('scoped people', ['turnstile:access', 'turnstile:people:manage']);
    await grant('verified', editor);
    await grant('verified', templates.unit_manager as string, {
      kind: 'units',
      unitIds: [unit],
      includeChildren: true,
    });
    const target = await targetCommand('member.assignments', 'passwordless');
    const allowed = {
      ...target,
      assignments: [
        {
          roleId: templates.unit_manager,
          expectedRoleVersion: 1,
          scope: { kind: 'units', unitIds: [unit], includeChildren: true },
        },
      ],
    };
    const saved = await mutate(
      `members/${members.passwordless}/assignments`,
      allowed,
      await confirm(allowed, 'verified'),
      'verified',
      randomUUID(),
      'PUT',
    );
    expect(saved.statusCode).toBe(200);
    const forbidden = {
      ...(await targetCommand('member.assignments', 'passwordless')),
      assignments: [
        {
          roleId: templates.unit_manager,
          expectedRoleVersion: 1,
          scope: { kind: 'units', unitIds: [other], includeChildren: true },
        },
      ],
    };
    expect((await preview(forbidden, 'verified')).statusCode).toBe(403);
    const protectedRole = {
      ...(await targetCommand('member.assignments', 'passwordless')),
      assignments: [
        {
          roleId: templates.workspace_administrator,
          expectedRoleVersion: 1,
          scope: { kind: 'company' },
        },
      ],
    };
    expect((await preview(protectedRole, 'verified')).statusCode).toBe(403);
  });
  it('protects the last administrator and serializes mutual suspensions by distinct subjects', async () => {
    const self = await targetCommand('member.suspend', 'operator');
    const before = await auditCount();
    const rejected = await mutate(`members/${members.operator}/suspend`, self, await confirm(self));
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().reason).toBe('last_administrator');
    expect(await auditCount()).toBe(before);
    await grant('verified', templates.workspace_administrator as string);
    const one = await targetCommand('member.suspend', 'verified'),
      two = await targetCommand('member.suspend', 'operator');
    const tokenOne = await confirm(one),
      tokenTwo = await confirm(two, 'verified');
    const responses = await Promise.all([
      mutate(`members/${members.verified}/suspend`, one, tokenOne),
      mutate(`members/${members.operator}/suspend`, two, tokenTwo, 'verified'),
    ]);
    expect(responses.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(responses.some((r) => [401, 403, 409].includes(r.statusCode))).toBe(true);
    expect(
      (
        await owned((db) =>
          db.query(
            'SELECT count(*)::int AS n FROM turnstile.access_member m WHERE tenant_id=$1 AND turnstile.people_admin($1,m.user_id)',
            [tenant],
          ),
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('rolls back mutations and command receipts when audit append fails', async () => {
    const command = await createCommand('Rollback');
    const key = randomUUID();
    const before = await versions();
    await owned((db) =>
      db.query(
        "ALTER TABLE turnstile.access_audit ADD CONSTRAINT people_fixture_fail CHECK(action<>'role_created')",
      ),
    );
    try {
      expect((await mutate('roles', command, null, 'operator', key)).statusCode).toBe(503);
    } finally {
      await owned((db) =>
        db.query('ALTER TABLE turnstile.access_audit DROP CONSTRAINT people_fixture_fail'),
      );
    }
    expect(await versions()).toEqual(before);
    expect((await get(`commands/${key}`)).statusCode).toBe(404);
    expect((await mutate('roles', command, null, 'operator', key)).statusCode).toBe(201);
  });
  it('edits shared permissions with both powers, invalidates pending approval and refuses stale impact', async () => {
    const role = await custom('Shared', ['turnstile:access', 'turnstile:units:read']);
    await grant('verified', role.id);
    const email = `invite-${randomUUID()}@example.test`;
    const issue = {
      operation: 'invitation.issue',
      ...(await versions()),
      email,
      assignments: [{ roleId: role.id, expectedRoleVersion: 1, scope: { kind: 'company' } }],
    };
    const invitation = await mutate('invitations', issue, await confirm(issue));
    expect(invitation.statusCode).toBe(201);
    const patch = {
      operation: 'role.patch',
      change: 'permissions',
      ...(await versions()),
      id: role.id,
      expectedVersion: 1,
      permissions: ['turnstile:access'],
    };
    const proof = await confirm(patch);
    const edited = await mutate(
      `roles/${role.id}`,
      patch,
      proof,
      'operator',
      randomUUID(),
      'PATCH',
    );
    expect(edited.statusCode).toBe(200);
    expect((await get(`invitations/${invitation.json().current.id}`)).json().state).toBe(
      'needs_reapproval',
    );
    expect(
      (await mutate(`roles/${role.id}`, patch, proof, 'operator', randomUUID(), 'PATCH'))
        .statusCode,
    ).toBe(409);
    expect(
      (await get(`members/${members.verified}`))
        .json()
        .assignments.find((a: { role: { id: string } }) => a.role.id === role.id).role.permissions,
    ).toEqual(['turnstile:access']);
  });
  it('shares invitation command readback, does not resend on replay, and fences cross-domain keys', async () => {
    const command = {
      operation: 'invitation.issue',
      ...(await versions()),
      email: `new-${randomUUID()}@example.test`,
      assignments: [
        { roleId: templates.member, expectedRoleVersion: 1, scope: { kind: 'company' } },
      ],
    };
    const key = randomUUID(),
      proof = await confirm(command);
    const concurrent = await Promise.all([
      mutate('invitations', command, proof, 'operator', key),
      mutate('invitations', command, proof, 'operator', key),
    ]);
    expect(concurrent.map((response) => response.statusCode).sort()).toEqual([200, 201]);
    const issued = concurrent.find((response) => response.statusCode === 201);
    if (!issued) throw new Error('Missing committed creation');
    expect(concurrent.find((response) => response.statusCode === 200)?.json().replayed).toBe(true);
    const replay = await mutate('invitations', command, proof, 'operator', key);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().replayed).toBe(true);
    expect((await get(`commands/${key}`)).json().current.id).toBe(issued.json().current.id);
    expect((await mutate('roles', await createCommand(), null, 'operator', key)).statusCode).toBe(
      409,
    );
    expect((await get(`commands/${key}`, 'verified')).statusCode).toBe(403);
    const issuedRow = issued.json().current;
    const resend = {
      operation: 'invitation.resend',
      ...(await versions()),
      id: issuedRow.id,
      expectedVersion: issuedRow.version,
      expectedGeneration: issuedRow.generation,
    };
    const resendProof = await confirm(resend),
      resendKey = randomUUID();
    const identity = app.get(IdentityClientService);
    const failures: string[] = [];
    async function probe<T>(work: () => Promise<T>): Promise<T> {
      try {
        return await work();
      } catch (error) {
        // Finite protocol codes only: never record credentials, request bodies or messages.
        failures.push(
          error instanceof Error && 'code' in error && typeof error.code === 'string'
            ? error.code
            : 'UNCLASSIFIED',
        );
        throw error;
      }
    }
    const preparation = identity.preparation.bind(identity);
    const prepare = identity.prepare.bind(identity);
    const probes = [
      vi.spyOn(identity, 'preparation').mockImplementation((id) => probe(() => preparation(id))),
      vi.spyOn(identity, 'prepare').mockImplementation((input) => probe(() => prepare(input))),
    ];
    clearIdentityProbes = () => {
      for (const probe of probes) probe.mockRestore();
    };
    const resent = await mutate(
      `invitations/${issuedRow.id}/resend`,
      resend,
      resendProof,
      'operator',
      resendKey,
    );
    expect(
      resent.statusCode,
      `Boundary classification: ${JSON.stringify({ identity: failures, database: databaseFailures })}`,
    ).toBe(200);
    expect(resent.json().current.generation).toBe(issuedRow.generation + 1);
    const repeat = await mutate(
      `invitations/${issuedRow.id}/resend`,
      resend,
      resendProof,
      'operator',
      resendKey,
    );
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().current.generation).toBe(resent.json().current.generation);
    const pendingReapproval = {
      operation: 'invitation.reapprove',
      ...(await versions()),
      id: issuedRow.id,
      expectedVersion: resent.json().current.version,
      expectedGeneration: resent.json().current.generation,
      email: command.email,
      assignments: command.assignments,
    };
    expect((await preview(pendingReapproval)).statusCode).toBe(409);
    await owned((db) =>
      db.query('SELECT turnstile.invalidate_invitations($1,ARRAY[$2::uuid])', [
        tenant,
        issuedRow.id,
      ]),
    );
    const invalidated = (await get(`invitations/${issuedRow.id}`)).json();
    expect(invalidated.state).toBe('needs_reapproval');
    expect(
      (
        await preview({
          ...resend,
          ...(await versions()),
          expectedVersion: invalidated.version,
          expectedGeneration: invalidated.generation,
        })
      ).statusCode,
    ).toBe(409);
    const reapprove = {
      operation: 'invitation.reapprove',
      ...(await versions()),
      id: issuedRow.id,
      expectedVersion: invalidated.version,
      expectedGeneration: invalidated.generation,
      email: command.email,
      assignments: [
        {
          roleId: templates.unit_manager,
          expectedRoleVersion: 1,
          scope: { kind: 'units', unitIds: [unit], includeChildren: true },
        },
      ],
    };
    const reapproved = await mutate(
      `invitations/${issuedRow.id}/reapprove`,
      reapprove,
      await confirm(reapprove),
    );
    expect(
      reapproved.statusCode,
      `Boundary classification: ${JSON.stringify({ identity: failures, database: databaseFailures })}`,
    ).toBe(200);
    const row = reapproved.json().current;
    expect(row.generation).toBe(invalidated.generation + 1);
    expect(row.assignments[0].role.id).toBe(templates.unit_manager);
    const cancel = {
      operation: 'invitation.cancel',
      id: row.id,
      expectedVersion: row.version,
      expectedGeneration: row.generation,
      expectedAccessRevision: (await versions()).expectedAccessRevision,
    };
    expect((await mutate(`invitations/${row.id}/cancel`, cancel)).statusCode).toBe(200);
    expect((await get(`commands/${key}`)).json().current.state).toBe('cancelled');
  });
  it('preserves unchanged independent sources beyond a scoped editor ceiling', async () => {
    const editor = await seedRole('limited editor', [
      'turnstile:access',
      'turnstile:people:manage',
    ]);
    await grant('verified', editor);
    await grant('verified', templates.unit_manager as string, {
      kind: 'units',
      unitIds: [unit],
      includeChildren: true,
    });
    const current = (await get(`members/${members.operator}`)).json();
    const command = {
      operation: 'member.assignments',
      ...(await versions()),
      id: current.id,
      expectedVersion: current.version,
      retireLegacyVersion: null,
      assignments: [
        ...current.assignments.map(
          (a: { role: { id: string; version: number }; scope: unknown }) => ({
            roleId: a.role.id,
            expectedRoleVersion: a.role.version,
            scope: a.scope,
          }),
        ),
        {
          roleId: templates.unit_manager,
          expectedRoleVersion: 1,
          scope: { kind: 'units', unitIds: [unit], includeChildren: true },
        },
      ],
    };
    const response = await mutate(
      `members/${members.operator}/assignments`,
      command,
      await confirm(command, 'verified'),
      'verified',
      randomUUID(),
      'PUT',
    );
    expect(response.statusCode).toBe(200);
    const saved = response.json().current;
    expect(saved.legacySource).toEqual(current.legacySource);
    expect(
      saved.assignments.find(
        (a: { role: { systemKey: string | null } }) =>
          a.role.systemKey === 'workspace_administrator',
      ).id,
    ).toBe(current.assignments[0].id);
    expect(saved.assignments).toHaveLength(2);
  });
  it('labels verified cached identity stale during an authority outage', async () => {
    const before = (await get(`members/${members.verified}`)).json();
    expect(before.identity.state).toBe('fresh');
    await owned((db) =>
      db.query(
        "UPDATE turnstile.member_display SET checked_at=now()-interval '2 minutes' WHERE tenant_id=$1 AND member_id=$2",
        [tenant, members.verified],
      ),
    );
    await rpc('suspend');
    try {
      const after = await get(`members/${members.verified}`);
      expect(after.statusCode).toBe(200);
      expect(after.json().identity.state).toBe('stale');
      expect(after.json().identity.email).toBe(before.identity.email);
      expect(after.json().userId).toBe(before.userId);
    } finally {
      await rpc('resume');
    }
  });
  it('keeps the last effective configuration manager when no protected template is assigned', async () => {
    await owned((db) =>
      db.query('DELETE FROM turnstile.access_assignment WHERE tenant_id=$1 AND member_id=$2', [
        tenant,
        members.operator,
      ]),
    );
    const manager = await seedRole('manager without protected identity', [
      'turnstile:access',
      'turnstile:people:manage',
      'turnstile:roles:manage',
    ]);
    await grant('operator', manager);
    const current = (await get(`members/${members.operator}`)).json();
    const command = {
      operation: 'member.assignments',
      ...(await versions()),
      id: current.id,
      expectedVersion: current.version,
      retireLegacyVersion: 1,
      assignments: current.assignments.map(
        (a: { role: { id: string; version: number }; scope: unknown }) => ({
          roleId: a.role.id,
          expectedRoleVersion: a.role.version,
          scope: a.scope,
        }),
      ),
    };
    const before = await versions(),
      audit = await auditCount();
    const response = await mutate(
      `members/${members.operator}/assignments`,
      command,
      await confirm(command),
      'operator',
      randomUUID(),
      'PUT',
    );
    expect(response.statusCode).toBe(409);
    expect(response.json().reason).toBe('last_configuration_manager');
    expect(await versions()).toEqual(before);
    expect(await auditCount()).toBe(audit);
    expect((await get(`members/${members.operator}`)).json().legacySource.retired).toBe(false);
  });
  it('serializes shared permission edits against new member assignments', async () => {
    const role = await custom('Concurrent role', ['turnstile:access', 'turnstile:units:read']);
    const patch = {
      operation: 'role.patch',
      change: 'permissions',
      ...(await versions()),
      id: role.id,
      expectedVersion: 1,
      permissions: ['turnstile:access'],
    };
    const assignment = {
      ...(await targetCommand()),
      assignments: [{ roleId: role.id, expectedRoleVersion: 1, scope: { kind: 'company' } }],
    };
    const proof = await confirm(assignment);
    const responses = await Promise.all([
      mutate(`roles/${role.id}`, patch, null, 'operator', randomUUID(), 'PATCH'),
      mutate(
        `members/${members.verified}/assignments`,
        assignment,
        proof,
        'operator',
        randomUUID(),
        'PUT',
      ),
    ]);
    expect(responses.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.statusCode === 409)).toHaveLength(1);
    const saved = (await get(`roles/${role.id}`)).json();
    const member = (await get(`members/${members.verified}`)).json();
    expect(member.assignments.some((a: { role: { id: string } }) => a.role.id === role.id)).toBe(
      saved.version === 1,
    );
  });
  it('rejects adding company-only powers to a role referenced by a scoped assignment', async () => {
    const role = await custom('Scoped shared', ['turnstile:access', 'turnstile:units:read']);
    await grant('verified', role.id, { kind: 'units', unitIds: [unit], includeChildren: true });
    const patch = {
      operation: 'role.patch',
      change: 'permissions',
      ...(await versions()),
      id: role.id,
      expectedVersion: 1,
      permissions: ['turnstile:access', 'turnstile:configuration:manage'],
    };
    expect((await preview(patch)).statusCode).toBe(409);
    expect((await get(`roles/${role.id}`)).json().version).toBe(1);
  });
  it('rolls back a shared edit and invalidation when the invitation audit fails', async () => {
    const role = await custom('Audit shared', ['turnstile:access', 'turnstile:units:read']);
    const issue = {
      operation: 'invitation.issue',
      ...(await versions()),
      email: `audit-${randomUUID()}@example.test`,
      assignments: [{ roleId: role.id, expectedRoleVersion: 1, scope: { kind: 'company' } }],
    };
    const invited = await mutate('invitations', issue, await confirm(issue));
    expect(invited.statusCode).toBe(201);
    const patch = {
      operation: 'role.patch',
      change: 'permissions',
      ...(await versions()),
      id: role.id,
      expectedVersion: 1,
      permissions: ['turnstile:access'],
    };
    const proof = await confirm(patch),
      key = randomUUID(),
      before = await versions(),
      audit = await auditCount();
    await owned((db) =>
      db.query(
        "ALTER TABLE turnstile.invitation_audit ADD CONSTRAINT people_fixture_invalidation CHECK(action<>'invalidated')",
      ),
    );
    try {
      expect(
        (await mutate(`roles/${role.id}`, patch, proof, 'operator', key, 'PATCH')).statusCode,
      ).toBe(503);
    } finally {
      await owned((db) =>
        db.query(
          'ALTER TABLE turnstile.invitation_audit DROP CONSTRAINT people_fixture_invalidation',
        ),
      );
    }
    expect(await versions()).toEqual(before);
    expect(await auditCount()).toBe(audit);
    expect((await get(`roles/${role.id}`)).json().version).toBe(1);
    expect((await get(`invitations/${invited.json().current.id}`)).json().state).toBe('pending');
    expect((await get(`commands/${key}`)).statusCode).toBe(404);
    expect(
      (await mutate(`roles/${role.id}`, patch, proof, 'operator', key, 'PATCH')).statusCode,
    ).toBe(200);
  });
  it('keeps a deleted subject separate from a new account using its old email', async () => {
    const email = `recycled-${randomUUID()}@example.test`;
    const former = (await rpc('create-race', { email })) as string;
    await rpc('change-email', { id: former, email });
    const memberId = randomUUID();
    await owned((db) =>
      db.query(
        "INSERT INTO turnstile.access_member(tenant_id,id,user_id,status) VALUES($1,$2,$3,'active')",
        [tenant, memberId, former],
      ),
    );
    members.former = memberId;
    await grant('former', templates.member as string);
    const old = (await get(`members/${memberId}`)).json();
    expect(old.identity.state).toBe('fresh');
    const client = app.get(IdentityClientService);
    const earlierProjection = await client.projectMembers(actor(), [memberId]);
    await rpc('delete-user', { id: former });
    const replacement = (await rpc('create-race', { email })) as string;
    await rpc('change-email', { id: replacement, email });
    expect(replacement).not.toBe(former);
    const deleted = (await get(`members/${memberId}`)).json();
    expect(deleted.userId).toBe(former);
    expect(deleted.identity.state).toBe('deleted');
    // An earlier real authority response may arrive after the newer deletion response.
    const delayed = vi.spyOn(client, 'projectMembers').mockResolvedValueOnce(earlierProjection);
    try {
      await app.get(AdministrationService).refresh(actor(), [memberId]);
    } finally {
      delayed.mockRestore();
    }
    expect(
      (
        await owned((db) =>
          db.query(
            'SELECT state FROM turnstile.member_display WHERE tenant_id=$1 AND member_id=$2',
            [tenant, memberId],
          ),
        )
      ).rows[0].state,
    ).toBe('deleted');
    const issue = {
      operation: 'invitation.issue',
      ...(await versions()),
      email,
      assignments: [
        { roleId: templates.member, expectedRoleVersion: 1, scope: { kind: 'company' } },
      ],
    };
    const rejected = await mutate('invitations', issue, await confirm(issue));
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().reason).toBe('membership_exists');
    const suspend = {
      operation: 'member.suspend',
      ...(await versions()),
      id: memberId,
      expectedVersion: deleted.version,
    };
    expect(
      (await mutate(`members/${memberId}/suspend`, suspend, await confirm(suspend))).statusCode,
    ).toBe(200);
    const fresh = { ...issue, ...(await versions()) };
    const approved = await mutate('invitations', fresh, await confirm(fresh));
    expect(approved.statusCode).toBe(201);
    expect((await get(`members/${memberId}`)).json().userId).toBe(former);
    expect(
      (
        await owned((db) =>
          db.query('SELECT id FROM turnstile.access_member WHERE tenant_id=$1 AND user_id=$2', [
            tenant,
            replacement,
          ]),
        )
      ).rowCount,
    ).toBe(0);
  });
  it('treats authority projection failure as unavailable display and keeps local suspension usable', async () => {
    await rpc('suspend');
    try {
      const response = await get('members');
      expect(response.statusCode).toBe(200);
      expect(
        response
          .json()
          .items.every((m: { identity: { state: string } }) => m.identity.state === 'unavailable'),
      ).toBe(true);
      const command = await targetCommand('member.suspend');
      const result = await mutate(
        `members/${members.verified}/suspend`,
        command,
        await confirm(command),
      );
      expect(result.statusCode).toBe(200);
      const reactivate = await targetCommand('member.reactivate');
      expect(
        (
          await mutate(
            `members/${members.verified}/reactivate`,
            reactivate,
            await confirm(reactivate),
          )
        ).statusCode,
      ).toBe(503);
    } finally {
      await rpc('resume');
    }
  });
});
