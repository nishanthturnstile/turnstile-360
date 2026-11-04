// Owning disposable fixture only. No production route/env gate override exists.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createApplication } from '../dist/bootstrap.js';
import { withTenant } from '../dist/infrastructure/database/postgres.js';
import { OrganizationService } from '../dist/modules/organization/organization.service.js';

if (process.env.NODE_ENV !== 'test' || process.env.INSTALLATION_CUSTOMER_KEY !== 'auth-fixture')
  throw new Error('Disposable fixture required');
if (process.argv.includes('--setup')) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const users = JSON.parse(input);
  const app = await createApplication(false);
  await app.init();
  const org = app.get(OrganizationService),
    actor = { userId: users.member.id, requestId: randomUUID() };
  let snapshot = await org.save(actor, {
    expectedRevision: 0,
    name: 'People browser fixture',
    timeZone: 'UTC',
  });
  const units = [];
  for (const name of ['North', 'South']) {
    const site = await org.createUnit(
      actor,
      {
        expectedRevision: snapshot.revision,
        parentId: snapshot.organization.rootId,
        type: 'site',
        name,
      },
      randomUUID(),
    );
    snapshot = site.configuration;
    units.push(site.unitId);
    const child = await org.createUnit(
      actor,
      {
        expectedRevision: snapshot.revision,
        parentId: site.unitId,
        type: 'department',
        name: 'Operations',
      },
      randomUUID(),
    );
    snapshot = child.configuration;
  }
  await org.complete(actor, { expectedRevision: snapshot.revision });
  const pool = new Pool({ connectionString: process.env.TURNSTILE_MIGRATION_DATABASE_URL });
  await withTenant(pool, process.env.INSTALLATION_TENANT_ID, async (db) => {
    const tenant = process.env.INSTALLATION_TENANT_ID;
    for (const label of ['member', 'reset', 'operator', 'suspended']) {
      await db.query(
        "INSERT INTO turnstile.access_member(tenant_id,id,user_id,status) VALUES($1,$2,$3,'active') ON CONFLICT(tenant_id,user_id) DO NOTHING",
        [tenant, randomUUID(), users[label].id],
      );
      const member = (
        await db.query('SELECT id FROM turnstile.access_member WHERE tenant_id=$1 AND user_id=$2', [
          tenant,
          users[label].id,
        ])
      ).rows[0].id;
      // The first administrator keeps its exact legacy permissions until a real
      // normal login is verified by the private bootstrap command.
      if (label === 'member') continue;
      const role = randomUUID();
      await db.query(
        'INSERT INTO turnstile.access_role(tenant_id,id,name,name_key) VALUES($1,$2,$3,$3)',
        [tenant, role, `Fixture ${label}`],
      );
      await db.query(
        'INSERT INTO turnstile.access_role_permission(tenant_id,role_id,permission) SELECT $1,$2,unnest($3::text[])',
        [
          tenant,
          role,
          [
            'turnstile:access',
            ...(label === 'reset'
              ? ['turnstile:people:manage']
              : label === 'operator'
                ? ['turnstile:roles:manage']
                : ['turnstile:units:read', 'turnstile:units:manage']),
          ],
        ],
      );
      const assignment = randomUUID(),
        scoped = label === 'suspended';
      await db.query(
        'INSERT INTO turnstile.access_assignment(tenant_id,id,member_id,role_id,scope_kind,scope_key,include_children) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          tenant,
          assignment,
          member,
          role,
          scoped ? 'units' : 'company',
          scoped ? `units:true:${units[0]}` : 'company',
          scoped,
        ],
      );
      if (scoped)
        await db.query(
          'INSERT INTO turnstile.access_scope_anchor(tenant_id,assignment_id,unit_id) VALUES($1,$2,$3)',
          [tenant, assignment, units[0]],
        );
    }
  });
  await pool.end();
  await app.close();
} else {
  throw new Error('Use the production entrypoint; this fixture only seeds disposable data');
}
