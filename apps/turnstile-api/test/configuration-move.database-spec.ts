import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  CONFIGURATION_LIMITS,
  type ConfigurationSnapshotDto,
  configurationSnapshotSchema,
  type TurnstilePermission,
} from '@thaarei/turnstile-contracts';
import type { FastifyRequest } from 'fastify';
import { Pool, type PoolClient } from 'pg';
import { createApplication } from '../src/bootstrap.js';
import { parseProductEnvironment } from '../src/infrastructure/auth-environment.js';
import { withTenant } from '../src/infrastructure/database/postgres.js';
import { BrowserAuthService } from '../src/modules/auth/browser-auth/browser-auth.service.js';
import { setUserAccess } from '../src/modules/auth/set-user-access.js';
import { configurationOperator } from '../src/modules/organization/configuration-operator.js';
import { OrganizationService } from '../src/modules/organization/organization.service.js';
import { policyFixtureAccess, resetAccessFixture } from './access-fixture.js';

const ids = ['move-fixture-manager', 'move-fixture-second', 'move-fixture-member'] as const;
const permissions: TurnstilePermission[] = ['turnstile:access', 'turnstile:configuration:manage'];
const actor = (userId: string = ids[0]) => ({ userId, requestId: randomUUID() });

describe('transactional organization subtree moves', () => {
  const config = parseProductEnvironment(process.env);
  const tenantId = config.INSTALLATION_TENANT_ID;
  const owner = new Pool({
    connectionString: process.env.TURNSTILE_MIGRATION_DATABASE_URL,
    max: 4,
  });
  const runtime = new Pool({ connectionString: config.TURNSTILE_DATABASE_URL, max: 4 });
  const owned = <T>(work: (client: PoolClient) => Promise<T>) => withTenant(owner, tenantId, work);
  let app: NestFastifyApplication;
  let organization: OrganizationService;

  beforeAll(async () => {
    app = await createApplication(false);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    organization = app.get(OrganizationService);
  });
  beforeEach(async () => {
    await resetAccessFixture(
      owner,
      ids.map((userId, index) => ({
        userId,
        permissions: index === 2 ? ['turnstile:access'] : [...permissions],
      })),
      true,
    );
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    await resetAccessFixture(owner);
    await owner.end();
    await runtime.end();
  });

  async function profile() {
    await configurationOperator('initialize', { operatorId: 'move-fixture-operator' });
    return organization.save(actor(), {
      expectedRevision: 0,
      name: 'Move fixture',
      timeZone: 'UTC',
    });
  }
  async function add(
    snapshot: ConfigurationSnapshotDto,
    parentId: string,
    name: string,
    type: 'department' | 'site' = 'department',
  ) {
    return organization.createUnit(
      actor(),
      { expectedRevision: snapshot.revision, parentId, name, type },
      randomUUID(),
    );
  }
  async function tree() {
    const saved = await profile();
    const root = saved.organization.rootId as string;
    const source = await add(saved, root, 'Operations');
    const child = await add(source.configuration, source.unitId, 'Engineering');
    const leaf = await add(child.configuration, child.unitId, 'Quality');
    const target = await add(leaf.configuration, root, 'Target site', 'site');
    return {
      snapshot: target.configuration,
      root,
      source: source.unitId,
      child: child.unitId,
      leaf: leaf.unitId,
      target: target.unitId,
    };
  }
  const move = (snapshot: ConfigurationSnapshotDto, id: string, parentId: string) =>
    organization.moveUnit(actor(), id, { expectedRevision: snapshot.revision, parentId });
  const sqlMove = (id: string, parentId: string) =>
    withTenant(runtime, tenantId, (client) =>
      client.query(
        'UPDATE turnstile.organization_unit SET parent_id = $3 WHERE tenant_id = $1 AND id = $2',
        [tenantId, id, parentId],
      ),
    );
  const moveAudit = () =>
    owned(
      async (client) =>
        (
          await client.query(
            "SELECT * FROM turnstile.configuration_audit WHERE tenant_id = $1 AND action = 'unit_moved' ORDER BY occurred_at,id",
            [tenantId],
          )
        ).rows,
    );
  async function lockWaiters(role: string, count: number) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await owner.query(
        'SELECT count(DISTINCT a.pid)::int AS total FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE NOT l.granted AND a.usename = $1 AND a.datname = current_database()',
        [role],
      );
      if (result.rows[0].total >= count) return;
      await delay(10);
    }
    throw new Error('Expected configuration lock waiters');
  }

  it.each([1, 2])(
    'moves a completed v%s subtree once, preserving references and supporting explicit lost-response reconciliation',
    async (version) => {
      if (version === 1)
        await owned((client) =>
          client.query(
            'INSERT INTO turnstile.organization_configuration (tenant_id,requirement_version) VALUES ($1,1)',
            [tenantId],
          ),
        );
      const setup = await tree();
      const complete = await organization.complete(actor(), {
        expectedRevision: setup.snapshot.revision,
      });
      const preserved = () =>
        owned(async (client) => ({
          receipts: (
            await client.query(
              'SELECT * FROM turnstile.configuration_create_receipt WHERE tenant_id = $1 ORDER BY key',
              [tenantId],
            )
          ).rows,
          grants: (
            await client.query(
              'SELECT * FROM turnstile.user_access WHERE tenant_id = $1 ORDER BY user_id',
              [tenantId],
            )
          ).rows,
        }));
      const before = await preserved();
      const request = actor();
      const moved = await organization.moveUnit(request, setup.source, {
        expectedRevision: complete.revision,
        parentId: setup.target,
      });
      expect(moved.revision).toBe(complete.revision + 1);
      expect(moved.organization).toEqual(complete.organization);
      expect(moved.setup.completion).toEqual(complete.setup.completion);
      expect(moved.setup.requirementVersion).toBe(version);
      for (const unit of complete.units)
        expect(moved.units.find((row) => row.id === unit.id)).toMatchObject({
          ...unit,
          parentId: unit.id === setup.source ? setup.target : unit.parentId,
          ancestorIds: expect.any(Array),
        });
      expect(moved.units.find((row) => row.id === setup.child)?.ancestorIds).toEqual([
        setup.root,
        setup.target,
        setup.source,
      ]);
      expect(moved.units.find((row) => row.id === setup.leaf)?.ancestorIds).toEqual([
        setup.root,
        setup.target,
        setup.source,
        setup.child,
      ]);
      expect(await preserved()).toEqual(before);
      expect(await moveAudit()).toMatchObject([
        {
          actor_kind: 'user',
          actor_id: ids[0],
          request_id: request.requestId,
          subject_id: setup.source,
          changed_fields: ['parentId'],
          revision_before: complete.revision,
          revision_after: moved.revision,
        },
      ]);
      await expect(move(complete, setup.source, setup.target)).rejects.toMatchObject({
        response: { code: 'CONFIGURATION_CONFLICT', reason: 'revision', revision: moved.revision },
      });
      const readback = await organization.read(actor());
      expect(readback.units.find((row) => row.id === setup.source)?.parentId).toBe(setup.target);
      expect(await move(readback, setup.source, setup.target)).toEqual(moved);
      expect(await moveAudit()).toHaveLength(1);
      // Round-trip to the root changes only the moved node and derived ancestry.
      const returned = await move(moved, setup.source, setup.root);
      expect(returned.units).toEqual(complete.units);
      expect(returned.setup.completion).toEqual(complete.setup.completion);
    },
  );

  it('rejects missing units, root edits, self/descendant cycles, invalid site parents and forged fields without writes', async () => {
    const setup = await tree();
    const independent = await add(setup.snapshot, setup.root, 'Independent department');
    const saved = independent.configuration;
    for (const [id, parentId, error] of [
      [randomUUID(), setup.target, { code: 'CONFIGURATION_NOT_FOUND' }],
      [setup.source, randomUUID(), { code: 'CONFIGURATION_NOT_FOUND' }],
      [
        setup.root,
        setup.target,
        { code: 'CONFIGURATION_INVALID', fieldErrors: [{ field: 'id', reason: 'unsupported' }] },
      ],
      [
        setup.source,
        setup.source,
        { code: 'CONFIGURATION_INVALID', fieldErrors: [{ field: 'parentId', reason: 'invalid' }] },
      ],
      [
        setup.source,
        setup.leaf,
        { code: 'CONFIGURATION_INVALID', fieldErrors: [{ field: 'parentId', reason: 'invalid' }] },
      ],
      [
        setup.target,
        setup.source,
        { code: 'CONFIGURATION_INVALID', fieldErrors: [{ field: 'parentId', reason: 'invalid' }] },
      ],
    ] as const)
      await expect(move(saved, id, parentId)).rejects.toMatchObject({ response: error });
    for (const selector of ['tenantId', 'actorId', 'name', 'type'])
      await expect(
        organization.moveUnit(actor(), setup.source, {
          expectedRevision: saved.revision,
          parentId: setup.target,
          [selector]: 'forged',
        }),
      ).rejects.toMatchObject({ response: { code: 'CONFIGURATION_INVALID' } });
    for (const [id, parentId] of [
      [setup.root, setup.source],
      [setup.source, setup.source],
      [setup.source, setup.leaf],
      [setup.target, setup.source],
    ])
      await expect(sqlMove(id as string, parentId as string)).rejects.toMatchObject({
        code: '23514',
      });
    await expect(sqlMove(setup.source, randomUUID())).rejects.toMatchObject({ code: '23503' });
    // Both row orders of this statement would end in a cycle; earlier row changes must roll back.
    await expect(
      withTenant(runtime, tenantId, (client) =>
        client.query(
          'UPDATE turnstile.organization_unit SET parent_id = CASE WHEN id = $2 THEN $3 ELSE $2 END WHERE tenant_id = $1 AND id IN ($2,$3)',
          [tenantId, setup.source, independent.unitId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    expect(await organization.read(actor())).toEqual(saved);
    expect(await moveAudit()).toHaveLength(0);
    expect(
      (
        await withTenant(runtime, randomUUID(), (client) =>
          client.query('UPDATE turnstile.organization_unit SET parent_id = $2 WHERE id = $1', [
            setup.source,
            setup.target,
          ]),
        )
      ).rowCount,
    ).toBe(0);
  });

  it('checks the entire moved subtree against the depth bound and accepts the exact maximum', async () => {
    const setup = await tree();
    let snapshot = setup.snapshot;
    let parent = setup.root;
    const destinations = new Map<number, string>();
    for (let depth = 2; depth <= 6; depth++) {
      const created = await add(snapshot, parent, `Destination ${depth}`);
      snapshot = created.configuration;
      parent = created.unitId;
      destinations.set(depth, parent);
    }
    await expect(move(snapshot, setup.source, parent)).rejects.toMatchObject({
      response: {
        code: 'CONFIGURATION_INVALID',
        fieldErrors: [{ field: 'parentId', reason: 'limit_reached' }],
      },
    });
    await expect(sqlMove(setup.source, parent)).rejects.toMatchObject({ code: '23514' });
    expect(await organization.read(actor())).toEqual(snapshot);
    const moved = await move(snapshot, setup.source, destinations.get(5) as string);
    expect(moved.units.find((row) => row.id === setup.leaf)?.ancestorIds).toHaveLength(
      CONFIGURATION_LIMITS.depth - 1,
    );
  });

  it('rejects duplicate destination siblings and rolls back parent/revision/ancestry when audit fails', async () => {
    const setup = await tree();
    const duplicate = await add(setup.snapshot, setup.target, 'OPERATIONS');
    await expect(move(duplicate.configuration, setup.source, setup.target)).rejects.toMatchObject({
      response: { code: 'CONFIGURATION_CONFLICT', reason: 'duplicate_name' },
    });
    await expect(sqlMove(setup.source, setup.target)).rejects.toMatchObject({ code: '23505' });
    const removed = await organization.deleteUnit(actor(), duplicate.unitId, {
      expectedRevision: duplicate.configuration.revision,
    });
    const saved = await organization.complete(actor(), { expectedRevision: removed.revision });
    await owner.query(
      "ALTER TABLE turnstile.configuration_audit ADD CONSTRAINT fixture_move_audit_failure CHECK (action <> 'unit_moved') NOT VALID",
    );
    try {
      await expect(move(saved, setup.source, setup.target)).rejects.toMatchObject({
        response: { code: 'CONFIGURATION_UNAVAILABLE' },
      });
      expect(await organization.read(actor())).toEqual(saved);
      expect(await moveAudit()).toHaveLength(0);
    } finally {
      await owner.query(
        'ALTER TABLE turnstile.configuration_audit DROP CONSTRAINT fixture_move_audit_failure',
      );
    }
  });

  it('cannot move the final qualifying v2 unit into its own subtree or clear completion', async () => {
    const saved = await profile();
    const first = await add(saved, saved.organization.rootId as string, 'First department');
    const child = await add(first.configuration, first.unitId, 'Child');
    const complete = await organization.complete(actor(), {
      expectedRevision: child.configuration.revision,
    });
    await expect(move(complete, first.unitId, child.unitId)).rejects.toMatchObject({
      response: { code: 'CONFIGURATION_INVALID' },
    });
    await expect(sqlMove(first.unitId, child.unitId)).rejects.toMatchObject({ code: '23514' });
    expect(await organization.read(actor())).toEqual(complete);
    expect(await moveAudit()).toHaveLength(0);
  });

  it('serializes competing moves so one canonical destination and one audit event win', async () => {
    const setup = await tree();
    const alternate = await add(setup.snapshot, setup.root, 'Alternate destination');
    const saved = alternate.configuration;
    const client = await owner.connect();
    let writes: Promise<PromiseSettledResult<ConfigurationSnapshotDto>[]> | undefined;
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
      await client.query(
        'SELECT * FROM turnstile.organization_configuration WHERE tenant_id = $1 FOR UPDATE',
        [tenantId],
      );
      writes = Promise.allSettled([
        move(saved, setup.source, setup.target),
        move(saved, setup.source, alternate.unitId),
      ]);
      await lockWaiters('thaarei_turnstile_runtime', 2);
      await client.query('COMMIT');
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await writes;
    }
    const results = await writes;
    expect(results?.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results?.filter((result) => result.status === 'rejected')).toMatchObject([
      {
        reason: {
          response: {
            code: 'CONFIGURATION_CONFLICT',
            reason: 'revision',
            revision: saved.revision + 1,
          },
        },
      },
    ]);
    const current = await organization.read(actor());
    expect(current.revision).toBe(saved.revision + 1);
    const parent = current.units.find((unit) => unit.id === setup.source)?.parentId;
    expect([setup.target, alternate.unitId]).toContain(parent);
    expect(current.units.find((unit) => unit.id === setup.child)?.ancestorIds).toEqual([
      setup.root,
      parent,
      setup.source,
    ]);
    expect(await moveAudit()).toHaveLength(1);
  });

  it('rechecks live manage permission after a private revocation queued ahead of the move', async () => {
    const setup = await tree();
    const client = await owner.connect();
    let grant: Promise<PromiseSettledResult<unknown>[]> | undefined;
    let moving: Promise<PromiseSettledResult<ConfigurationSnapshotDto>[]> | undefined;
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
      await client.query(
        'SELECT * FROM turnstile.organization_configuration WHERE tenant_id = $1 FOR UPDATE',
        [tenantId],
      );
      grant = Promise.allSettled([
        setUserAccess({
          operatorId: 'move-fixture-operator',
          userId: ids[0],
          enabled: true,
          permissions: ['turnstile:access'],
        }),
      ]);
      await lockWaiters('thaarei_turnstile_migrator', 1);
      moving = Promise.allSettled([move(setup.snapshot, setup.source, setup.target)]);
      await lockWaiters('thaarei_turnstile_runtime', 1);
      await client.query('COMMIT');
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await Promise.all([grant, moving]);
    }
    expect(await grant).toMatchObject([{ status: 'fulfilled' }]);
    expect(await moving).toMatchObject([
      { status: 'rejected', reason: { response: { code: 'PERMISSION_DENIED' } } },
    ]);
    expect(await organization.read(actor(ids[1]))).toEqual(setup.snapshot);
    expect(await moveAudit()).toHaveLength(0);
  });

  it('serves guarded move HTTP with finite errors, privacy/size limits and server-owned audit identity', async () => {
    const setup = await tree();
    let userId: string = ids[0];
    let currentPermissions = permissions;
    const csrf = 'move-fixture-csrf';
    vi.spyOn(app.get(BrowserAuthService), 'authenticate').mockImplementation(
      async (request: FastifyRequest) => {
        const current = {
          identity: {
            user: { id: userId, name: 'Fixture', email: 'fixture@example.test' },
            permissions: currentPermissions,
          },
          csrf,
          access: policyFixtureAccess(currentPermissions),
        } as unknown as NonNullable<FastifyRequest['productUser']>;
        request.productUser = current;
        return current;
      },
    );
    const headers = { origin: config.AUTH_PUBLIC_ORIGIN, 'x-csrf-token': csrf };
    const url = `/api/organization/units/${setup.source}/parent`;
    const payload = { expectedRevision: setup.snapshot.revision, parentId: setup.target };
    const jsonHeaders = { ...headers, 'content-type': 'application/json' };
    const inject = (extra: Record<string, string> = jsonHeaders, body: unknown = payload) =>
      app.inject({ method: 'PATCH', url, headers: extra, payload: JSON.stringify(body) });
    for (const invalid of [
      { 'content-type': 'application/json' },
      { ...jsonHeaders, origin: 'https://untrusted.example.test' },
      { ...jsonHeaders, 'sec-fetch-site': 'cross-site' },
    ]) {
      const denied = await inject(invalid);
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toEqual({ code: 'CSRF_REJECTED' });
    }
    userId = ids[2];
    currentPermissions = ['turnstile:access'];
    const forbidden = await inject(jsonHeaders);
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ code: 'PERMISSION_DENIED' });
    userId = ids[0];
    currentPermissions = permissions;
    expect(
      (await inject(jsonHeaders, { ...payload, tenantId: randomUUID(), actorId: ids[1] }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `${url}?tenantId=forged`,
          headers: jsonHeaders,
          payload,
        })
      ).statusCode,
    ).toBe(400);
    const forgedRequestId = randomUUID();
    const moved = await inject({ ...jsonHeaders, 'x-request-id': forgedRequestId });
    expect(moved.statusCode).toBe(200);
    expect(moved.headers['cache-control']).toBe('private, no-store');
    expect(moved.headers['referrer-policy']).toBe('no-referrer');
    const snapshot = configurationSnapshotSchema.parse(moved.json());
    expect(snapshot.units.find((unit) => unit.id === setup.child)?.ancestorIds).toEqual([
      setup.root,
      setup.target,
      setup.source,
    ]);
    const audits = await moveAudit();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actor_id).toBe(ids[0]);
    expect(audits[0]?.request_id).not.toBe(forgedRequestId);
    const stale = await inject(jsonHeaders);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({
      code: 'CONFIGURATION_CONFLICT',
      reason: 'revision',
      revision: snapshot.revision,
    });
    // A controller/service regression cannot send an oversized classified response.
    const oversized = vi.spyOn(organization, 'moveUnit').mockResolvedValueOnce({
      ...snapshot,
      organization: {
        ...snapshot.organization,
        name: 'x'.repeat(CONFIGURATION_LIMITS.responseBytes),
      },
    });
    const bounded = await inject(jsonHeaders, { ...payload, expectedRevision: snapshot.revision });
    oversized.mockRestore();
    expect(bounded.statusCode).toBe(503);
    expect(bounded.json()).toEqual({ code: 'CONFIGURATION_UNAVAILABLE' });
    expect(bounded.headers['cache-control']).toBe('private, no-store');
    expect(await organization.read(actor())).toEqual(snapshot);
  });
});
