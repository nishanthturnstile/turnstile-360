import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configurationNameKey, SYSTEM_ROLE_TEMPLATES } from '@thaarei/turnstile-contracts';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { migrateDatabase } from '../src/infrastructure/database/migrate.js';
import { withTenant } from '../src/infrastructure/database/postgres.js';
import { canonicalAccessReady } from '../src/modules/access/access-safety.js';
import { closeFixturePool } from './access-fixture.js';
import { historicalInstallation } from './deployment-fixture.js';

describe('DV-I02 retained v2 migration and rollback fences', () => {
  it('upgrades actual release-1 rows without rewriting grants/receipts, preserves private guards and refuses unactivated Documents rights', async () => {
    expect(process.env.AUTH_PROFILE).toBe('test');
    const administrator = new Pool({
      connectionString: process.env.PROVISION_DATABASE_URL,
      max: 1,
    });
    const name = `documents_upgrade_${randomUUID().replaceAll('-', '')}`;
    const env = { ...process.env };
    const tenant = env.INSTALLATION_TENANT_ID as string;
    const folder = await mkdtemp(join(tmpdir(), 'documents-v2-migrations-'));
    let created = false;
    let owner: Pool | undefined, runtime: Pool | undefined;
    try {
      await administrator.query(`CREATE DATABASE "${name}"`);
      created = true;
      await administrator.query(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
      await administrator.query(
        `GRANT CONNECT,CREATE ON DATABASE "${name}" TO thaarei_turnstile_migrator`,
      );
      await administrator.query(`GRANT CONNECT ON DATABASE "${name}" TO thaarei_turnstile_runtime`);
      for (const key of ['TURNSTILE_DATABASE_URL', 'TURNSTILE_MIGRATION_DATABASE_URL'] as const) {
        const url = new URL(env[key] as string);
        url.pathname = `/${name}`;
        env[key] = url.toString();
      }
      owner = new Pool({ connectionString: env.TURNSTILE_MIGRATION_DATABASE_URL, max: 1 });
      runtime = new Pool({ connectionString: env.TURNSTILE_DATABASE_URL, max: 1 });
      const source = fileURLToPath(new URL('../database/migrations/', import.meta.url));
      const journal = JSON.parse(await readFile(join(source, 'meta/_journal.json'), 'utf8'));
      journal.entries = journal.entries.filter((row: { idx: number }) => row.idx <= 38);
      await mkdir(join(folder, 'meta'));
      await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
      for (const row of journal.entries)
        await copyFile(join(source, `${row.tag}.sql`), join(folder, `${row.tag}.sql`));
      await migrate(drizzle(owner), {
        migrationsFolder: folder,
        migrationsSchema: 'turnstile_migrations',
      });
      await historicalInstallation(owner, env);
      const privatePool = owner;
      const owned = <T>(work: Parameters<typeof withTenant<T>>[2]) =>
        withTenant(privatePool, tenant, work);
      const receipt = randomUUID();
      await owned(async (db) => {
        await db.query('INSERT INTO turnstile.organization_configuration(tenant_id) VALUES($1)', [
          tenant,
        ]);
        await db.query(
          "INSERT INTO turnstile.access_context(tenant_id,initialized_by) VALUES($1,'documents-upgrade')",
          [tenant],
        );
        for (const template of SYSTEM_ROLE_TEMPLATES) {
          const id = randomUUID();
          await db.query(
            'INSERT INTO turnstile.access_role(tenant_id,id,system_key,name,name_key) VALUES($1,$2,$3,$4,$5)',
            [tenant, id, template.systemKey, template.name, configurationNameKey(template.name)],
          );
          await db.query(
            'INSERT INTO turnstile.access_role_permission(tenant_id,role_id,permission) SELECT $1,$2,unnest($3::text[])',
            [tenant, id, template.permissions],
          );
        }
        await db.query(
          "INSERT INTO turnstile.access_command_receipt(tenant_id,actor_id,key,operation,digest) VALUES($1,'documents-upgrade',$2,'role.create',$3)",
          [tenant, receipt, 'c'.repeat(64)],
        );
      });
      const before = await owned(async (db) => ({
        roles: (await db.query('SELECT * FROM turnstile.access_role ORDER BY id')).rows,
        permissions: (
          await db.query(
            'SELECT * FROM turnstile.access_role_permission ORDER BY role_id,permission',
          )
        ).rows,
        configuration: (await db.query('SELECT * FROM turnstile.organization_configuration')).rows,
        receipts: (await db.query('SELECT * FROM turnstile.access_command_receipt')).rows,
        context: (await db.query('SELECT revision,release_version FROM turnstile.access_context'))
          .rows[0],
      }));
      expect(before.context.release_version).toBe(1);
      await migrateDatabase('turnstile', env);
      await migrateDatabase('turnstile', env);
      const after = await owned(async (db) => ({
        roles: (await db.query('SELECT * FROM turnstile.access_role ORDER BY id')).rows,
        permissions: (
          await db.query(
            'SELECT * FROM turnstile.access_role_permission ORDER BY role_id,permission',
          )
        ).rows,
        configuration: (await db.query('SELECT * FROM turnstile.organization_configuration')).rows,
        receipts: (await db.query('SELECT * FROM turnstile.access_command_receipt')).rows,
        context: (
          await db.query(
            'SELECT revision,release_version,documents_contract_required FROM turnstile.access_context',
          )
        ).rows[0],
      }));
      expect(after.roles).toEqual(before.roles);
      expect(after.permissions).toEqual(before.permissions);
      expect(after.configuration).toEqual(before.configuration);
      expect(after.receipts).toEqual(before.receipts);
      expect(after.context).toEqual({
        release_version: 2,
        revision: before.context.revision + 1,
        documents_contract_required: false,
      });
      expect(await owned((db) => canonicalAccessReady(db, tenant, env))).toBe(true);
      await expect(
        owned(async (db) => {
          const id = randomUUID();
          await db.query(
            "INSERT INTO turnstile.access_role(tenant_id,id,name,name_key) VALUES($1,$2,'Denied Documents role','denied documents role')",
            [tenant, id],
          );
          await db.query(
            "INSERT INTO turnstile.access_role_permission(tenant_id,role_id,permission) VALUES($1,$2,'turnstile:access'),($1,$2,'turnstile:documents:read')",
            [tenant, id],
          );
        }),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        withTenant(runtime, tenant, (db) =>
          db.query(
            'UPDATE turnstile.access_context SET documents_contract_required=true,revision=revision+1 WHERE tenant_id=$1',
            [tenant],
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await owned((db) =>
        db.query(
          'UPDATE turnstile.access_context SET documents_contract_required=true,revision=revision+1 WHERE tenant_id=$1',
          [tenant],
        ),
      );
      await expect(
        owned((db) =>
          db.query(
            'UPDATE turnstile.access_context SET documents_contract_required=false,revision=revision+1 WHERE tenant_id=$1',
            [tenant],
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await owned((db) =>
        db.query(
          'ALTER TABLE turnstile.access_role_permission DISABLE TRIGGER documents_permission_barrier',
        ),
      );
      expect(await owned((db) => canonicalAccessReady(db, tenant, env))).toBe(false);
      await owned((db) =>
        db.query(
          'ALTER TABLE turnstile.access_role_permission ENABLE TRIGGER documents_permission_barrier',
        ),
      );
      expect(await owned((db) => canonicalAccessReady(db, tenant, env))).toBe(true);
    } finally {
      await closeFixturePool(runtime);
      await closeFixturePool(owner);
      if (created) await administrator.query(`DROP DATABASE "${name}"`);
      await administrator.end();
      await rm(folder, { recursive: true, force: true });
    }
  }, 30000);
});
