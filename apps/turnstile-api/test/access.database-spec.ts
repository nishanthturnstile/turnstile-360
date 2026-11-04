import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  type AssignmentScopeDto,
  assignmentScopeSchema,
  PEOPLE_LIMITS,
  TURNSTILE_PERMISSIONS,
} from '@thaarei/turnstile-contracts';
import { Pool, type PoolClient } from 'pg';
import { bootstrapInstallation, migrateDatabase } from '../src/infrastructure/database/migrate.js';
import { withTenant } from '../src/infrastructure/database/postgres.js';
import { ProductPersistenceService } from '../src/infrastructure/database/product-persistence.service.js';
import {
  accessCounts,
  covers,
  coversGrants,
  hasShell,
  readAccess,
  scopeKey,
} from '../src/modules/access/access-evaluator.js';
import { accessOperator } from '../src/modules/access/access-operator.js';
import { ACCESS_TABLES, accessSchemaSafe } from '../src/modules/access/access-safety.js';
import { setUserAccess } from '../src/modules/auth/set-user-access.js';
import { configurationOperator } from '../src/modules/organization/configuration-operator.js';
import { closeFixturePool } from './access-fixture.js';

describe('canonical access foundation on owning PostgreSQL roles', () => {
  // Dedicated synthetic database in the harness cluster; no shared/live data reset.
  const database = `access_fixture_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: process.env.PROVISION_DATABASE_URL, max: 1 });
  const environment = { ...process.env };
  const tenantId = environment.INSTALLATION_TENANT_ID as string;
  const operator = { operatorId: 'access-fixture' };
  let owner: Pool;
  let runtime: Pool;
  let persistence: ProductPersistenceService;
  let created = false;
  let authority: Server;
  let proofSubject = 'chosen-administrator';
  let verified = true;
  let active = true;
  const company = { kind: 'company' } as const;
  const tree = { root: randomUUID(), a: randomUUID(), child: randomUUID(), b: randomUUID() };
  const owned = <T>(work: (client: PoolClient) => Promise<T>) => withTenant(owner, tenantId, work);
  const effective = (userId: string) =>
    withTenant(runtime, tenantId, (client) => readAccess(client, tenantId, userId));
  const revision = () =>
    owned(
      async (client) =>
        (
          await client.query('SELECT revision FROM turnstile.access_context WHERE tenant_id = $1', [
            tenantId,
          ])
        ).rows[0].revision as number,
    );
  const initialize = () => accessOperator('initialize', operator, environment);
  const legacy = async (
    userId: string,
    enabled = true,
    permissions: string[] = ['turnstile:access'],
  ) => {
    if (
      !(
        await owned((client) =>
          client.query('SELECT 1 FROM turnstile.access_context WHERE tenant_id = $1', [tenantId]),
        )
      ).rowCount
    ) {
      // Explicit historical input before import, never a production grant reader.
      await owned((client) =>
        client.query(
          'INSERT INTO turnstile.user_access (tenant_id,user_id,enabled,permissions) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,user_id) DO UPDATE SET enabled = EXCLUDED.enabled,permissions = EXCLUDED.permissions',
          [tenantId, userId, enabled, permissions],
        ),
      );
      return { changed: true };
    }
    return setUserAccess({ ...operator, userId, enabled, permissions }, environment);
  };

  async function assign(
    userId: string,
    systemKey: string,
    scope: AssignmentScopeDto,
    existing = false,
  ) {
    return owned(async (client) => {
      let member = (
        await client.query(
          'SELECT id FROM turnstile.access_member WHERE tenant_id = $1 AND user_id = $2',
          [tenantId, userId],
        )
      ).rows[0]?.id as string | undefined;
      if (!existing && !member) {
        member = randomUUID();
        await client.query(
          "INSERT INTO turnstile.access_member (tenant_id,id,user_id,status) VALUES ($1,$2,$3,'active')",
          [tenantId, member, userId],
        );
      }
      const role = (
        await client.query(
          'SELECT id FROM turnstile.access_role WHERE tenant_id = $1 AND system_key = $2',
          [tenantId, systemKey],
        )
      ).rows[0].id as string;
      const id = randomUUID();
      await client.query(
        'INSERT INTO turnstile.access_assignment (tenant_id,id,member_id,role_id,scope_kind,include_children,scope_key) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          tenantId,
          id,
          member,
          role,
          scope.kind,
          scope.kind === 'units' && scope.includeChildren,
          scopeKey(scope),
        ],
      );
      if (scope.kind === 'units')
        await client.query(
          'INSERT INTO turnstile.access_scope_anchor (tenant_id,assignment_id,unit_id) SELECT $1,$2,unnest($3::uuid[])',
          [tenantId, id, scope.unitIds],
        );
      return id;
    });
  }

  async function hierarchy() {
    await owned(async (client) => {
      await client.query(
        "INSERT INTO turnstile.organization_unit (tenant_id,id,type) VALUES ($1,$2,'organization')",
        [tenantId, tree.root],
      );
      await client.query(
        "UPDATE turnstile.organization_configuration SET name = 'Fixture',root_id = $2,revision = revision + 1 WHERE tenant_id = $1",
        [tenantId, tree.root],
      );
      for (const [id, parent, name] of [
        [tree.a, tree.root, 'a'],
        [tree.b, tree.root, 'b'],
        [tree.child, tree.a, 'child'],
      ])
        await client.query(
          "INSERT INTO turnstile.organization_unit (tenant_id,id,type,parent_id,name,name_key) VALUES ($1,$2,'department',$3,$4,$4)",
          [tenantId, id, parent, name],
        );
    });
  }

  beforeAll(async () => {
    expect(environment.AUTH_PROFILE).toBe('test');
    expect(new URL(environment.PROVISION_DATABASE_URL as string).pathname).toBe('/auth_fixture');
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    await admin.query(`REVOKE ALL ON DATABASE "${database}" FROM PUBLIC`);
    await admin.query(
      `GRANT CONNECT, CREATE ON DATABASE "${database}" TO thaarei_turnstile_migrator`,
    );
    await admin.query(`GRANT CONNECT ON DATABASE "${database}" TO thaarei_turnstile_runtime`);
    for (const key of ['TURNSTILE_DATABASE_URL', 'TURNSTILE_MIGRATION_DATABASE_URL'] as const) {
      const url = new URL(environment[key] as string);
      url.pathname = `/${database}`;
      environment[key] = url.toString();
    }
    const adminUrl = new URL(environment.PROVISION_DATABASE_URL as string);
    adminUrl.pathname = `/${database}`;
    const isolated = new Pool({ connectionString: adminUrl.toString(), max: 1 });
    try {
      await isolated.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    } finally {
      await isolated.end();
    }
    await migrateDatabase('turnstile', environment);
    await bootstrapInstallation(environment);
    owner = new Pool({ connectionString: environment.TURNSTILE_MIGRATION_DATABASE_URL, max: 4 });
    runtime = new Pool({ connectionString: environment.TURNSTILE_DATABASE_URL, max: 2 });
    vi.stubEnv('TURNSTILE_DATABASE_URL', environment.TURNSTILE_DATABASE_URL);
    persistence = new ProductPersistenceService();
    // Narrow HTTP fixture exercises proof validation over real HTTP outside locks.
    // The authority's provider behavior has its separate owning integration tests.
    authority = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.url === '/identity/oauth2/introspect' && request.method === 'POST') {
        let body = '';
        for await (const chunk of request) body += chunk;
        const token = new URLSearchParams(body).get('token');
        response.end(
          JSON.stringify({
            active: active && token === 'fixture-userinfo-token',
            sub: proofSubject,
            client_id: environment.AUTH_LOGIN_CLIENT_ID,
            iss: environment.AUTH_ISSUER_URL,
            aud: `${environment.AUTH_ISSUER_URL}/oauth2/userinfo`,
            token_type: 'bearer',
            exp: Math.floor(Date.now() / 1000) + 60,
          }),
        );
      } else if (
        request.url === '/identity/oauth2/userinfo' &&
        request.headers.authorization === 'Bearer fixture-userinfo-token'
      ) {
        response.end(JSON.stringify({ sub: proofSubject, email_verified: verified }));
      } else {
        response.statusCode = 403;
        response.end('{}');
      }
    });
    await new Promise<void>((resolve) => authority.listen(0, '127.0.0.1', resolve));
    environment.AUTH_PUBLIC_ORIGIN = `http://127.0.0.1:${(authority.address() as AddressInfo).port}`;
    environment.AUTH_ISSUER_URL = `${environment.AUTH_PUBLIC_ORIGIN}/identity`;
    environment.AUTH_LOGIN_CALLBACK_URL = `${environment.AUTH_PUBLIC_ORIGIN}/api/auth/callback`;
  });
  beforeEach(async () => {
    await owner.query(
      `TRUNCATE ${ACCESS_TABLES.map((table) => `turnstile.${table}`).join(',')},turnstile.user_access,turnstile.organization_configuration CASCADE`,
    );
    await configurationOperator('initialize', operator, environment);
    proofSubject = 'chosen-administrator';
    verified = true;
    active = true;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) =>
      authority ? authority.close(() => resolve()) : resolve(),
    );
    await closeFixturePool(persistence?.pool, () => persistence.onApplicationShutdown());
    await closeFixturePool(runtime);
    await closeFixturePool(owner);
    vi.unstubAllEnvs();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
  });

  it('imports the complete enabled/disabled legacy matrix once without role promotion, broadening or inventory writes', async () => {
    const matrix = Array.from({ length: 16 }, (_, index) => ({
      userId: `legacy-${index}`,
      enabled: index < 8,
      permissions: TURNSTILE_PERMISSIONS.filter((_, bit) => (index % 8) & (1 << bit)),
    }));
    await owned(async (client) => {
      for (const value of matrix)
        await client.query(
          'INSERT INTO turnstile.user_access (tenant_id,user_id,enabled,permissions) VALUES ($1,$2,$3,$4)',
          [tenantId, value.userId, value.enabled, value.permissions],
        );
    });
    expect(await persistence.ready()).toBe(false);
    expect(await initialize()).toMatchObject({
      changed: true,
      revision: 1,
      publicWritesEnabled: false,
    });
    for (const value of matrix) {
      const access = await effective(value.userId);
      expect(access.status).toBe(value.enabled ? 'active' : 'suspended');
      expect(access.context.grants).toHaveLength(1);
      expect([...(access.context.grants[0]?.permissions ?? [])].sort()).toEqual(
        [...value.permissions].sort(),
      );
      expect(hasShell(access)).toBe(
        value.enabled && value.permissions.includes('turnstile:access'),
      );
      expect(access.protectedAdministrator).toBe(false);
      expect(covers(access, 'turnstile:dms:capabilities:read', company)).toBe(
        hasShell(access) && value.permissions.includes('turnstile:dms:capabilities:read'),
      );
    }
    const snapshot = () =>
      owned(
        async (client) =>
          (await client.query('SELECT * FROM turnstile.access_legacy_source ORDER BY member_id'))
            .rows,
      );
    const before = await snapshot();
    expect(await initialize()).toMatchObject({ changed: false, revision: 1 });
    expect(await snapshot()).toEqual(before);
    expect(await owned((client) => accessCounts(client, tenantId))).toEqual({
      administrators: 0,
      managers: 2,
    });
    expect(
      await owned(
        async (client) =>
          (await client.query('SELECT count(*)::int AS total FROM turnstile.access_assignment'))
            .rows[0].total,
      ),
    ).toBe(0);
    await expect(
      owned((client) =>
        client.query('UPDATE turnstile.user_access SET enabled = false WHERE tenant_id = $1', [
          tenantId,
        ]),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    expect(await persistence.ready()).toBe(true);
    // Even an already compatible query cannot read retired flat authorization.
    await expect(
      withTenant(
        runtime,
        tenantId,
        async (client) =>
          (
            await client.query(`SELECT * FROM turnstile.user_access a WHERE user_id = 'legacy-7'
      AND NOT EXISTS (SELECT 1 FROM turnstile.access_context c WHERE c.tenant_id = a.tenant_id)`)
          ).rowCount,
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('evaluates role-only entry and paired exact/subtree coverage without widening through a company shell source', async () => {
    await hierarchy();
    await initialize();
    await assign('scoped', 'unit_manager', {
      kind: 'units',
      unitIds: [tree.a],
      includeChildren: true,
    });
    await assign('scoped', 'member', company, true);
    const access = await effective('scoped');
    expect(hasShell(access)).toBe(true);
    expect(access.context.grants).toHaveLength(2);
    for (const id of [tree.a, tree.child])
      expect(
        covers(access, 'turnstile:units:manage', {
          kind: 'units',
          unitIds: [id],
          includeChildren: false,
        }),
      ).toBe(true);
    expect(
      covers(access, 'turnstile:units:manage', {
        kind: 'units',
        unitIds: [tree.b],
        includeChildren: false,
      }),
    ).toBe(false);
    for (const action of [
      'turnstile:people:manage',
      'turnstile:configuration:manage',
      'turnstile:units:manage',
      'unknown',
    ])
      expect(covers(access, action, company)).toBe(false);
    expect(
      coversGrants(access, [
        {
          sourceId: randomUUID(),
          permissions: ['turnstile:units:manage'],
          scope: { kind: 'units', unitIds: [tree.child], includeChildren: true },
        },
      ]),
    ).toBe(true);
    await assign('exact', 'unit_manager', {
      kind: 'units',
      unitIds: [tree.child],
      includeChildren: false,
    });
    expect(
      covers(await effective('exact'), 'turnstile:units:manage', {
        kind: 'units',
        unitIds: [tree.child],
        includeChildren: true,
      }),
    ).toBe(false);
    expect(
      coversGrants(await effective('absent'), [
        { sourceId: randomUUID(), permissions: ['turnstile:access'], scope: company },
      ]),
    ).toBe(false);
  });

  it('persists the full sixteen-anchor contract for both exact and inherited unit scopes', async () => {
    await hierarchy();
    await initialize();
    const anchors = [
      tree.a,
      tree.b,
      ...Array.from({ length: PEOPLE_LIMITS.anchorsPerAssignment - 2 }, () => randomUUID()),
    ];
    await owned(async (db) => {
      for (const [index, id] of anchors.slice(2).entries())
        await db.query(
          "INSERT INTO turnstile.organization_unit(tenant_id,id,type,parent_id,name,name_key) VALUES($1,$2,'department',$3,$4,$4)",
          [tenantId, id, tree.root, `Anchor ${index}`],
        );
    });
    for (const includeChildren of [false, true]) {
      const scope = assignmentScopeSchema.parse({
        kind: 'units',
        unitIds: anchors,
        includeChildren,
      });
      expect(scopeKey(scope)).toHaveLength(includeChildren ? 602 : 603);
      const subject = includeChildren ? 'sixteen-inherited' : 'sixteen-exact';
      await assign(subject, 'unit_manager', scope);
      const access = await effective(subject);
      expect(access.context.grants[0]?.scope).toEqual({ ...scope, unitIds: [...anchors].sort() });
      expect(covers(access, 'turnstile:units:manage', scope)).toBe(true);
    }
  });

  it('serializes concurrent private changes to preserve the last effective company manager', async () => {
    const permissions = ['turnstile:access', 'turnstile:configuration:manage'];
    await legacy('manager-a', true, permissions);
    await legacy('manager-b', true, permissions);
    await initialize();
    const results = await Promise.allSettled([
      legacy('manager-a', false, permissions),
      legacy('manager-b', false, permissions),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'LAST_CONFIGURATION_MANAGER_REQUIRED' },
    });
    expect(await owned((client) => accessCounts(client, tenantId))).toEqual({
      administrators: 0,
      managers: 1,
    });
    expect(await revision()).toBe(2);
    expect(
      await owned(
        async (client) =>
          (
            await client.query(
              "SELECT count(*)::int AS total FROM turnstile.access_audit WHERE action = 'legacy_replaced'",
            )
          ).rows[0].total,
      ),
    ).toBe(1);
  });

  it('requires explicit live verified identity proof for protected role-only bootstrap and atomic handover', async () => {
    await initialize();
    const input = {
      ...operator,
      key: randomUUID(),
      expectedRevision: 1,
      userId: proofSubject,
      identityAccessToken: 'fixture-userinfo-token',
    };
    verified = false;
    await expect(accessOperator('bootstrap-administrator', input, environment)).rejects.toThrow();
    verified = true;
    active = false;
    await expect(accessOperator('bootstrap-administrator', input, environment)).rejects.toThrow();
    active = true;
    await expect(
      accessOperator('bootstrap-administrator', { ...input, userId: 'different' }, environment),
    ).rejects.toThrow();
    expect(await accessOperator('bootstrap-administrator', input, environment)).toMatchObject({
      changed: true,
      revision: 2,
    });
    expect((await effective(proofSubject)).protectedAdministrator).toBe(true);
    expect(covers(await effective(proofSubject), 'turnstile:dms:capabilities:read', company)).toBe(
      false,
    );
    expect(await accessOperator('bootstrap-administrator', input, environment)).toMatchObject({
      changed: false,
      replayed: true,
      revision: 2,
    });
    await expect(legacy(proofSubject, false)).rejects.toMatchObject({
      code: 'LAST_ADMINISTRATOR_REQUIRED',
    });
    const original = proofSubject;
    proofSubject = 'explicit-successor';
    expect(
      await accessOperator(
        'handover-administrator',
        {
          ...input,
          key: randomUUID(),
          expectedRevision: 2,
          userId: proofSubject,
          fromUserId: original,
        },
        environment,
      ),
    ).toMatchObject({ changed: true, revision: 3 });
    expect((await effective(original)).protectedAdministrator).toBe(false);
    expect((await effective(proofSubject)).protectedAdministrator).toBe(true);
    expect(await owned((client) => accessCounts(client, tenantId))).toEqual({
      administrators: 1,
      managers: 1,
    });
    expect(await configurationOperator('inspect', operator, environment)).toMatchObject({
      managers: { total: 1, ids: [proofSubject], truncated: false },
      state: 'not_started',
      completion: null,
    });
    expect(
      await owned(async (client) =>
        (
          await client.query(
            "SELECT subject_user_id FROM turnstile.access_audit WHERE action = 'administrator_handed_over' ORDER BY subject_user_id",
          )
        ).rows.map((row) => row.subject_user_id),
      ),
    ).toEqual([original, proofSubject].sort());
    expect(
      await owned(
        async (client) =>
          (await client.query('SELECT count(*)::int AS total FROM turnstile.user_access')).rows[0]
            .total,
      ),
    ).toBe(0);
  });

  it('retires legacy independently and replays current suspended state without restoring access', async () => {
    await legacy('member', true, ['turnstile:access', 'turnstile:dms:capabilities:read']);
    await initialize();
    await assign('member', 'member', company, true);
    const input = {
      ...operator,
      key: randomUUID(),
      expectedRevision: 1,
      userId: 'member',
      expectedLegacyVersion: 1,
    };
    expect(await accessOperator('retire-legacy', input, environment)).toMatchObject({
      changed: true,
      revision: 2,
    });
    expect(hasShell(await effective('member'))).toBe(true);
    expect(covers(await effective('member'), 'turnstile:dms:capabilities:read', company)).toBe(
      false,
    );
    expect(await legacy('member', false)).toMatchObject({ changed: true, revision: 3 });
    expect(await accessOperator('retire-legacy', input, environment)).toMatchObject({
      changed: false,
      replayed: true,
      revision: 3,
      current: { status: 'suspended' },
    });
    expect(
      await accessOperator('inspect', { ...operator, userId: 'member' }, environment),
    ).toMatchObject({
      current: { status: 'suspended' },
      legacySource: { retired: true },
    });
    expect(hasShell(await effective('member'))).toBe(false);
    await expect(
      accessOperator('retire-legacy', { ...input, userId: 'other' }, environment),
    ).rejects.toMatchObject({ code: 'ACCESS_CONFLICT' });
    expect(await legacy('member', true)).toMatchObject({ changed: true, revision: 4 });
    expect(covers(await effective('member'), 'turnstile:dms:capabilities:read', company)).toBe(
      false,
    );
    expect(await legacy('member', true)).toMatchObject({ changed: false, revision: 4 });
  });

  it('rolls back status, permissions and revision when required audit insertion fails', async () => {
    await legacy('member');
    await initialize();
    await owner.query(
      `CREATE FUNCTION turnstile.fail_access_audit_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$`,
    );
    await owner.query(
      'CREATE TRIGGER fail_access_audit_fixture BEFORE INSERT ON turnstile.access_audit FOR EACH ROW EXECUTE FUNCTION turnstile.fail_access_audit_fixture()',
    );
    try {
      await expect(legacy('member', false)).rejects.toThrow('fixture audit failure');
    } finally {
      await owner.query('DROP TRIGGER fail_access_audit_fixture ON turnstile.access_audit');
      await owner.query('DROP FUNCTION turnstile.fail_access_audit_fixture()');
    }
    expect(hasShell(await effective('member'))).toBe(true);
    expect(await revision()).toBe(1);
  });

  it('forces tenant isolation and closed runtime writes across every new table, including truthful append-only audit', async () => {
    await legacy('member');
    await initialize();
    expect(await owned(accessSchemaSafe)).toBe(true);
    for (const table of ACCESS_TABLES.filter((table) => table !== 'access_audit')) {
      expect((await runtime.query(`SELECT * FROM turnstile.${table}`)).rows).toHaveLength(0);
      expect(
        await withTenant(
          runtime,
          randomUUID(),
          async (client) => (await client.query(`SELECT * FROM turnstile.${table}`)).rows,
        ),
      ).toHaveLength(0);
      await expect(
        withTenant(runtime, tenantId, (client) => client.query(`DELETE FROM turnstile.${table}`)),
      ).rejects.toMatchObject({ code: '42501' });
    }
    await expect(
      withTenant(runtime, tenantId, (client) =>
        client.query('UPDATE turnstile.access_member SET status = $1', ['active']),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(runtime.query('SELECT * FROM turnstile.access_audit')).rejects.toMatchObject({
      code: '42501',
    });
    const audit = (kind: string) =>
      withTenant(runtime, tenantId, (client) =>
        client.query(
          `INSERT INTO turnstile.access_audit
      (tenant_id,id,actor_kind,actor_id,request_id,action,revision_before,revision_after) VALUES ($1,$2,$3,'fixture-user',$4,'member_suspended',1,2)`,
          [tenantId, randomUUID(), kind, randomUUID()],
        ),
      );
    await expect(audit('operator')).rejects.toMatchObject({ code: '42501' });
    await audit('user');
    await expect(
      withTenant(runtime, tenantId, (client) => client.query('DELETE FROM turnstile.access_audit')),
    ).rejects.toMatchObject({ code: '42501' });
    await owner.query('ALTER TABLE turnstile.access_scope_anchor NO FORCE ROW LEVEL SECURITY');
    try {
      expect(await owned(accessSchemaSafe)).toBe(false);
      await expect(accessOperator('verify', operator, environment)).rejects.toThrow(
        'Access schema unsafe',
      );
    } finally {
      await owner.query('ALTER TABLE turnstile.access_scope_anchor FORCE ROW LEVEL SECURITY');
    }
    await owner.query(
      'GRANT UPDATE (status) ON turnstile.access_member TO thaarei_turnstile_runtime',
    );
    try {
      expect(await owned(accessSchemaSafe)).toBe(false);
    } finally {
      await owner.query(
        'REVOKE UPDATE (status) ON turnstile.access_member FROM thaarei_turnstile_runtime',
      );
    }
  });

  it('permits only tenant-bound ordered locking through the runtime function and rejects unsafe function readiness', async () => {
    await initialize();
    expect(await persistence.ready()).toBe(true);
    await expect(
      runtime.query('SELECT turnstile.lock_access_context($1::uuid)', [tenantId]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withTenant(runtime, randomUUID(), (client) =>
        client.query('SELECT turnstile.lock_access_context($1::uuid)', [tenantId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await withTenant(runtime, tenantId, async (client) => {
      await client.query('SELECT turnstile.lock_access_context($1::uuid)', [tenantId]);
      expect((await client.query('SELECT current_user AS name')).rows[0].name).toBe(
        'thaarei_turnstile_runtime',
      );
    });
    await expect(
      withTenant(runtime, tenantId, async (client) => {
        await client.query('SELECT turnstile.lock_access_context($1::uuid)', [tenantId]);
        await client.query('UPDATE turnstile.access_context SET revision = revision + 1');
      }),
    ).rejects.toMatchObject({ code: '42501' });
    await owner.query('ALTER FUNCTION turnstile.lock_access_context(uuid) RESET ALL');
    try {
      expect(await persistence.ready()).toBe(false);
      await expect(accessOperator('verify', operator, environment)).rejects.toThrow(
        'Canonical access not ready',
      );
    } finally {
      await owner.query(
        'ALTER FUNCTION turnstile.lock_access_context(uuid) SET search_path = pg_catalog, pg_temp',
      );
    }
    expect(await persistence.ready()).toBe(true);
  });

  it('rejects mixed applicability, mutable system roles and incomplete permission sets at commit', async () => {
    await hierarchy();
    await initialize();
    await expect(
      assign('bad', 'configuration_manager', {
        kind: 'units',
        unitIds: [tree.a],
        includeChildren: true,
      }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      owned((client) =>
        client.query(
          "UPDATE turnstile.access_role SET name = 'Forged' WHERE system_key = 'member'",
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      owned((client) =>
        client.query(
          "DELETE FROM turnstile.access_role_permission WHERE permission = 'turnstile:access'",
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      owned((client) =>
        client.query(
          "INSERT INTO turnstile.access_member (tenant_id,id,user_id,status) VALUES ($1,$2,'wrong-tenant','active')",
          [randomUUID(), randomUUID()],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('fingerprints only the current actor sources and affected live hierarchy', async () => {
    await hierarchy();
    await initialize();
    await assign('scoped', 'unit_manager', {
      kind: 'units',
      unitIds: [tree.a],
      includeChildren: true,
    });
    const before = await effective('scoped');
    await legacy('unrelated');
    const unrelated = await effective('scoped');
    expect(unrelated.context.accessRevision).toBeGreaterThan(before.context.accessRevision);
    expect(unrelated.context.fingerprint).toBe(before.context.fingerprint);
    await owned((client) =>
      client.query(
        'UPDATE turnstile.organization_unit SET parent_id = $2 WHERE tenant_id = $1 AND id = $3',
        [tenantId, tree.b, tree.child],
      ),
    );
    expect((await effective('scoped')).context.fingerprint).not.toBe(before.context.fingerprint);
    expect(
      covers(await effective('scoped'), 'turnstile:units:read', {
        kind: 'units',
        unitIds: [tree.child],
        includeChildren: false,
      }),
    ).toBe(false);
  });

  it('bounds inspection and private maintenance to the shared retention/batch limits', async () => {
    await initialize();
    await owned(async (client) => {
      await client.query(
        `INSERT INTO turnstile.access_audit (tenant_id,id,actor_kind,actor_id,request_id,action,revision_before,revision_after,occurred_at)
        SELECT $1,gen_random_uuid(),'operator','fixture',gen_random_uuid(),'legacy_imported',0,1,statement_timestamp() - interval '91 days' FROM generate_series(1,1100)`,
        [tenantId],
      );
      await client.query(
        `INSERT INTO turnstile.access_command_receipt (tenant_id,actor_id,key,operation,digest,created_at,expires_at)
        VALUES ($1,'fixture',$2,'legacy.retire',$3,statement_timestamp() - interval '2 days',statement_timestamp() - interval '1 day')`,
        [tenantId, randomUUID(), '0'.repeat(64)],
      );
    });
    const inspected = await accessOperator('inspect', operator, environment);
    expect('audit' in inspected && inspected.audit).toHaveLength(100);
    expect(await accessOperator('prune', operator, environment)).toMatchObject({
      auditDeleted: 1000,
      receiptsDeleted: 0,
      impactsDeleted: 0,
    });
    expect(await accessOperator('prune', operator, environment)).toMatchObject({
      auditDeleted: 100,
      receiptsDeleted: 1,
      impactsDeleted: 0,
    });
    expect(await accessOperator('prune', operator, environment)).toMatchObject({
      auditDeleted: 0,
      receiptsDeleted: 0,
      impactsDeleted: 0,
    });
    expect(await revision()).toBe(1);
  });
});
