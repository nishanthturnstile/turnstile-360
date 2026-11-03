import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { bootstrapInstallation, migrateDatabase } from '../src/infrastructure/database/migrate.js';
import { withTenant } from '../src/infrastructure/database/postgres.js';
import { ProductPersistenceService } from '../src/infrastructure/database/product-persistence.service.js';
import { setUserAccess } from '../src/modules/auth/set-user-access.js';
import { configurationOperator } from '../src/modules/organization/configuration-operator.js';
import { OrganizationService } from '../src/modules/organization/organization.service.js';
import { OrganizationRepository } from '../src/modules/organization/persistence/organization.repository.js';

describe('owning v1 to v2 configuration migration', () => {
  // An isolated database in the harness's disposable cluster; never reset its shared fixture.
  const database = `onb_upgrade_${randomUUID().replaceAll('-', '')}`;
  const administrator = new Pool({ connectionString: process.env.PROVISION_DATABASE_URL, max: 1 });
  const environment = { ...process.env };
  const operator = { operatorId: 'upgrade-fixture' };
  const actor = { userId: 'upgrade-manager', requestId: randomUUID() };
  let owner: Pool;
  let persistence: ProductPersistenceService;
  let organization: OrganizationService;
  let legacyFolder: string;
  let created = false;

  async function createFixtureDatabase() {
    await administrator.query(`CREATE DATABASE "${database}"`);
    created = true;
    await administrator.query(`REVOKE ALL ON DATABASE "${database}" FROM PUBLIC`);
    await administrator.query(
      `GRANT CONNECT, CREATE ON DATABASE "${database}" TO thaarei_turnstile_migrator`,
    );
    await administrator.query(
      `GRANT CONNECT ON DATABASE "${database}" TO thaarei_turnstile_runtime`,
    );
  }

  function connectFixture() {
    owner = new Pool({ connectionString: environment.TURNSTILE_MIGRATION_DATABASE_URL, max: 1 });
    persistence = new ProductPersistenceService();
    organization = new OrganizationService(new OrganizationRepository(persistence));
  }

  async function restoreV1Archive() {
    // Archive only this synthetic database, inside the explicitly identified disposable cluster.
    const container = environment.ONBOARDING_ARCHIVE_CONTAINER;
    expect(container).toMatch(/^thaarei-(auth-test|upgrade-rehearsal)-[a-f0-9]{12}$/);
    const port = spawnSync(
      'docker',
      [
        'inspect',
        '--format',
        '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
        container as string,
      ],
      { encoding: 'utf8', timeout: 15000 },
    );
    expect(port.status).toBe(0);
    expect(port.stdout.trim()).toBe(new URL(environment.PROVISION_DATABASE_URL as string).port);
    const dump = spawnSync(
      'docker',
      ['exec', container as string, 'pg_dump', '-U', 'postgres', '-d', database, '--format=custom'],
      { timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
    );
    expect(dump.status).toBe(0);
    await persistence.onApplicationShutdown();
    await owner.end();
    await administrator.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await createFixtureDatabase();
    const restored = spawnSync(
      'docker',
      [
        'exec',
        '-i',
        container as string,
        'pg_restore',
        '--exit-on-error',
        '-U',
        'postgres',
        '-d',
        database,
      ],
      { input: dump.stdout, timeout: 30000 },
    );
    expect(restored.status).toBe(0);
    connectFixture();
  }

  beforeAll(async () => {
    expect(environment.AUTH_PROFILE).toBe('test');
    expect(['/auth_fixture', '/onboarding_upgrade']).toContain(
      new URL(environment.PROVISION_DATABASE_URL as string).pathname,
    );
    await createFixtureDatabase();
    for (const key of ['TURNSTILE_DATABASE_URL', 'TURNSTILE_MIGRATION_DATABASE_URL'] as const) {
      const url = new URL(environment[key] as string);
      url.pathname = `/${database}`;
      environment[key] = url.toString();
    }
    const adminUrl = new URL(environment.PROVISION_DATABASE_URL as string);
    adminUrl.pathname = `/${database}`;
    const isolatedAdmin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
    try {
      await isolatedAdmin.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    } finally {
      await isolatedAdmin.end();
    }
    vi.stubEnv('TURNSTILE_DATABASE_URL', environment.TURNSTILE_DATABASE_URL);
    connectFixture();

    // Use the real, unmodified applied migrations to prepare the deployed v1 baseline.
    legacyFolder = await mkdtemp(join(tmpdir(), 'turnstile-v1-migrations-'));
    const source = fileURLToPath(new URL('../database/migrations/', import.meta.url));
    const journal = JSON.parse(await readFile(join(source, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 6);
    await mkdir(join(legacyFolder, 'meta'));
    await writeFile(join(legacyFolder, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries)
      await copyFile(join(source, `${entry.tag}.sql`), join(legacyFolder, `${entry.tag}.sql`));
  });
  beforeEach(async () => {
    await owner.query('DROP SCHEMA IF EXISTS turnstile CASCADE');
    await owner.query('DROP SCHEMA IF EXISTS turnstile_migrations CASCADE');
    await migrate(drizzle(owner), {
      migrationsFolder: legacyFolder,
      migrationsSchema: 'turnstile_migrations',
    });
    await bootstrapInstallation(environment);
    expect(await configurationOperator('initialize', operator, environment)).toMatchObject({
      requirementVersion: 1,
    });
    await setUserAccess(
      {
        ...operator,
        userId: actor.userId,
        enabled: true,
        permissions: ['turnstile:access', 'turnstile:configuration:manage'],
      },
      environment,
    );
  });
  afterAll(async () => {
    await persistence?.onApplicationShutdown();
    await owner?.end();
    vi.unstubAllEnvs();
    if (created) await administrator.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await administrator.end();
    if (legacyFolder) await rm(legacyFolder, { recursive: true, force: true });
  });

  it.each([
    { scenario: 'empty', timeZone: null, unit: false, completed: false, nextStep: 'organization' },
    {
      scenario: 'partial profile',
      timeZone: null,
      unit: true,
      completed: false,
      nextStep: 'organization',
    },
    {
      scenario: 'saved Calcutta profile',
      timeZone: 'Asia/Calcutta',
      unit: false,
      completed: false,
      nextStep: 'structure',
    },
    {
      scenario: 'saved Kolkata structure',
      timeZone: 'Asia/Kolkata',
      unit: true,
      completed: false,
      nextStep: 'review',
    },
    {
      scenario: 'completed root-only UTC',
      timeZone: 'UTC',
      unit: false,
      completed: true,
      nextStep: null,
    },
    {
      scenario: 'completed Calcutta structure',
      timeZone: 'Asia/Calcutta',
      unit: true,
      completed: true,
      nextStep: null,
    },
  ])('preserves $scenario through owning migration and repeat initialization', async (fixture) => {
    let before = await organization.read(actor);
    if (fixture.scenario !== 'empty')
      before = await organization.save(actor, {
        expectedRevision: before.revision,
        name: 'Preserved organization',
        ...(fixture.timeZone ? { timeZone: fixture.timeZone } : {}),
      });
    let unitId: string | undefined;
    if (fixture.unit) {
      const created = await organization.createUnit(
        actor,
        {
          expectedRevision: before.revision,
          parentId: before.organization.rootId,
          type: 'department',
          name: 'Preserved operations',
        },
        randomUUID(),
      );
      before = created.configuration;
      unitId = created.unitId;
    }
    if (fixture.completed)
      before = await organization.complete(actor, { expectedRevision: before.revision });
    const tenantId = environment.INSTALLATION_TENANT_ID as string;
    const durableRows = () =>
      withTenant(owner, tenantId, async (client) => {
        const result = [];
        for (const table of [
          'configuration_audit',
          'configuration_create_receipt',
          'user_access',
          'installation',
        ])
          result.push((await client.query(`SELECT * FROM turnstile.${table} ORDER BY 1,2`)).rows);
        return result;
      });
    const preserved = await durableRows();
    await restoreV1Archive();
    expect(await organization.read(actor)).toEqual(before);
    expect(await durableRows()).toEqual(preserved);
    await migrateDatabase('turnstile', environment);
    const after = await organization.read(actor);
    expect(after.organization).toEqual(before.organization);
    expect(after.units).toEqual(before.units);
    expect(after.revision).toBe(before.revision);
    expect(after.setup.state).toBe(before.setup.state);
    expect(after.setup.completion).toEqual(before.setup.completion);
    expect(after.setup.requirementVersion).toBe(fixture.completed ? 1 : 2);
    expect(after.setup.nextStep).toBe(fixture.nextStep);
    expect(await durableRows()).toEqual(preserved);
    await migrateDatabase('turnstile', environment);
    expect(await configurationOperator('initialize', operator, environment)).toMatchObject({
      alreadyInitialized: true,
      revision: before.revision,
      requirementVersion: fixture.completed ? 1 : 2,
    });
    expect(await organization.read(actor)).toEqual(after);
    expect(await durableRows()).toEqual(preserved);
    if (fixture.completed) {
      expect(await organization.complete(actor, { expectedRevision: 0 })).toEqual(after);
      await expect(
        withTenant(owner, tenantId, (client) =>
          client.query(
            'UPDATE turnstile.organization_configuration SET requirement_version = 2 WHERE tenant_id = $1',
            [tenantId],
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      if (unitId) {
        const removed = await organization.deleteUnit(actor, unitId, {
          expectedRevision: after.revision,
        });
        expect(removed.units).toHaveLength(1);
        expect(removed.setup.completion).toEqual(after.setup.completion);
      }
    }
  });
});
