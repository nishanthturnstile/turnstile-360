import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  CONFIGURATION_LIMITS,
  type ConfigurationSnapshotDto,
  type TurnstilePermission,
} from '@thaarei/turnstile-contracts';
import type { FastifyRequest } from 'fastify';
import { Pool, type PoolClient } from 'pg';
import { createApplication } from '../src/bootstrap.js';
import { parseProductEnvironment } from '../src/infrastructure/auth-environment.js';
import { withTenant } from '../src/infrastructure/database/postgres.js';
import { accessCounts, readAccess } from '../src/modules/access/access-evaluator.js';
import { BrowserAuthService } from '../src/modules/auth/browser-auth/browser-auth.service.js';
import { setUserAccess } from '../src/modules/auth/set-user-access.js';
import { configurationOperator } from '../src/modules/organization/configuration-operator.js';
import { OrganizationService } from '../src/modules/organization/organization.service.js';
import { policyFixtureAccess, resetAccessFixture } from './access-fixture.js';

const ids = [
  'configuration-fixture-manager',
  'configuration-fixture-second',
  'configuration-fixture-member',
] as const;
const permissions: TurnstilePermission[] = ['turnstile:access', 'turnstile:configuration:manage'];
const actor = (userId = ids[0] as string) => ({ userId, requestId: randomUUID() });
const operator = { operatorId: 'fixture-operator' };

