import { type ChildProcess, fork } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { HttpException } from '@nestjs/common';
import {
  PEOPLE_FEATURES_HEADER,
  PEOPLE_IMPORT_FEATURE,
  type PeoplePermission,
  permissionCatalogSchema,
} from '@thaarei/turnstile-contracts';
import type { FastifyRequest } from 'fastify';
import { Pool, type PoolClient } from 'pg';
import { z } from 'zod';
import { createApplication } from '../src/bootstrap.js';
import { INVITATION_TABLES } from '../src/infrastructure/database/invitation-safety.js';
import { withTenant } from '../src/infrastructure/database/postgres.js';
import { ProductPersistenceService } from '../src/infrastructure/database/product-persistence.service.js';
import { IdentityClientService } from '../src/integrations/identity/identity-client.service.js';
import { readAccess } from '../src/modules/access/access-evaluator.js';
import { BrowserAuthService } from '../src/modules/auth/browser-auth/browser-auth.service.js';
import { OrganizationService } from '../src/modules/organization/organization.service.js';
import { AdministrationService } from '../src/modules/people/administration.service.js';
import { BulkImportWorkerService } from '../src/modules/people/bulk-import-worker.service.js';
import { InvitationService } from '../src/modules/people/invitation.service.js';
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
    await app.get(BulkImportWorkerService).beforeApplicationShutdown();
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
    await owned((db) =>
      db.query('DELETE FROM turnstile.people_import_job WHERE tenant_id=$1', [tenant]),
    );
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

  it('reads retained audit events through a narrow authorized SQL function with precise cursor order', async () => {
    await app.get(AdministrationService).refresh(actor());
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    await owned(async (db) => {
      for (const [index, id] of ids.entries())
        await db.query(
          `INSERT INTO turnstile.access_audit(tenant_id,id,actor_kind,actor_id,request_id,action,subject_id,revision_before,revision_after,occurred_at)
          VALUES($1,$2,'user',$3,$4,'member_suspended',$5,0,1,date_trunc('second',transaction_timestamp())-interval '1 second'+$6::integer*interval '1 microsecond')`,
          [tenant, id, uid(), randomUUID(), members.verified, index + 1],
        );
      await db.query(
        `INSERT INTO turnstile.access_audit(tenant_id,id,actor_kind,actor_id,request_id,action,subject_id,revision_before,revision_after,occurred_at)
        VALUES($1,$2,'user',$3,$4,'member_suspended',$5,0,1,statement_timestamp()-interval '91 days')`,
        [tenant, randomUUID(), uid(), randomUUID(), members.verified],
      );
    });
    const base = `audit?source=access&action=member_suspended&subjectId=${members.verified}&limit=1`;
    const first = await get(base);
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('private, no-store');
    expect(first.json().items.map((r: { id: string }) => r.id)).toEqual([ids[2]]);
    expect(first.json().items[0]).toHaveProperty('actorName');
    expect(first.json().items[0]).toHaveProperty('subjectLabel');
    const second = (await get(`${base}&cursor=${first.json().nextCursor}`)).json();
    expect(second.items.map((r: { id: string }) => r.id)).toEqual([ids[1]]);
    const third = (await get(`${base}&cursor=${second.nextCursor}`)).json();
    expect(third.items.map((r: { id: string }) => r.id)).toEqual([ids[0]]);
    expect(third.nextCursor).toBeNull();
    expect(
      (await get(`audit?source=invitations&cursor=${first.json().nextCursor}`)).statusCode,
    ).toBe(409);
    expect((await get('audit', 'verified')).statusCode).toBe(403);
    const roleOnly = await seedRole('Audit role editor', [
      'turnstile:access',
      'turnstile:roles:manage',
    ]);
    await grant('verified', roleOnly);
    expect((await get('audit', 'verified')).statusCode).toBe(403);
    const peopleOnly = await seedRole('People audit reader', [
      'turnstile:access',
      'turnstile:people:manage',
    ]);
    await grant('passwordless', peopleOnly);
    await owned((db) =>
      db.query(
        `INSERT INTO turnstile.access_audit(tenant_id,id,actor_kind,actor_id,request_id,action,subject_id,revision_before,revision_after)
      VALUES($1,$2,'user',$3,$4,'role_created',$5,0,1)`,
        [tenant, randomUUID(), uid(), randomUUID(), roleOnly],
      ),
    );
    const privateRole = await get('audit?source=access&action=role_created', 'passwordless');
    expect(privateRole.statusCode).toBe(200);
    expect(privateRole.json().items[0]).not.toHaveProperty('subjectLabel');
    const runtime = new Pool({ connectionString: process.env.TURNSTILE_DATABASE_URL });
    try {
      await expect(
        withTenant(runtime, tenant, (db) => db.query('SELECT * FROM turnstile.access_audit')),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        withTenant(runtime, tenant, (db) =>
          db.query(
            'SELECT * FROM turnstile.read_people_audit($1,$2,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,25)',
            [tenant, uid('verified')],
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        withTenant(runtime, tenant, (db) =>
          db.query(
            'SELECT * FROM turnstile.read_people_audit($1,$2,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,25)',
            [randomUUID(), uid()],
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await runtime.end();
    }
  });
  it('explains contextual access using the owning evaluator and denies unauthorized unit inspection', async () => {
    const manager = await seedRole('Inspector manager', [
      'turnstile:access',
      'turnstile:units:manage',
    ]);
    await grant('verified', manager, { kind: 'units', unitIds: [unit], includeChildren: true });
    const exact = await get(
      `members/${members.verified}/access?permission=turnstile:units:read&unitId=${unit}`,
    );
    expect(exact.statusCode).toBe(200);
    expect(exact.json().allowed).toBe(true);
    expect(exact.json().sources.map((s: { name: string }) => s.name)).toEqual([
      'Inspector manager',
    ]);
    expect(
      (
        await get(
          `members/${members.verified}/access?permission=turnstile:units:read&unitId=${other}`,
        )
      ).json().allowed,
    ).toBe(false);
    expect(
      (await get(`members/${members.verified}/access?permission=turnstile:units:read`)).json()
        .allowed,
    ).toBe(false);
    const companyOnly = (
      await get(
        `members/${members.operator}/access?permission=turnstile:people:manage&unitId=${unit}`,
      )
    ).json();
    expect(companyOnly).toMatchObject({ allowed: false, reason: 'company_only' });
    const peopleOnly = await seedRole('People inspector', [
      'turnstile:access',
      'turnstile:people:manage',
    ]);
    await grant('passwordless', peopleOnly);
    expect(
      (
        await get(
          `members/${members.verified}/access?permission=turnstile:units:read&unitId=${unit}`,
          'passwordless',
        )
      ).statusCode,
    ).toBe(403);
    await owned((db) =>
      db.query(
        "UPDATE turnstile.access_member SET status='suspended',version=version+1 WHERE tenant_id=$1 AND id=$2",
        [tenant, members.verified],
      ),
    );
    expect(
      (
        await get(
          `members/${members.verified}/access?permission=turnstile:units:read&unitId=${unit}`,
        )
      ).json(),
    ).toMatchObject({ allowed: false, reason: 'suspended', sources: [] });
  });
  it('sorts member names with captured cursor values and binds cursors to the selected sort', async () => {
    await app.get(AdministrationService).refresh(actor());
    const first = await get('members?limit=1&sort=name_desc');
    expect(first.statusCode).toBe(200);
    const cursor = first.json().nextCursor;
    expect(cursor).toBeTruthy();
    const second = await get(`members?limit=1&sort=name_desc&cursor=${cursor}`);
    expect(second.statusCode).toBe(200);
    expect(second.json().items[0].id).not.toBe(first.json().items[0].id);
    expect((await get(`members?limit=1&sort=name&cursor=${cursor}`)).statusCode).toBe(409);
    const asc = (await get('members?limit=100&sort=name')).json().items;
    const desc = (await get('members?limit=100&sort=name_desc')).json().items;
    expect(desc.map((m: { id: string }) => m.id)).toEqual(
      asc.map((m: { id: string }) => m.id).reverse(),
    );
  });
  it('filters actionable role invitations and effective delivery before counts and pagination', async () => {
    const command = {
      operation: 'invitation.issue',
      email: 'filtered-one@example.test',
      assignments: [
        { roleId: templates.member, expectedRoleVersion: 1, scope: { kind: 'company' } },
      ],
      ...(await versions()),
    };
    const first = await mutate('invitations', command, await confirm(command));
    expect(first.statusCode).toBe(201);
    const secondCommand = { ...command, email: 'filtered-two@example.test', ...(await versions()) };
    const second = await mutate('invitations', secondCommand, await confirm(secondCommand));
    expect(second.statusCode).toBe(201);
    const base = `invitations?roleId=${templates.member}&actionable=true&delivery=queued&sort=created_desc&limit=1`;
    const page = await get(base);
    expect(page.statusCode).toBe(200);
    expect(page.json().total).toBe(2);
    expect(page.json().items[0].id).toBe(second.json().current.id);
    const next = await get(`${base}&cursor=${page.json().nextCursor}`);
    expect(next.json().items[0].id).toBe(first.json().current.id);
    expect(
      (await get(`invitations?delivery=failed&cursor=${page.json().nextCursor}`)).statusCode,
    ).toBe(409);
    await owned((db) =>
      db.query(
        "UPDATE turnstile.invitation SET created_at=statement_timestamp()-interval '8 days',expires_at=statement_timestamp()-interval '1 day' WHERE tenant_id=$1 AND id=$2",
        [tenant, first.json().current.id],
      ),
    );
    const failed = await get('invitations?delivery=failed');
    expect(failed.statusCode).toBe(200);
    expect(failed.json().total).toBe(1);
    expect(failed.json().items[0].delivery).toMatchObject({ state: 'failed', reason: 'expired' });
    expect((await get(`invitations?roleId=${templates.member}&actionable=true`)).json().total).toBe(
      1,
    );
    expect((await get(`invitations?roleId=${templates.unit_manager}`)).json().total).toBe(0);
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
  it('filters the complete member set by a paired role and coverage, binds cursors and restricts usage counts', async () => {
    const reader = await seedRole('site reader', ['turnstile:access', 'turnstile:units:read']);
    const manager = await seedRole('site manager', [
      'turnstile:access',
      'turnstile:units:read',
      'turnstile:units:manage',
    ]);
    await grant('verified', reader, { kind: 'units', unitIds: [unit], includeChildren: true });
    await grant('verified', manager, { kind: 'units', unitIds: [other], includeChildren: false });
    await grant('unverified', reader, { kind: 'company' });
    const matched = await get(`members?roleId=${reader}&unitId=${unit}&limit=1`);
    expect(matched.statusCode).toBe(200);
    expect(matched.json().total).toBe(2);
    expect(matched.json().items).toHaveLength(1);
    expect(
      (await get(`members?roleId=${reader}&unitId=${other}`))
        .json()
        .items.map((m: { id: string }) => m.id),
    ).toEqual([members.unverified]);
    expect(
      (
        await get(
          `members?roleId=${reader}&unitId=${other}&limit=1&cursor=${matched.json().nextCursor}`,
        )
      ).statusCode,
    ).toBe(409);
    const counts = (await get('roles'))
      .json()
      .usage.find((r: { roleId: string }) => r.roleId === reader);
    expect(counts.memberCount).toBe(2);
    expect(counts.invitationCount).toBe(0);
    const roleOnly = await seedRole('role only reader', [
      'turnstile:access',
      'turnstile:roles:manage',
    ]);
    await grant('passwordless', roleOnly);
    expect((await get('roles', 'passwordless')).json()).not.toHaveProperty('usage');
    const peopleOnly = await seedRole('people only reader', [
      'turnstile:access',
      'turnstile:people:manage',
    ]);
    await grant('passwordless', peopleOnly);
    expect((await get(`members?unitId=${unit}`, 'passwordless')).statusCode).toBe(403);
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
    expect(roleCatalog.permissions).toHaveLength(9);
    expect(roleCatalog.catalogVersion).toBe(2);
    for (const id of ['turnstile:incidents:read', 'turnstile:risks:read'])
      expect(roleCatalog.permissions).toContainEqual({
        id,
        applicability: 'company_only',
        implies: [],
      });
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
    const activeMembers = async () =>
      Number(
        (await owned((db) => db.query('SELECT turnstile.deployment_summary() AS value'))).rows[0]
          .value.activeMembers,
      );
    const beforeUsage = await activeMembers();
    const self = await targetCommand('member.suspend', 'operator');
    const before = await auditCount();
    const rejected = await mutate(`members/${members.operator}/suspend`, self, await confirm(self));
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().reason).toBe('last_administrator');
    expect(await activeMembers()).toBe(beforeUsage);
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
    expect(await activeMembers()).toBe(beforeUsage - 1);
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
  const importPost = (path: string, payload: object, label = 'operator', token = csrf) =>
    app.inject({
      method: 'POST',
      url: `/api/people/${path}`,
      headers: { origin, 'x-test-user': uid(label), 'x-csrf-token': token },
      payload,
    });
  async function newImport(
    csv = `email\nnew-${randomUUID()}@example.test\n`,
    roleId = templates.member,
  ) {
    const body = {
      id: randomUUID(),
      filename: 'recipients.csv',
      csv,
      assignments: [{ roleId, expectedRoleVersion: 1, scope: { kind: 'company' } }],
    };
    const result = await importPost('imports', body);
    expect(result.statusCode, JSON.stringify(databaseFailures)).toBe(200);
    return { body, ...result.json() };
  }
  async function startImport(id: string, version = 1) {
    const result = await importPost(`imports/${id}/actions`, {
      action: 'start',
      expectedVersion: version,
    });
    expect(result.statusCode, JSON.stringify(databaseFailures)).toBe(200);
    return result.json();
  }
  it('validates CSV with durable duplicate-safe drafts, permission/CSRF fences and a bounded large preview', async () => {
    const preview = await newImport(
      `email\n${fixture.users.verified?.email}\nfirst@example.test\nFIRST@example.test\nbad\nextra@example.test,extra\n`,
    );
    expect(preview.job.counts).toMatchObject({ pending: 1, skipped: 2, failed: 2 });
    const repeated = await importPost('imports', preview.body);
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().job.id).toBe(preview.job.id);
    const runtime = app.get(ProductPersistenceService).pool;
    if (!runtime) throw new Error('Missing runtime database');
    const isolated = await withTenant(runtime, randomUUID(), (db) =>
      db.query('SELECT * FROM turnstile.people_import_job'),
    );
    expect(isolated.rowCount).toBe(0);

    expect(
      (await importPost('imports', { ...preview.body, csv: 'email\nother@example.test' }))
        .statusCode,
    ).toBe(409);
    expect((await importPost('imports', preview.body, 'verified')).statusCode).toBe(403);
    expect((await importPost('imports', preview.body, 'operator', 'bad')).statusCode).toBe(403);
    expect((await get('imports', 'verified')).statusCode).toBe(403);
    const large = await newImport(
      'email\n' +
        Array.from(
          { length: 500 },
          (_, i) => `recipient-number-${i}-long-address@example.test`,
        ).join('\n'),
    );
    expect(large.rows).toHaveLength(25);
    expect(large.job.counts.pending).toBe(500);
    expect(large.nextAfter).toBe(26);
    expect((await get(`imports/${large.job.id}?after=26`)).json().rows[0].number).toBe(27);
    expect(
      (
        await importPost('imports', {
          ...preview.body,
          id: randomUUID(),
          csv: 'email\n"unterminated',
        })
      ).statusCode,
    ).toBe(400);
  }, 20000);
  it('recovers a crashed claim after lease expiry with the same row key and never reissues after a lost commit acknowledgement', async () => {
    const preview = await newImport();
    await startImport(preview.job.id);
    const worker = app.get(BulkImportWorkerService),
      first = await worker.claim();
    expect(first).toBeDefined();
    await owned((db) =>
      db.query(
        `UPDATE turnstile.people_import_job SET lease_expires_at=statement_timestamp()-interval '1 second' WHERE tenant_id=$1 AND id=$2`,
        [tenant, preview.job.id],
      ),
    );
    const replacement = await worker.claim();
    expect(replacement?.row.command_key).toBe(first?.row.command_key);
    if (!first || !replacement) throw new Error('Missing recovery claims');
    await worker.process(first); // fenced stale worker cannot issue anything
    const invitations = app.get(InvitationService),
      original = invitations.execute.bind(invitations);
    const spy = vi.spyOn(invitations, 'execute').mockImplementation(async (...args) => {
      await original(...args);
      throw new HttpException({ code: 'PEOPLE_UNAVAILABLE' }, 503);
    });
    try {
      await worker.process(replacement);
    } finally {
      spy.mockRestore();
    }
    const result = (await get(`imports/${preview.job.id}`)).json();
    expect(result.job.state).toBe('completed');
    expect(result.job.counts.succeeded).toBe(1);
    expect(await worker.claim()).toBeUndefined();
    const saved = (await get(`invitations/${result.rows[0].invitationId}`)).json();
    const cancel = {
      operation: 'invitation.cancel',
      id: saved.id,
      expectedVersion: saved.version,
      expectedGeneration: saved.generation,
      expectedAccessRevision: (await versions()).expectedAccessRevision,
    };
    expect((await mutate(`invitations/${saved.id}/cancel`, cancel)).statusCode).toBe(200);
    await worker.process(replacement);
    expect((await get(`invitations/${saved.id}`)).json().state).toBe('cancelled');
    const count = await owned((db) =>
      db.query(
        'SELECT count(*)::int AS count FROM turnstile.invitation WHERE tenant_id=$1 AND email=$2',
        [tenant, preview.rows[0].email],
      ),
    );
    expect(count.rows[0]?.count).toBe(1);
  });
  it('cancels during real identity preparation and fences the final invitation commit', async () => {
    const preview = await newImport();
    await startImport(preview.job.id);
    const worker = app.get(BulkImportWorkerService),
      claim = await worker.claim();
    const client = app.get(IdentityClientService),
      original = client.prepare.bind(client);
    const spy = vi.spyOn(client, 'prepare').mockImplementation(async (...args) => {
      const prepared = await original(...args);
      const current = (await get(`imports/${preview.job.id}`)).json();
      const cancelled = await importPost(`imports/${preview.job.id}/actions`, {
        action: 'cancel',
        expectedVersion: current.job.version,
      });
      expect(cancelled.statusCode).toBe(200);
      return prepared;
    });
    try {
      if (!claim) throw new Error('Missing import claim');
      await worker.process(claim);
    } finally {
      spy.mockRestore();
    }
    const current = (await get(`imports/${preview.job.id}`)).json();
    expect(current.job.state).toBe('cancelled');
    expect(current.job.counts.cancelled).toBe(1);
    expect((await get('invitations')).json().total).toBe(0);
  });
  it('pauses for revoked creator authority and resumes only with restored current authority', async () => {
    const preview = await newImport();
    await startImport(preview.job.id);
    const worker = app.get(BulkImportWorkerService),
      claim = await worker.claim();
    await grant('verified', templates.workspace_administrator as string);
    const suspend = await targetCommand('member.suspend', 'operator');
    expect(
      (
        await mutate(
          `members/${members.operator}/suspend`,
          suspend,
          await confirm(suspend, 'verified'),
          'verified',
        )
      ).statusCode,
    ).toBe(200);
    if (!claim) throw new Error('Missing import claim');
    await worker.process(claim);
    const paused = await owned((db) =>
      db.query(
        'SELECT state,reason FROM turnstile.people_import_job WHERE tenant_id=$1 AND id=$2',
        [tenant, preview.job.id],
      ),
    );
    expect(paused.rows[0]).toEqual({ state: 'paused', reason: 'permission_changed' });
    const target = (await get(`members/${members.operator}`, 'verified')).json();
    const reactivate = {
      operation: 'member.reactivate',
      ...(await versions()),
      id: target.id,
      expectedVersion: target.version,
    };
    expect(
      (
        await mutate(
          `members/${members.operator}/reactivate`,
          reactivate,
          await confirm(reactivate, 'verified'),
          'verified',
        )
      ).statusCode,
    ).toBe(200);
    const detail = (await get(`imports/${preview.job.id}`)).json();
    expect(
      (
        await importPost(`imports/${preview.job.id}/actions`, {
          action: 'resume',
          expectedVersion: detail.job.version,
        })
      ).statusCode,
    ).toBe(200);
    await worker.drain();
    expect((await get(`imports/${preview.job.id}`)).json().job.counts.succeeded).toBe(1);
  });
  it('waits for existing invitation rate budgets without consuming a row command or attempt', async () => {
    const preview = await newImport();
    await startImport(preview.job.id);
    await owned((db) =>
      db.query(
        `INSERT INTO turnstile.invitation_rate(tenant_id,actor,"window",count) VALUES($1,'installation',to_timestamp(floor(extract(epoch FROM statement_timestamp())/3600)*3600),100) ON CONFLICT(tenant_id,actor,"window") DO UPDATE SET count=100`,
        [tenant],
      ),
    );
    expect(await app.get(BulkImportWorkerService).claim()).toBeUndefined();
    const detail = (await get(`imports/${preview.job.id}`)).json();
    expect(detail.job.state).toBe('queued');
    expect(detail.job.reason).toBe('rate_limit');
    const row = await owned((db) =>
      db.query(
        'SELECT attempts,command FROM turnstile.people_import_row WHERE tenant_id=$1 AND job_id=$2',
        [tenant, preview.job.id],
      ),
    );
    expect(row.rows[0]).toEqual({ attempts: 0, command: null });
  });
  it('pauses changed reviewed roles and keeps all row errors available for download', async () => {
    const role = await custom('Import role', ['turnstile:access']);
    const preview = await newImport('email\nnew@example.test\nbad\nnew@example.test', role.id);
    await startImport(preview.job.id);
    const patch = {
      operation: 'role.patch',
      change: 'details',
      id: role.id,
      expectedVersion: role.version,
      expectedAccessRevision: (await versions()).expectedAccessRevision,
      name: 'Updated import role',
    };
    expect(
      (await mutate(`roles/${role.id}`, patch, null, 'operator', randomUUID(), 'PATCH')).statusCode,
    ).toBe(200);
    await app.get(BulkImportWorkerService).drain();
    const detail = (await get(`imports/${preview.job.id}`)).json();
    expect(detail.job.state).toBe('paused');
    expect(detail.job.reason).toBe('context_changed');
    const errors = await get(`imports/${preview.job.id}/errors`);
    expect(errors.statusCode).toBe(200);
    expect(errors.json().rows).toHaveLength(2);
    expect((await get('invitations')).json().total).toBe(0);
  });
  it('rolls back invitation creation when the durable row receipt cannot commit, then retries the same reservation', async () => {
    const preview = await newImport();
    await startImport(preview.job.id);
    const worker = app.get(BulkImportWorkerService),
      first = await worker.claim();
    if (!first) throw new Error('Missing claim');
    await owned(async (db) => {
      await db.query(
        `CREATE FUNCTION turnstile.test_import_receipt_failure() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ BEGIN IF NEW.state='succeeded' THEN RAISE EXCEPTION 'fixture_receipt_failure'; END IF; RETURN NEW; END $$`,
      );
      await db.query(
        'CREATE TRIGGER test_import_receipt_failure BEFORE UPDATE ON turnstile.people_import_row FOR EACH ROW EXECUTE FUNCTION turnstile.test_import_receipt_failure()',
      );
    });
    try {
      await worker.process(first);
    } finally {
      await owned(async (db) => {
        await db.query('DROP TRIGGER test_import_receipt_failure ON turnstile.people_import_row');
        await db.query('DROP FUNCTION turnstile.test_import_receipt_failure()');
      });
    }
    expect((await get('invitations')).json().total).toBe(0);
    expect((await get(`imports/${preview.job.id}`)).json().job.counts.succeeded).toBe(0);
    await owned((db) =>
      db.query(
        'UPDATE turnstile.people_import_job SET next_attempt_at=statement_timestamp() WHERE tenant_id=$1 AND id=$2',
        [tenant, preview.job.id],
      ),
    );
    const retry = await worker.claim();
    if (!retry) throw new Error('Missing retry claim');
    expect(retry.row.command_key).toBe(first.row.command_key);
    await worker.process(retry);
    expect((await get(`imports/${preview.job.id}`)).json().job.counts.succeeded).toBe(1);
    expect((await get('invitations')).json().total).toBe(1);
  });
  it('keeps the catalog readable by an open pre-import client while new clients opt in', async () => {
    // Freeze the pre-import key set, rather than silently loosening strict readers.
    const shape = permissionCatalogSchema.shape;
    const legacy = z.strictObject({
      catalogVersion: shape.catalogVersion,
      usersInsights: shape.usersInsights,
      memberAssignmentFilters: shape.memberAssignmentFilters,
      organizationRevision: shape.organizationRevision,
      grantableCompanyPermissions: shape.grantableCompanyPermissions,
      permissions: shape.permissions,
      starters: shape.starters,
    });
    const oldPage = await get('catalog');
    expect(oldPage.statusCode).toBe(200);
    expect(legacy.safeParse(oldPage.json()).success).toBe(true);
    expect(oldPage.json()).not.toHaveProperty('durableImports');
    const newPage = await app.inject({
      method: 'GET',
      url: '/api/people/catalog',
      headers: { 'x-test-user': uid(), [PEOPLE_FEATURES_HEADER]: PEOPLE_IMPORT_FEATURE },
    });
    expect(newPage.statusCode).toBe(200);
    expect(permissionCatalogSchema.parse(newPage.json()).durableImports).toBe(1);
    expect(legacy.safeParse(newPage.json()).success).toBe(false);
    expect((await get(`members/${members.operator}`)).statusCode).toBe(200);
  });
});
