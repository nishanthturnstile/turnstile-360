import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool, type PoolClient } from 'pg';
import { bootstrapInstallation, migrateDatabase } from '../src/infrastructure/database/migrate.js';
import { withTenant } from '../src/infrastructure/database/postgres.js';
import { readAccess } from '../src/modules/access/access-evaluator.js';
import { accessOperator } from '../src/modules/access/access-operator.js';
import { canonicalAccessReady } from '../src/modules/access/access-safety.js';
import { closeFixturePool } from './access-fixture.js';
import { historicalInstallation } from './deployment-fixture.js';

describe('user-management archive upgrade and retired-reader fence', () => {
  const database = `um_upgrade_${randomUUID().replaceAll('-', '')}`;
  const administrator = new Pool({ connectionString: process.env.PROVISION_DATABASE_URL, max: 1 });
  const environment = { ...process.env };
  const tenant = environment.INSTALLATION_TENANT_ID as string;
  const operator = { operatorId: 'um-upgrade-fixture' };
  const grants = [
    { userId: 'access-only', enabled: true, permissions: ['turnstile:access'] },
    {
      userId: 'configuration-only',
      enabled: true,
      permissions: ['turnstile:configuration:manage'],
    },
    { userId: 'capability-only', enabled: true, permissions: ['turnstile:dms:capabilities:read'] },
    {
      userId: 'combined',
      enabled: true,
      permissions: [
        'turnstile:access',
        'turnstile:configuration:manage',
        'turnstile:dms:capabilities:read',
      ],
    },
    {
      userId: 'disabled',
      enabled: false,
      permissions: ['turnstile:access', 'turnstile:configuration:manage'],
    },
  ];
  let owner: Pool;
  let runtime: Pool;
  let legacyFolder: string;
  let created = false;
  const owned = <T>(work: (db: PoolClient) => Promise<T>) => withTenant(owner, tenant, work);
  async function createDatabase() {
    await administrator.query(`CREATE DATABASE "${database}"`);
    created = true;
    await administrator.query(`REVOKE ALL ON DATABASE "${database}" FROM PUBLIC`);
    await administrator.query(
      `GRANT CONNECT,CREATE ON DATABASE "${database}" TO thaarei_turnstile_migrator`,
    );
    await administrator.query(
      `GRANT CONNECT ON DATABASE "${database}" TO thaarei_turnstile_runtime`,
    );
  }
  function connect() {
    owner = new Pool({ connectionString: environment.TURNSTILE_MIGRATION_DATABASE_URL, max: 1 });
    runtime = new Pool({ connectionString: environment.TURNSTILE_DATABASE_URL, max: 1 });
  }
  async function originalRows() {
    return owned(async (db) => ({
      installation: (await db.query('SELECT * FROM turnstile.installation')).rows,
      configuration: (await db.query('SELECT * FROM turnstile.organization_configuration')).rows,
      units: (await db.query('SELECT * FROM turnstile.organization_unit ORDER BY id')).rows,
      inventory: (await db.query('SELECT * FROM turnstile.user_access ORDER BY user_id')).rows,
      audit: (await db.query('SELECT * FROM turnstile.configuration_audit ORDER BY id')).rows,
      receipts: (
        await db.query('SELECT * FROM turnstile.configuration_create_receipt ORDER BY key')
      ).rows,
    }));
  }
  beforeAll(async () => {
    expect(environment.AUTH_PROFILE).toBe('test');
    expect(['/auth_fixture', '/onboarding_upgrade']).toContain(
      new URL(environment.PROVISION_DATABASE_URL as string).pathname,
    );
    await createDatabase();
    for (const key of ['TURNSTILE_DATABASE_URL', 'TURNSTILE_MIGRATION_DATABASE_URL'] as const) {
      const url = new URL(environment[key] as string);
      url.pathname = `/${database}`;
      environment[key] = url.toString();
    }
    connect();
    legacyFolder = await mkdtemp(join(tmpdir(), 'um-legacy-migrations-'));
    const source = fileURLToPath(new URL('../database/migrations/', import.meta.url));
    const journal = JSON.parse(await readFile(join(source, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 10);
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
    await historicalInstallation(owner, environment);
    await owned(async (db) => {
      for (const grant of grants)
        await db.query(
          'INSERT INTO turnstile.user_access(tenant_id,user_id,enabled,permissions) VALUES($1,$2,$3,$4)',
          [tenant, grant.userId, grant.enabled, grant.permissions],
        );
    });
  });
  afterAll(async () => {
    await closeFixturePool(runtime);
    await closeFixturePool(owner);
    if (created) await administrator.query(`DROP DATABASE "${database}"`);
    await administrator.end();
    if (legacyFolder) await rm(legacyFolder, { recursive: true, force: true });
  });
  it.each([
    { name: 'fresh v2', version: 2, profile: false, complete: false, child: false, zone: null },
    { name: 'partial v1', version: 1, profile: true, complete: false, child: false, zone: null },
    {
      name: 'partial v2 Kolkata',
      version: 2,
      profile: true,
      complete: false,
      child: true,
      zone: 'Asia/Kolkata',
    },
    {
      name: 'completed v1 root-only',
      version: 1,
      profile: true,
      complete: true,
      child: false,
      zone: 'UTC',
    },
    {
      name: 'completed v1 Calcutta',
      version: 1,
      profile: true,
      complete: true,
      child: true,
      zone: 'Asia/Calcutta',
    },
    {
      name: 'completed v2',
      version: 2,
      profile: true,
      complete: true,
      child: true,
      zone: 'Asia/Kolkata',
    },
  ])(
    'preserves $name and exact legacy sources through dump, restore and cutover',
    async (fixture) => {
      await owned(async (db) => {
        await db.query(
          'INSERT INTO turnstile.organization_configuration(tenant_id,requirement_version) VALUES($1,$2)',
          [tenant, fixture.version],
        );
        if (fixture.profile) {
          const root = randomUUID();
          await db.query(
            "INSERT INTO turnstile.organization_unit(tenant_id,id,type) VALUES($1,$2,'organization')",
            [tenant, root],
          );
          await db.query(
            "UPDATE turnstile.organization_configuration SET name='Preserved organization',root_id=$2,time_zone=$3,revision=revision+1 WHERE tenant_id=$1",
            [tenant, root, fixture.zone],
          );
          if (fixture.child) {
            const unit = randomUUID();
            await db.query(
              "INSERT INTO turnstile.organization_unit(tenant_id,id,type,parent_id,name,name_key) VALUES($1,$2,'department',$3,'Existing operations','existing operations')",
              [tenant, unit, root],
            );
            await db.query(
              'UPDATE turnstile.organization_configuration SET revision=revision+1 WHERE tenant_id=$1',
              [tenant],
            );
            await db.query(
              'INSERT INTO turnstile.configuration_create_receipt(tenant_id,key,actor_id,fingerprint,unit_id) VALUES($1,$2,$3,$4,$5)',
              [tenant, randomUUID(), 'combined', '0'.repeat(64), unit],
            );
          }
          if (fixture.complete)
            await db.query(
              "UPDATE turnstile.organization_configuration SET completed_at=statement_timestamp(),completed_by='combined',revision=revision+1 WHERE tenant_id=$1",
              [tenant],
            );
        }
      });
      const before = await originalRows();
      const container = environment.ONBOARDING_ARCHIVE_CONTAINER as string;
      expect(container).toMatch(/^thaarei-(auth-test|upgrade-rehearsal)-[a-f0-9]{12}$/);
      const port = spawnSync(
        'docker',
        [
          'inspect',
          '--format',
          '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
          container,
        ],
        { encoding: 'utf8', timeout: 15000 },
      );
      expect(port.status).toBe(0);
      expect(port.stdout.trim()).toBe(new URL(environment.PROVISION_DATABASE_URL as string).port);
      const dump = spawnSync(
        'docker',
        ['exec', container, 'pg_dump', '-U', 'postgres', '-d', database, '--format=custom'],
        { timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
      );
      expect(dump.status).toBe(0);
      await closeFixturePool(runtime);
      await closeFixturePool(owner);
      await administrator.query(`DROP DATABASE "${database}"`);
      await createDatabase();
      const restored = spawnSync(
        'docker',
        [
          'exec',
          '-i',
          container,
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
      connect();
      expect(await originalRows()).toEqual(before);
      // Hold an already-connected flat reader across the actual owning migration.
      const old = await runtime.connect();
      try {
        await old.query("SELECT set_config('app.tenant_id',$1,false)", [tenant]);
        expect(
          (
            await old.query({
              name: 'legacy-read',
              text: 'SELECT enabled,permissions FROM turnstile.user_access',
            })
          ).rowCount,
        ).toBe(5);
        await migrateDatabase('turnstile', environment);
        await migrateDatabase('turnstile', environment);
        await bootstrapInstallation(environment);
        await expect(
          old.query({
            name: 'legacy-read',
            text: 'SELECT enabled,permissions FROM turnstile.user_access',
          }),
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        old.release();
      }
      expect(await originalRows()).toEqual(before);
      expect(await accessOperator('initialize', operator, environment)).toMatchObject({
        changed: true,
        publicWritesEnabled: false,
      });
      const first = await accessOperator('inspect', operator, environment);
      expect(await accessOperator('initialize', operator, environment)).toMatchObject({
        changed: false,
        publicWritesEnabled: false,
      });
      expect(await accessOperator('inspect', operator, environment)).toEqual(first);
      await owned(async (db) => {
        expect(
          (await db.query('SELECT count(*)::int AS n FROM turnstile.access_assignment')).rows[0].n,
        ).toBe(0);
        for (const grant of grants) {
          const access = await readAccess(db, tenant, grant.userId);
          expect(access.status).toBe(grant.enabled ? 'active' : 'suspended');
          expect(access.protectedAdministrator).toBe(false);
          expect(access.context.grants).toHaveLength(1);
          expect([...(access.context.grants[0]?.permissions ?? [])].sort()).toEqual(
            [...grant.permissions].sort(),
          );
        }
      });
      expect(
        await withTenant(runtime, tenant, (db) => canonicalAccessReady(db, tenant, environment)),
      ).toBe(true);
      await expect(
        owned((db) =>
          db.query("UPDATE turnstile.user_access SET enabled=false WHERE user_id='combined'"),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      expect(await originalRows()).toEqual(before);
    },
    45000,
  );
});