describe('canonical audited organization configuration', () => {
  const config = parseProductEnvironment(process.env);
  const tenantId = config.INSTALLATION_TENANT_ID;
  const owner = new Pool({
    connectionString: process.env.TURNSTILE_MIGRATION_DATABASE_URL,
    max: 4,
  });
  const runtime = new Pool({ connectionString: config.TURNSTILE_DATABASE_URL, max: 4 });
  let app: NestFastifyApplication;
  let organization: OrganizationService;
  const owned = <T>(work: (client: PoolClient) => Promise<T>) => withTenant(owner, tenantId, work);
  async function start() {
    app = await createApplication(false);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    organization = app.get(OrganizationService);
  }
  async function initialize() {
    return configurationOperator('initialize', operator);
  }
  async function auditCount(action?: string) {
    return owned(
      async (client) =>
        (
          await client.query(
            `SELECT count(*)::int AS total FROM turnstile.${action === 'legacy_replaced' ? 'access_audit' : 'configuration_audit'} WHERE tenant_id = $1 AND ($2::text IS NULL OR action = $2)`,
            [tenantId, action ?? null],
          )
        ).rows[0].total as number,
    );
  }
  async function profile() {
    await initialize();
    return organization.save(actor(), {
      expectedRevision: 0,
      name: 'Example Company',
      timeZone: 'UTC',
    });
  }
  async function create(
    snapshot: ConfigurationSnapshotDto,
    parentId: string,
    name: string,
    type: 'department' | 'site' = 'department',
    key: string = randomUUID(),
  ) {
    return organization.createUnit(
      actor(),
      { expectedRevision: snapshot.revision, parentId, name, type },
      key,
    );
  }
  async function readyProfile() {
    const saved = await profile();
    return (await create(saved, saved.organization.rootId as string, 'Operations')).configuration;
  }
  beforeAll(start);
  beforeEach(async () => {
    // Disposable installation only. Do not replace production initialization with these fixture grants.
    await resetAccessFixture(
      owner,
      ids.map((userId, index) => ({
        userId,
        permissions: index === 2 ? ['turnstile:access'] : [...permissions],
      })),
      true,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await app?.close();
    await resetAccessFixture(owner);
    await owner.end();
    await runtime.end();
  });

  it('requires explicit initialization, repeats safely under contention and rejects installation/operator mismatches', async () => {
    expect(await configurationOperator('verify-installation', operator)).toMatchObject({
      action: 'configuration-verify-installation',
      tenantId,
      applicationId: config.TURNSTILE_APPLICATION_ID,
    });
    await expect(organization.read(actor())).rejects.toMatchObject({
      response: { code: 'CONFIGURATION_UNAVAILABLE' },
    });
    const results = await Promise.all([initialize(), initialize()]);
    expect(
      results.map((result) => 'alreadyInitialized' in result && result.alreadyInitialized).sort(),
    ).toEqual([false, true]);
    expect(await auditCount('initialized')).toBe(1);
    const initial = await organization.read(actor());
    expect(initial.organization).toEqual({ name: null, timeZone: null, rootId: null });
    expect(initial.units).toHaveLength(0);
    expect(initial.setup.state).toBe('not_started');
    expect(initial.setup.requirementVersion).toBe(2);
    expect(initial.setup.requirements.find((item) => item.id === 'first_unit')?.satisfied).toBe(
      false,
    );
    for (const replacement of [
      { INSTALLATION_TENANT_ID: randomUUID() },
      { INSTALLATION_CUSTOMER_KEY: 'another' },
      { TURNSTILE_APPLICATION_ID: randomUUID() },
    ])
      await expect(
        configurationOperator('initialize', operator, { ...process.env, ...replacement }),
      ).rejects.toThrow('Existing fixed installation required');
    await expect(
      configurationOperator('initialize', { ...operator, tenantId }),
    ).rejects.toMatchObject({ name: 'ZodError' });
    await expect(
      configurationOperator('initialize', operator, {
        ...process.env,
        TURNSTILE_MIGRATION_DATABASE_URL: config.TURNSTILE_DATABASE_URL,
      }),
    ).rejects.toThrow('Dedicated product migrator required');
  });

  it('persists partial/shared progress and one root through restart, rename and concurrent v2 activation', async () => {
    await initialize();
    const regional = await organization.save(actor(), { expectedRevision: 0, timeZone: 'UTC' });
    expect(regional.organization.rootId).toBeNull();
    const saved = await organization.save(actor(ids[1]), {
      expectedRevision: 1,
      name: '  Example\u00a0Company  ',
    });
    expect(saved.organization.name).toBe('Example Company');
    const root = saved.organization.rootId;
    expect(saved.units).toHaveLength(1);
    expect(saved.setup.nextStep).toBe('structure');
    await app.close();
    await start();
    expect((await organization.read(actor())).organization).toEqual(saved.organization);
    const renamed = await organization.save(actor(), {
      expectedRevision: 2,
      name: 'Renamed Company',
    });
    expect(renamed.organization.rootId).toBe(root);
    expect(renamed.units[0]?.name).toBe('Renamed Company');
    const events = await auditCount();
    const noop = await organization.save(actor(), { expectedRevision: 3, name: 'Renamed Company' });
    expect(noop.revision).toBe(3);
    expect(await auditCount()).toBe(events);
    const ready = await create(renamed, root as string, 'First site', 'site');
    const complete = await Promise.all([
      organization.complete(actor(), { expectedRevision: ready.configuration.revision }),
      organization.complete(actor(ids[1]), { expectedRevision: ready.configuration.revision }),
    ]);
    expect(complete[0]?.setup.completion).toEqual(complete[1]?.setup.completion);
    expect(complete[0]?.revision).toBe(5);
    expect(await auditCount('setup_completed')).toBe(1);
    const repeated = await organization.complete(actor(), { expectedRevision: 0 });
    expect(repeated.setup.completion).toEqual(complete[0]?.setup.completion);
    const updated = await organization.save(actor(), {
      expectedRevision: 5,
      timeZone: 'Europe/London',
    });
    expect(updated.organization.rootId).toBe(root);
    expect(updated.setup.completion).toEqual(repeated.setup.completion);
    await initialize();
    expect((await organization.read(actor())).revision).toBe(6);
    expect(await auditCount('initialized')).toBe(1);
    await expect(
      organization.save(actor(), { expectedRevision: 6, name: null }),
    ).rejects.toMatchObject({ response: { code: 'CONFIGURATION_INVALID' } });
  });

  it('rejects stale concurrent writes without overwrite and never activates missing required values', async () => {
    await initialize();
    await expect(organization.complete(actor(), { expectedRevision: 0 })).rejects.toMatchObject({
      response: { code: 'CONFIGURATION_INVALID' },
    });
    const results = await Promise.allSettled(
      ['First Company', 'Second Company'].map((name) =>
        organization.save(actor(), { expectedRevision: 0, name }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason.response).toEqual({
      code: 'CONFIGURATION_CONFLICT',
      reason: 'revision',
      revision: 1,
    });
    expect(await auditCount('profile_saved')).toBe(1);
    const saved = await organization.read(actor());
    await expect(organization.complete(actor(), { expectedRevision: 1 })).rejects.toMatchObject({
      response: {
        code: 'CONFIGURATION_INVALID',
        fieldErrors: [{ field: 'timeZone', reason: 'required' }],
      },
    });
    await expect(
      organization.save(actor(), { expectedRevision: 1, name: 'Forgery', tenantId: randomUUID() }),
    ).rejects.toMatchObject({ response: { code: 'CONFIGURATION_INVALID' } });
    expect((await organization.read(actor())).organization).toEqual(saved.organization);
  });

  it.each(['site', 'department'] as const)(
    'requires a saved direct-child %s and protects completed v2 from last-unit removal',
    async (type) => {
      const saved = await profile();
      const root = saved.organization.rootId as string;
      expect(saved.setup).toMatchObject({ requirementVersion: 2, nextStep: 'structure' });
      await expect(
        organization.complete(actor(), { expectedRevision: saved.revision }),
      ).rejects.toMatchObject({
        response: {
          code: 'CONFIGURATION_INVALID',
          fieldErrors: [{ field: 'body', reason: 'required' }],
        },
      });
      expect(await organization.read(actor())).toEqual(saved);
      await expect(
        withTenant(runtime, tenantId, (client) =>
          client.query(
            'UPDATE turnstile.organization_configuration SET completed_at = statement_timestamp(), completed_by = $2, revision = revision + 1 WHERE tenant_id = $1',
            [tenantId, ids[0]],
          ),
        ),
      ).rejects.toMatchObject({ code: '23514', constraint: 'configuration_first_unit' });
      const first = await create(saved, root, 'First unit', type);
      expect(first.configuration.setup.nextStep).toBe('review');
      const removed = await organization.deleteUnit(actor(), first.unitId, {
        expectedRevision: first.configuration.revision,
      });
      expect(removed.setup.nextStep).toBe('structure');
      expect(removed.organization).toEqual(saved.organization);
      const replacement = await create(removed, root, 'First unit', type);
      const complete = await organization.complete(actor(), {
        expectedRevision: replacement.configuration.revision,
      });
      expect(complete.setup.completion?.requirementVersion).toBe(2);
      const events = await auditCount();
      await expect(
        organization.deleteUnit(actor(), replacement.unitId, {
          expectedRevision: complete.revision,
        }),
      ).rejects.toMatchObject({
        response: {
          code: 'CONFIGURATION_CONFLICT',
          reason: 'required_unit',
          revision: complete.revision,
        },
      });
      await expect(
        withTenant(runtime, tenantId, (client) =>
          client.query('DELETE FROM turnstile.organization_unit WHERE tenant_id = $1 AND id = $2', [
            tenantId,
            replacement.unitId,
          ]),
        ),
      ).rejects.toMatchObject({ code: '23514', constraint: 'configuration_first_unit' });
      expect(await organization.read(actor())).toEqual(complete);
      expect(await auditCount()).toBe(events);
      expect(await configurationOperator('inspect', operator)).toMatchObject({
        requirementVersion: 2,
        state: 'completed',
        completion: complete.setup.completion,
      });
      const second = await create(complete, root, 'Second unit', type);
      // Runtime has DELETE on units: a bulk statement must also preserve the invariant
      // and roll back its earlier row deletions when it reaches the final direct child.
      await expect(
        withTenant(runtime, tenantId, (client) =>
          client.query(
            "DELETE FROM turnstile.organization_unit WHERE tenant_id = $1 AND type <> 'organization'",
            [tenantId],
          ),
        ),
      ).rejects.toMatchObject({ code: '23514', constraint: 'configuration_first_unit' });
      expect(await organization.read(actor())).toEqual(second.configuration);
      const kept = await organization.deleteUnit(actor(), replacement.unitId, {
        expectedRevision: second.configuration.revision,
      });
      expect(kept.units).toHaveLength(2);
      expect(kept.setup.completion).toEqual(complete.setup.completion);
    },
  );

  it('restricts requirement upgrades to metadata-only owning writes without relaxing tenant/runtime privileges', async () => {
    await owned((client) =>
      client.query(
        'INSERT INTO turnstile.organization_configuration (tenant_id,requirement_version) VALUES ($1,1)',
        [tenantId],
      ),
    );
    for (const query of [
      'UPDATE turnstile.organization_configuration SET requirement_version = 2, revision = revision + 1 WHERE tenant_id = $1',
      "UPDATE turnstile.organization_configuration SET requirement_version = 2, time_zone = 'UTC' WHERE tenant_id = $1",
    ])
      await expect(owned((client) => client.query(query, [tenantId]))).rejects.toMatchObject({
        code: '23514',
      });
    await expect(
      withTenant(runtime, tenantId, async (client) => {
        await client.query("SELECT set_config('app.configuration_upgrade','true',true)");
        return client.query(
          'UPDATE turnstile.organization_configuration SET requirement_version = 2 WHERE tenant_id = $1',
          [tenantId],
        );
      }),
    ).rejects.toMatchObject({ code: '42501' });
    await withTenant(owner, randomUUID(), async (client) =>
      expect(
        (
          await client.query(
            'UPDATE turnstile.organization_configuration SET requirement_version = 2 WHERE tenant_id = $1',
            [tenantId],
          )
        ).rowCount,
      ).toBe(0),
    );
    await owned((client) =>
      client.query(
        'UPDATE turnstile.organization_configuration SET requirement_version = 2 WHERE tenant_id = $1',
        [tenantId],
      ),
    );
    expect(await organization.read(actor())).toMatchObject({
      revision: 0,
      setup: { requirementVersion: 2, state: 'not_started' },
    });
    await expect(
      owned((client) =>
        client.query(
          'UPDATE turnstile.organization_configuration SET requirement_version = 1 WHERE tenant_id = $1',
          [tenantId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    expect(await auditCount()).toBe(0);
  });

  it.each(['activation', 'deletion'] as const)(
    'serializes contending completion/deletion when %s acquires the lock first',
    async (firstAction) => {
      const saved = await readyProfile();
      const unit = saved.units.find((row) => row.type !== 'organization');
      const client = await owner.connect();
      const writes = {
        activation: () => organization.complete(actor(), { expectedRevision: saved.revision }),
        deletion: () =>
          organization.deleteUnit(actor(), unit?.id, { expectedRevision: saved.revision }),
      };
      const waitFor = async (count: number) => {
        for (let attempt = 0; attempt < 100; attempt++) {
          const result = await owner.query(
            "SELECT count(DISTINCT a.pid)::int AS total FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE NOT l.granted AND a.usename = 'thaarei_turnstile_runtime' AND a.datname = current_database()",
          );
          if (result.rows[0].total >= count) return;
          await delay(10);
        }
        throw new Error('Expected configuration lock waiters');
      };
      let first: Promise<PromiseSettledResult<ConfigurationSnapshotDto>[]> | undefined;
      let second: Promise<PromiseSettledResult<ConfigurationSnapshotDto>[]> | undefined;
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
        await client.query(
          'SELECT * FROM turnstile.organization_configuration WHERE tenant_id = $1 FOR UPDATE',
          [tenantId],
        );
        first = Promise.allSettled([writes[firstAction]()]);
        await waitFor(1);
        second = Promise.allSettled([
          writes[firstAction === 'activation' ? 'deletion' : 'activation'](),
        ]);
        await waitFor(2);
        await client.query('COMMIT');
      } finally {
        await client.query('ROLLBACK');
        client.release();
        await Promise.all([first, second]);
      }
      expect(await first).toMatchObject([{ status: 'fulfilled' }]);
      expect(await second).toMatchObject([
        {
          status: 'rejected',
          reason: { response: { code: 'CONFIGURATION_CONFLICT', reason: 'revision' } },
        },
      ]);
      const after = await organization.read(actor());
      expect(after.revision).toBe(saved.revision + 1);
      expect(after.setup.nextStep).toBe(firstAction === 'activation' ? null : 'structure');
      expect(await auditCount('setup_completed')).toBe(firstAction === 'activation' ? 1 : 0);
      expect(await auditCount('unit_deleted')).toBe(firstAction === 'deletion' ? 1 : 0);
      if (firstAction === 'deletion')
        await expect(
          organization.complete(actor(), { expectedRevision: after.revision }),
        ).rejects.toMatchObject({ response: { code: 'CONFIGURATION_INVALID' } });
    },
  );

  it('enforces supported ancestry, sibling names, immutable edits, leaf deletion and bounded identical create replay', async () => {
    let snapshot = await profile();
    const root = snapshot.organization.rootId as string;
    const key = randomUUID();
    const body = {
      expectedRevision: snapshot.revision,
      type: 'site',
      parentId: root,
      name: 'Main Site',
    };
    const creations = await Promise.all([
      organization.createUnit(actor(), body, key),
      organization.createUnit(actor(), body, key),
    ]);
    expect(creations.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(creations[0]?.unitId).toBe(creations[1]?.unitId);
    expect(await auditCount('unit_created')).toBe(1);
    const site = creations[0]?.unitId as string;
    snapshot = creations[0]?.configuration as ConfigurationSnapshotDto;
    await expect(organization.createUnit(actor(ids[1]), body, key)).rejects.toMatchObject({
      response: { reason: 'idempotency_mismatch' },
    });
    await expect(
      organization.createUnit(actor(), { ...body, name: 'Changed' }, key),
    ).rejects.toMatchObject({ response: { reason: 'idempotency_mismatch' } });
    await expect(create(snapshot, root, 'main site')).rejects.toMatchObject({
      response: { reason: 'duplicate_name' },
    });
    const department = await create(snapshot, site, 'Operations');
    snapshot = department.configuration;
    expect(snapshot.units.find((unit) => unit.id === department.unitId)?.ancestorIds).toEqual([
      root,
      site,
    ]);
    await expect(create(snapshot, department.unitId, 'Bad Site', 'site')).rejects.toMatchObject({
      response: { code: 'CONFIGURATION_INVALID' },
    });
    const rootDepartment = await create(snapshot, root, 'Operations');
    snapshot = rootDepartment.configuration;
    await expect(
      organization.renameUnit(actor(), root, {
        expectedRevision: snapshot.revision,
        name: 'Bad Root',
      }),
    ).rejects.toMatchObject({ response: { code: 'CONFIGURATION_INVALID' } });
    await expect(
      organization.renameUnit(actor(), department.unitId, {
        expectedRevision: snapshot.revision,
        name: 'Changed',
        parentId: root,
      }),
    ).rejects.toMatchObject({ response: { code: 'CONFIGURATION_INVALID' } });
    await expect(
      organization.deleteUnit(actor(), site, { expectedRevision: snapshot.revision }),
    ).rejects.toMatchObject({ response: { reason: 'unit_in_use' } });
    snapshot = await organization.renameUnit(actor(), department.unitId, {
      expectedRevision: snapshot.revision,
      name: 'Engineering',
    });
    expect(snapshot.units.find((unit) => unit.id === department.unitId)?.parentId).toBe(site);
    snapshot = await organization.deleteUnit(actor(), department.unitId, {
      expectedRevision: snapshot.revision,
    });
    snapshot = await organization.deleteUnit(actor(), site, {
      expectedRevision: snapshot.revision,
    });
    const replay = await organization.createUnit(actor(), body, key);
    expect(replay.unitId).toBe(site);
    expect(replay.replayed).toBe(true);
    expect(replay.configuration.units.some((unit) => unit.id === site)).toBe(false);
    expect(replay.configuration.revision).toBe(snapshot.revision);
    await expect(create(snapshot, randomUUID(), 'Forged parent')).rejects.toMatchObject({
      response: { code: 'CONFIGURATION_INVALID' },
    });
  });

  it('preserves activated identity and required values through contending unit edits', async () => {
    const saved = await profile();
    const created = await create(saved, saved.organization.rootId as string, 'Operations');
    const activated = await organization.complete(actor(), {
      expectedRevision: created.configuration.revision,
    });
    const events = await auditCount();
    const results = await Promise.allSettled(
      ['Engineering', 'Finance'].map((name, index) =>
        organization.renameUnit(actor(ids[index]), created.unitId, {
          expectedRevision: activated.revision,
          name,
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason.response).toEqual({
      code: 'CONFIGURATION_CONFLICT',
      reason: 'revision',
      revision: activated.revision + 1,
    });
    const current = await organization.read(actor());
    expect(current.revision).toBe(activated.revision + 1);
    expect(await auditCount()).toBe(events + 1);
    expect(current.organization).toEqual(activated.organization);
    expect(current.setup.completion).toEqual(activated.setup.completion);
    expect(current.setup.state).toBe('completed');
    const winner = results.find((result) => result.status === 'fulfilled');
    expect(current.units).toEqual(winner?.status === 'fulfilled' && winner.value.units);
    expect(current.units.find((unit) => unit.id === created.unitId)).toMatchObject({
      id: created.unitId,
      parentId: saved.organization.rootId,
      type: 'department',
    });
    await expect(
      organization.deleteUnit(actor(ids[1]), created.unitId, {
        expectedRevision: activated.revision,
      }),
    ).rejects.toMatchObject({ response: { code: 'CONFIGURATION_CONFLICT', reason: 'revision' } });
    for (const invalid of [{ name: '' }, { timeZone: '' }])
      await expect(
        organization.save(actor(), { expectedRevision: current.revision, ...invalid }),
      ).rejects.toMatchObject({ response: { code: 'CONFIGURATION_INVALID' } });
    expect(await organization.read(actor())).toEqual(current);
    expect(await auditCount()).toBe(events + 1);
  });

  it('enforces depth and count in domain operations and structural SQL guards', async () => {
    let snapshot = await profile();
    const root = snapshot.organization.rootId as string;
    let parent = root;
    for (let depth = 2; depth <= 8; depth++) {
      const created = await create(snapshot, parent, `Department ${depth}`);
      snapshot = created.configuration;
      parent = created.unitId;
    }
    expect(snapshot.units.find((unit) => unit.id === parent)?.ancestorIds).toHaveLength(7);
    await expect(create(snapshot, parent, 'Too deep')).rejects.toMatchObject({
      response: { code: 'CONFIGURATION_INVALID' },
    });
    await expect(
      owned((client) =>
        client.query(
          "INSERT INTO turnstile.organization_unit (tenant_id,id,type,parent_id,name,name_key) VALUES ($1,$2,'department',$3,'Too deep','too deep')",
          [tenantId, randomUUID(), parent],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await owned((client) =>
      client.query(
        "INSERT INTO turnstile.organization_unit (tenant_id,id,type,parent_id,name,name_key) SELECT $1,gen_random_uuid(),'department',$2,'Unit ' || n,'unit ' || n FROM generate_series(1,492) n",
        [tenantId, root],
      ),
    );
    expect((await organization.read(actor())).units).toHaveLength(500);
    await expect(create(snapshot, root, 'Over limit')).rejects.toMatchObject({
      response: { code: 'CONFIGURATION_INVALID' },
    });
    await expect(
      owned((client) =>
        client.query(
          "INSERT INTO turnstile.organization_unit (tenant_id,id,type,parent_id,name,name_key) VALUES ($1,$2,'department',$3,'Over limit','over limit')",
          [tenantId, randomUUID(), root],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('bounds receipt capacity and deletes only expired retry material during creation', async () => {
    const snapshot = await profile();
    const root = snapshot.organization.rootId as string;
    await owned((client) =>
      client.query(
        "INSERT INTO turnstile.configuration_create_receipt (tenant_id,key,actor_id,fingerprint,unit_id) SELECT $1,gen_random_uuid(),$2,repeat('a',64),$3 FROM generate_series(1,1024)",
        [tenantId, ids[0], root],
      ),
    );
    await expect(create(snapshot, root, 'Capacity')).rejects.toMatchObject({
      response: { code: 'CONFIGURATION_UNAVAILABLE' },
    });
    expect((await organization.read(actor())).revision).toBe(snapshot.revision);
    await owned((client) =>
      client.query(
        "UPDATE turnstile.configuration_create_receipt SET created_at = created_at - interval '25 hours', expires_at = expires_at - interval '25 hours' WHERE tenant_id = $1",
        [tenantId],
      ),
    );
    const expiredKey = await owned(
      async (client) =>
        (
          await client.query(
            'SELECT key FROM turnstile.configuration_create_receipt WHERE tenant_id = $1 ORDER BY expires_at DESC,key DESC LIMIT 1',
            [tenantId],
          )
        ).rows[0].key as string,
    );
    const created = await create(snapshot, root, 'Capacity', 'department', expiredKey);
    expect(created.replayed).toBe(false);
    expect((await organization.read(actor())).units).toHaveLength(2);
  });

  it('rolls back profile/root/unit/activation when audit fails and enforces forced RLS and runtime privilege limits', async () => {
    await initialize();
    await owner.query(
      "ALTER TABLE turnstile.configuration_audit ADD CONSTRAINT fixture_audit_failure CHECK (action = 'initialized') NOT VALID",
    );
    try {
      await expect(
        organization.save(actor(), {
          expectedRevision: 0,
          name: 'Must roll back',
          timeZone: 'UTC',
        }),
      ).rejects.toMatchObject({ response: { code: 'CONFIGURATION_UNAVAILABLE' } });
      expect((await organization.read(actor())).units).toHaveLength(0);
      expect((await organization.read(actor())).revision).toBe(0);
    } finally {
      await owner.query(
        'ALTER TABLE turnstile.configuration_audit DROP CONSTRAINT fixture_audit_failure',
      );
    }
    const saved = await organization.save(actor(), {
      expectedRevision: 0,
      name: 'Example',
      timeZone: 'UTC',
    });
    await owner.query(
      "ALTER TABLE turnstile.configuration_audit ADD CONSTRAINT fixture_audit_failure CHECK (action NOT IN ('unit_created','setup_completed')) NOT VALID",
    );
    try {
      await expect(
        create(saved, saved.organization.rootId as string, 'Rollback unit'),
      ).rejects.toMatchObject({ response: { code: 'CONFIGURATION_UNAVAILABLE' } });
      expect((await organization.read(actor())).revision).toBe(1);
      expect((await organization.read(actor())).setup.completion).toBeNull();
      expect((await organization.read(actor())).units).toHaveLength(1);
    } finally {
      await owner.query(
        'ALTER TABLE turnstile.configuration_audit DROP CONSTRAINT fixture_audit_failure',
      );
    }
    const created = await create(saved, saved.organization.rootId as string, 'Live receipt');
    await owner.query(
      "ALTER TABLE turnstile.configuration_audit ADD CONSTRAINT fixture_audit_failure CHECK (action <> 'setup_completed') NOT VALID",
    );
    try {
      await expect(
        organization.complete(actor(), { expectedRevision: created.configuration.revision }),
      ).rejects.toMatchObject({ response: { code: 'CONFIGURATION_UNAVAILABLE' } });
      expect(await organization.read(actor())).toEqual(created.configuration);
    } finally {
      await owner.query(
        'ALTER TABLE turnstile.configuration_audit DROP CONSTRAINT fixture_audit_failure',
      );
    }
    expect(
      (await runtime.query('SELECT * FROM turnstile.organization_configuration')).rows,
    ).toHaveLength(0);
    await withTenant(runtime, randomUUID(), async (client) =>
      expect((await client.query('SELECT * FROM turnstile.organization_unit')).rows).toHaveLength(
        0,
      ),
    );
    for (const query of [
      'SELECT * FROM turnstile.configuration_audit',
      'DELETE FROM turnstile.configuration_audit',
      'UPDATE turnstile.configuration_create_receipt SET fingerprint = fingerprint',
      'INSERT INTO turnstile.organization_configuration (tenant_id) VALUES (gen_random_uuid())',
      'DELETE FROM turnstile.organization_configuration',
      'UPDATE turnstile.organization_unit SET id = id WHERE false',
      'UPDATE turnstile.organization_unit SET type = type WHERE false',
      'UPDATE turnstile.organization_unit SET tenant_id = tenant_id WHERE false',
      'ALTER TABLE turnstile.organization_unit DISABLE ROW LEVEL SECURITY',
    ])
      await expect(
        withTenant(runtime, tenantId, (client) => client.query(query)),
      ).rejects.toMatchObject({ code: '42501' });
    const window = await owned((client) =>
      client.query(
        'SELECT extract(epoch FROM (expires_at - created_at))::int AS seconds FROM turnstile.configuration_create_receipt WHERE tenant_id = $1',
        [tenantId],
      ),
    );
    expect(
      window.rows.every((row) => row.seconds === CONFIGURATION_LIMITS.createReceiptSeconds),
    ).toBe(true);
    const removed = await withTenant(runtime, tenantId, (client) =>
      client.query('DELETE FROM turnstile.configuration_create_receipt WHERE tenant_id = $1', [
        tenantId,
      ]),
    );
    expect(removed.rowCount).toBe(0);
    await expect(
      owned((client) =>
        client.query(
          'UPDATE turnstile.organization_unit SET parent_id = $3 WHERE tenant_id = $1 AND id = $2',
          [tenantId, created.unitId, created.unitId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      withTenant(runtime, tenantId, (client) =>
        client.query(
          'UPDATE turnstile.organization_configuration SET root_id = $2, revision = revision + 1 WHERE tenant_id = $1',
          [tenantId, created.unitId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rechecks local grants after the context lock and coordinates the private writer with activation', async () => {
    const saved = await readyProfile();
    const client = await owner.connect();
    let completion: Promise<PromiseSettledResult<ConfigurationSnapshotDto>[]> | undefined;
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
      await client.query(
        'SELECT * FROM turnstile.organization_configuration WHERE tenant_id = $1 FOR UPDATE',
        [tenantId],
      );
      const grant = setUserAccess({
        ...operator,
        userId: ids[0],
        enabled: true,
        permissions: ['turnstile:access'],
      });
      // Use a real lock barrier, rather than assuming a delay means the command reached SQL.
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await owner.query(
          "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename = current_user AND pid <> pg_backend_pid() AND state = 'active' AND wait_event_type = 'Lock' AND query LIKE '%organization_configuration%FOR UPDATE%') AS waiting",
        );
        if (result.rows[0].waiting) {
          waiting = true;
          break;
        }
        await delay(10);
      }
      expect(waiting).toBe(true);
      // Queue activation while the earlier revocation is waiting on the same row.
      // Observe both real lock waiters before release, rather than invoking activation
      // only after the grant has already committed.
      completion = Promise.allSettled([
        organization.complete(actor(), { expectedRevision: saved.revision }),
      ]);
      let activationWaiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await owner.query(
          "SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE NOT l.granted AND a.usename = 'thaarei_turnstile_runtime') AS waiting",
        );
        if (result.rows[0].waiting) {
          activationWaiting = true;
          break;
        }
        await delay(10);
      }
      expect(activationWaiting).toBe(true);
      await client.query('COMMIT');
      await grant;
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect(await completion).toMatchObject([
      { status: 'rejected', reason: { response: { code: 'PERMISSION_DENIED' } } },
    ]);
    expect(await auditCount('setup_completed')).toBe(0);
    expect(await organization.status(actor())).toEqual({
      status: 'incomplete',
      canManageConfiguration: false,
    });
  });

  it('reads committed status without queuing behind configuration writers and observes subsequent commits and revocation', async () => {
    await readyProfile();
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
      await client.query(
        'UPDATE turnstile.organization_configuration SET completed_at = statement_timestamp(), completed_by = $2, revision = revision + 1 WHERE tenant_id = $1',
        [tenantId, ids[0]],
      );
      const statuses = await Promise.race([
        Promise.all([organization.status(actor()), organization.status(actor(ids[2]))]),
        delay(1500, 'blocked', { ref: false }),
      ]);
      expect(statuses).toEqual([
        { status: 'incomplete', canManageConfiguration: true },
        { status: 'incomplete', canManageConfiguration: false },
      ]);
      await client.query('COMMIT');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect(await organization.status(actor())).toEqual({
      status: 'complete',
      canManageConfiguration: true,
    });
    await setUserAccess({
      ...operator,
      userId: ids[2],
      enabled: false,
      permissions: ['turnstile:access'],
    });
    await expect(organization.status(actor(ids[2]))).rejects.toMatchObject({
      response: { code: 'PRODUCT_ACCESS_DENIED' },
    });
  });

  it('rejects an actor context changed between its guard and the owning configuration transaction', async () => {
    await initialize();
    const prior = await owned((client) => readAccess(client, tenantId, ids[0]));
    const checkedActor = { ...actor(), accessFingerprint: prior.context.fingerprint };
    await setUserAccess({
      ...operator,
      userId: ids[0],
      enabled: true,
      permissions: ['turnstile:access'],
    });
    await expect(
      organization.save(checkedActor, {
        expectedRevision: 0,
        name: 'Stale authority must not save',
        timeZone: 'UTC',
      }),
    ).rejects.toMatchObject({
      response: { code: 'ACCESS_CONTEXT_CHANGED', accessRevision: expect.any(Number) },
    });
    expect((await organization.read(actor(ids[1]))).revision).toBe(0);
    expect(await auditCount('profile_saved')).toBe(0);
    await expect(
      organization.save(actor(), { expectedRevision: 0, name: 'Still denied', timeZone: 'UTC' }),
    ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
  });

  it('requires initialized private grants, allows the first manager and preserves the last before and after activation', async () => {
    const assignment = { ...operator, userId: ids[0], enabled: true, permissions };
    await expect(setUserAccess(assignment)).rejects.toThrow('Setup initialization required');
    await initialize();
    await owned((client) =>
      client.query('DELETE FROM turnstile.access_legacy_source WHERE tenant_id = $1', [tenantId]),
    );
    expect((await setUserAccess(assignment)).changed).toBe(true);
    expect(
      (await setUserAccess({ ...assignment, permissions: [...permissions].reverse() })).changed,
    ).toBe(false);
    expect(await auditCount('legacy_replaced')).toBe(1);
    for (const change of [
      { enabled: false, permissions },
      { enabled: true, permissions: ['turnstile:access'] },
    ])
      await expect(setUserAccess({ ...assignment, ...change })).rejects.toMatchObject({
        code: 'LAST_CONFIGURATION_MANAGER_REQUIRED',
      });
    await setUserAccess({ ...assignment, userId: ids[1] });
    await setUserAccess({
      ...assignment,
      permissions: ['turnstile:access', 'turnstile:dms:capabilities:read'],
    });
    expect((await organization.read(actor(ids[1]))).revision).toBe(0);
    const saved = await organization.save(actor(ids[1]), {
      expectedRevision: 0,
      name: 'Protected workspace',
      timeZone: 'UTC',
    });
    const ready = await organization.createUnit(
      actor(ids[1]),
      {
        expectedRevision: saved.revision,
        parentId: saved.organization.rootId,
        type: 'department',
        name: 'Operations',
      },
      randomUUID(),
    );
    await organization.complete(actor(ids[1]), { expectedRevision: ready.configuration.revision });
    await expect(
      setUserAccess({ ...assignment, userId: ids[1], enabled: false }),
    ).rejects.toMatchObject({ code: 'LAST_CONFIGURATION_MANAGER_REQUIRED' });
    const audit = await owned((client) =>
      client.query(
        "SELECT actor_id,subject_user_id,revision_before,revision_after FROM turnstile.access_audit WHERE action = 'legacy_replaced' AND tenant_id = $1",
        [tenantId],
      ),
    );
    expect(audit.rows).toHaveLength(3);
    expect(
      audit.rows.every(
        (row) =>
          row.actor_id === operator.operatorId &&
          row.subject_user_id &&
          row.revision_before + 1 === row.revision_after,
      ),
    ).toBe(true);
    await expect(
      setUserAccess(assignment, { ...process.env, INSTALLATION_CUSTOMER_KEY: 'mismatch' }),
    ).rejects.toThrow('Existing fixed installation required');
    await expect(
      setUserAccess(assignment, {
        ...process.env,
        TURNSTILE_MIGRATION_DATABASE_URL: process.env.TURNSTILE_DATABASE_URL,
      }),
    ).rejects.toThrow('Dedicated product migrator required');
  });

  it('serializes concurrent manager removals so exactly one survives', async () => {
    await initialize();
    const results = await Promise.allSettled(
      ids
        .slice(0, 2)
        .map((userId) => setUserAccess({ ...operator, userId, enabled: false, permissions })),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ code: 'LAST_CONFIGURATION_MANAGER_REQUIRED' }),
      }),
    ]);
    expect((await owned((client) => accessCounts(client, tenantId))).managers).toBe(1);
    expect(await auditCount('legacy_replaced')).toBe(1);
    expect((await organization.status(actor(ids[2]))).status).toBe('incomplete');
  });

  it('rolls back the grant when its operator audit fails without changing configuration revision', async () => {
    await initialize();
    await owner.query(
      "ALTER TABLE turnstile.access_audit ADD CONSTRAINT fixture_access_audit_failure CHECK (action <> 'legacy_replaced') NOT VALID",
    );
    try {
      await expect(
        setUserAccess({ ...operator, userId: ids[2], enabled: false, permissions: [] }),
      ).rejects.toMatchObject({ code: '23514' });
      expect((await organization.status(actor(ids[2]))).status).toBe('incomplete');
      expect((await organization.read(actor())).revision).toBe(0);
    } finally {
      await owner.query(
        'ALTER TABLE turnstile.access_audit DROP CONSTRAINT fixture_access_audit_failure',
      );
    }
  });

  it('exposes bounded compiled access command success, invalid input and last-manager exit codes', async () => {
    await initialize();
    async function invoke(input: unknown, raw?: string) {
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL('../dist/modules/auth/set-user-access.js', import.meta.url))],
        { env: process.env, stdio: ['pipe', 'pipe', 'pipe'], timeout: 6000 },
      );
      let output = '';
      let errors = '';
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        errors += chunk.toString();
      });
      child.stdin.end(raw ?? JSON.stringify(input));
      const [code] = await once(child, 'close');
      return { code, output, errors };
    }
    const input = { ...operator, userId: ids[0], enabled: false, permissions };
    expect((await invoke(input)).code).toBe(0);
    const denied = await invoke({ ...input, userId: ids[1] });
    expect(denied.code).toBe(2);
    expect(denied.output).toBe('');
    expect(JSON.parse(denied.errors)).toEqual({ code: 'LAST_CONFIGURATION_MANAGER_REQUIRED' });
    for (const invalid of [
      { ...input, operatorId: undefined },
      { ...input, tenantId },
      { ...input, permissions: ['turnstile:configuration:manage'] },
    ])
      expect((await invoke(invalid)).code).toBe(1);
    expect((await invoke(input, ' '.repeat(4097))).code).toBe(1);
  });

  it('provides private bounded inspection/retention and preserves live receipts/configuration/completion', async () => {
    const saved = await readyProfile();
    const completed = await organization.complete(actor(), { expectedRevision: saved.revision });
    // Inspection reports enabled managers only; ordinary or disabled grants are excluded.
    await owned((client) =>
      client.query(
        "UPDATE turnstile.access_member SET status = 'suspended',version = version + 1 WHERE tenant_id = $1 AND user_id = $2",
        [tenantId, ids[1]],
      ),
    );
    const managed = await configurationOperator('inspect', operator);
    expect('managers' in managed && managed.managers).toEqual({
      total: 1,
      ids: [ids[0]],
      truncated: false,
    });
    await owned(async (client) => {
      await client.query(
        "INSERT INTO turnstile.configuration_audit (tenant_id,id,actor_kind,actor_id,request_id,action,subject_id,changed_fields,revision_after,occurred_at) SELECT $1,gen_random_uuid(),'operator','fixture-operator',gen_random_uuid(),'initialized',$1,'{}',0,statement_timestamp() - interval '91 days' FROM generate_series(1,1001)",
        [tenantId],
      );
      await client.query(
        "INSERT INTO turnstile.configuration_create_receipt (tenant_id,key,actor_id,fingerprint,unit_id,created_at,expires_at) SELECT $1,gen_random_uuid(),$2,repeat('b',64),$3,statement_timestamp() - interval '25 hours',statement_timestamp() - interval '1 hour' FROM generate_series(1,10)",
        [tenantId, ids[0], saved.organization.rootId],
      );
      await client.query(
        "INSERT INTO turnstile.configuration_create_receipt (tenant_id,key,actor_id,fingerprint,unit_id) VALUES ($1,gen_random_uuid(),$2,repeat('c',64),$3)",
        [tenantId, ids[0], saved.organization.rootId],
      );
    });
    const inspect = await configurationOperator('inspect', operator);
    expect('audit' in inspect && inspect.audit.entries).toHaveLength(100);
    expect('audit' in inspect && inspect.audit.truncated).toBe(true);
    expect(JSON.stringify(inspect)).not.toContain('Example Company');
    const first = await configurationOperator('prune', operator);
    expect('auditDeleted' in first && first.auditDeleted).toBe(1000);
    expect('receiptsDeleted' in first && first.receiptsDeleted).toBe(0);
    const second = await configurationOperator('prune', operator);
    expect('auditDeleted' in second && second.auditDeleted).toBe(1);
    expect('receiptsDeleted' in second && second.receiptsDeleted).toBe(10);
    const after = await organization.read(actor());
    expect(after).toEqual(completed);
    const retained = await configurationOperator('inspect', operator);
    // The required first-unit create and the explicit live fixture both survive pruning.
    expect('receipts' in retained && retained.receipts?.live).toBe(2);
  });

  it('executes compiled private commands with bounded stdin, repeat-safe output and no public bootstrap', async () => {
    async function command(input: string) {
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(
            new URL('../dist/modules/organization/configuration-operator.js', import.meta.url),
          ),
          'initialize',
        ],
        { env: process.env, stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 },
      );
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', () => {});
      child.stdin.end(input);
      const [code] = await once(child, 'close');
      return { code, output };
    }
    const first = await command(JSON.stringify(operator));
    expect(first.code).toBe(0);
    expect(JSON.parse(first.output)).toMatchObject({
      alreadyInitialized: false,
      revision: 0,
      tenantId,
    });
    const repeated = await command(JSON.stringify(operator));
    expect(JSON.parse(repeated.output).alreadyInitialized).toBe(true);
    expect((await command(' '.repeat(4097))).code).toBe(1);
    expect(await auditCount('initialized')).toBe(1);
  });

  it('serves guarded canonical HTTP with safe parser/domain errors and minimal ordinary-user status', async () => {
    // Only identity HTTP is stubbed here; real authority/session behavior remains in the BFF/browser suites.
    let userId = ids[0] as string;
    let currentPermissions = permissions;
    vi.spyOn(app.get(BrowserAuthService), 'authenticate').mockImplementation(
      async (request: FastifyRequest) => {
        const current = {
          identity: {
            user: { id: userId, name: 'Fixture', email: 'fixture@example.test' },
            permissions: currentPermissions,
          },
          csrf: 'configuration-fixture-csrf',
          access: policyFixtureAccess(currentPermissions),
        } as unknown as NonNullable<FastifyRequest['productUser']>;
        request.productUser = current;
        return current;
      },
    );
    const headers = {
      origin: config.AUTH_PUBLIC_ORIGIN,
      'x-csrf-token': 'configuration-fixture-csrf',
    };
    expect((await app.inject({ url: '/api/workspace/status' })).statusCode).toBe(503);
    await initialize();
    userId = ids[2] as string;
    currentPermissions = ['turnstile:access'];
    const minimal = await app.inject({ url: '/api/workspace/status' });
    expect(minimal.json()).toEqual({ status: 'incomplete', canManageConfiguration: false });
    expect((await app.inject({ url: '/api/organization' })).statusCode).toBe(403);
    userId = ids[0] as string;
    currentPermissions = permissions;
    const denied = await app.inject({
      method: 'PATCH',
      url: '/api/organization',
      payload: { expectedRevision: 0, name: 'Example' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('CSRF_REJECTED');
    const saved = await app.inject({
      method: 'PATCH',
      url: '/api/organization',
      headers,
      payload: { expectedRevision: 0, name: 'Example', timeZone: 'UTC' },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.headers['cache-control']).toBe('private, no-store');
    const required = await app.inject({
      method: 'POST',
      url: '/api/setup/complete',
      headers,
      payload: { expectedRevision: saved.json().revision },
    });
    expect(required.statusCode).toBe(400);
    expect(required.json()).toEqual({
      code: 'CONFIGURATION_INVALID',
      fieldErrors: [{ field: 'body', reason: 'required' }],
    });
    expect(required.headers['cache-control']).toBe('private, no-store');
    const stale = await app.inject({
      method: 'PATCH',
      url: '/api/organization',
      headers,
      payload: { expectedRevision: 0, name: 'Stale' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('CONFIGURATION_CONFLICT');
    const huge = await app.inject({
      method: 'PATCH',
      url: '/api/organization',
      headers,
      payload: { expectedRevision: 1, name: 'a'.repeat(5000) },
    });
    expect(huge.statusCode).toBe(413);
    expect(huge.json()).toEqual({ code: 'CONFIGURATION_TOO_LARGE' });
    const malformed = await app.inject({
      method: 'PATCH',
      url: '/api/organization',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: '{bad',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().code).toBe('CONFIGURATION_INVALID');
    const media = await app.inject({
      method: 'PATCH',
      url: '/api/organization',
      headers: { ...headers, 'content-type': 'text/plain' },
      payload: '{}',
    });
    expect(media.statusCode).toBe(415);
    expect(media.json().code).toBe('CONFIGURATION_MEDIA_TYPE_UNSUPPORTED');
    const createHeaders = { ...headers, 'idempotency-key': randomUUID() };
    const createBody = {
      expectedRevision: 1,
      type: 'department',
      parentId: saved.json().organization.rootId,
      name: 'Operations',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/organization/units',
      headers: createHeaders,
      payload: createBody,
    });
    expect(first.statusCode).toBe(201);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/organization/units',
          headers: createHeaders,
          payload: createBody,
        })
      ).statusCode,
    ).toBe(200);
    const complete = await app.inject({
      method: 'POST',
      url: '/api/setup/complete',
      headers,
      payload: { expectedRevision: 2 },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().setup.state).toBe('completed');
    expect((await app.inject({ url: '/api/organization?tenantId=forged' })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/organization/unknown' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/organization/units' })).json().units).toHaveLength(2);
    // Revocation after a valid session check is still enforced by the domain transaction.
    await owned((client) =>
      client.query(
        "UPDATE turnstile.access_member SET status = 'suspended',version = version + 1 WHERE tenant_id = $1 AND user_id = $2",
        [tenantId, userId],
      ),
    );
    expect((await app.inject({ url: '/api/setup' })).json().code).toBe('PRODUCT_ACCESS_DENIED');
  });
});
