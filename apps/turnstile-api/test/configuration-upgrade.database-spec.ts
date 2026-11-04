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
import { accessOperator } from '../src/modules/access/access-operator.js';
import { StructureAccessService } from '../src/modules/access/structure-access.service.js';
import { configurationOperator } from '../src/modules/organization/configuration-operator.js';
import { OrganizationService } from '../src/modules/organization/organization.service.js';
import {
  type ConfigurationRecord,
  OrganizationRepository,
} from '../src/modules/organization/persistence/organization.repository.js';
import { OwningStructureInvitations } from '../src/modules/people/invitation-structure-policy.js';
import { closeFixturePool } from './access-fixture.js';

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
    organization = new OrganizationService(
      new OrganizationRepository(
        persistence,
        new StructureAccessService(new OwningStructureInvitations()),
      ),
    );
  }

  // Historical rows are seeded through the deployed v1 SQL contract. Current
  // application readiness intentionally rejects this incomplete migration set.
  async function historicalSnapshot() {
    return withTenant(owner, environment.INSTALLATION_TENANT_ID as string, async (client) => {
      const record = (await client.query('SELECT * FROM turnstile.organization_configuration'))
        .rows[0] as ConfigurationRecord;
      return new OrganizationRepository(
        persistence,
        new StructureAccessService(new OwningStructureInvitations()),
      ).snapshot({
        client,
        tenantId: record.tenant_id,
        record,
        actor,
        canManage: true,
      });
    });
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
    await closeFixturePool(persistence.pool, () => persistence.onApplicationShutdown());
    await closeFixturePool(owner);
    await administrator.query(`DROP DATABASE "${database}"`);
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
    await withTenant(owner, environment.INSTALLATION_TENANT_ID as string, async (client) => {
      await client.query(
        'INSERT INTO turnstile.user_access (tenant_id,user_id,enabled,permissions) VALUES ($1,$2,true,$3)',
        [
          environment.INSTALLATION_TENANT_ID,
          actor.userId,
          ['turnstile:access', 'turnstile:configuration:manage'],
        ],
      );
      await client.query(
        `INSERT INTO turnstile.configuration_audit
        (tenant_id,id,actor_kind,actor_id,request_id,action,subject_id,subject_user_id,changed_fields,revision_before,revision_after)
        VALUES ($1,$2,'operator',$3,$4,'access_changed',$1,$5,ARRAY['enabled','permissions'],0,0)`,
        [
          environment.INSTALLATION_TENANT_ID,
          randomUUID(),
          operator.operatorId,
          randomUUID(),
          actor.userId,
        ],
      );
    });
  });
  afterAll(async () => {
    await closeFixturePool(persistence?.pool, () => persistence.onApplicationShutdown());
    await closeFixturePool(owner);
    vi.unstubAllEnvs();
    if (created) await administrator.query(`DROP DATABASE "${database}"`);
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
    let unitId: string | undefined;
    const tenantId = environment.INSTALLATION_TENANT_ID as string;
    await withTenant(owner, tenantId, async (client) => {
      const rootId = randomUUID();
      let revision = 0;
      const audit = (action: string, subject: string, fields: string[]) =>
        client.query(
          `INSERT INTO turnstile.configuration_audit
        (tenant_id,id,actor_kind,actor_id,request_id,action,subject_id,changed_fields,revision_before,revision_after)
        VALUES ($1,$2,'user',$3,$4,$5,$6,$7,$8,$8 + 1)`,
          [tenantId, randomUUID(), actor.userId, randomUUID(), action, subject, fields, revision++],
        );
      if (fixture.scenario !== 'empty') {
        await client.query(
          "INSERT INTO turnstile.organization_unit (tenant_id,id,type) VALUES ($1,$2,'organization')",
          [tenantId, rootId],
        );
        await client.query(
          "UPDATE turnstile.organization_configuration SET name = 'Preserved organization',root_id = $2,time_zone = $3,revision = revision + 1 WHERE tenant_id = $1",
          [tenantId, rootId, fixture.timeZone],
        );
        await audit('profile_saved', rootId, ['name', ...(fixture.timeZone ? ['timeZone'] : [])]);
      }
      if (fixture.unit) {
        unitId = randomUUID();
        await client.query(
          "INSERT INTO turnstile.organization_unit (tenant_id,id,type,parent_id,name,name_key) VALUES ($1,$2,'department',$3,'Preserved operations','preserved operations')",
          [tenantId, unitId, rootId],
        );
        await client.query(
          'UPDATE turnstile.organization_configuration SET revision = revision + 1 WHERE tenant_id = $1',
          [tenantId],
        );
        await audit('unit_created', unitId, ['name', 'type', 'parentId']);
        await client.query(
          'INSERT INTO turnstile.configuration_create_receipt (tenant_id,key,actor_id,fingerprint,unit_id) VALUES ($1,$2,$3,$4,$5)',
          [tenantId, randomUUID(), actor.userId, '0'.repeat(64), unitId],
        );
      }
      if (fixture.completed) {
        await client.query(
          'UPDATE turnstile.organization_configuration SET completed_at = statement_timestamp(),completed_by = $2,revision = revision + 1 WHERE tenant_id = $1',
          [tenantId, actor.userId],
        );
        await audit('setup_completed', rootId, ['completion']);
      }
    });
    const before = await historicalSnapshot();
    expect(await persistence.ready()).toBe(false);
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
    expect(await historicalSnapshot()).toEqual(before);
    expect(await durableRows()).toEqual(preserved);
    await migrateDatabase('turnstile', environment);
    await accessOperator('initialize', operator, environment);
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
