// Actual selected images, canonical HTTPS ingress, normal user login and owning private administration.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

import { BUSINESS_MODULES } from '../packages/turnstile-contracts/dist/index.js';

const definitions = BUSINESS_MODULES.map((module) => ({
  ...module,
  message: `You are in ${module.title}`,
}));
const inputCode = `let input='';for await(const c of process.stdin) input+=c; const value=JSON.parse(input);`;
export async function testModuleAccess({
  page,
  context,
  origin,
  fixture,
  moduleFixture,
  command,
  login,
  invoke,
  disable,
}) {
  const installed = definitions.filter((m) =>
    moduleFixture.request.profile.modules.some((p) => p.id === m.id),
  );
  let phase = 'initial login and handover';
  const request = async (path, status = 200) => {
    const response = await page.evaluate(async (path) => {
      const result = await fetch(path);
      return {
        status: result.status,
        body: await result.json(),
        cache: result.headers.get('cache-control'),
        referrer: result.headers.get('referrer-policy'),
      };
    }, path);
    assert.equal(response.status, status, `${phase}: ${path}: ${JSON.stringify(response.body)}`);
    if (path.startsWith('/api/modules')) {
      assert.equal(response.cache, 'private, no-store');
      assert.equal(response.referrer, 'no-referrer');
    }
    return response.body;
  };
  const session = () => request('/api/auth/session');
  const normalProof = async () => {
    const current = await session(),
      cookie = (await context.cookies()).find((c) => c.name === '__Host-turnstile');
    assert.ok(cookie, 'Normal signed login required');
    return {
      operatorId: fixture.users.member.id,
      administratorUserId: fixture.users.member.id,
      administratorCookie: `${cookie.name}=${cookie.value}`,
      key: randomUUID(),
      expectedRevision: current.access.accessRevision,
    };
  };
  const release = (operation, value) =>
    invoke(
      `import {releaseOperator} from './dist/modules/access/release-operator.js';${inputCode}console.log(JSON.stringify(await releaseOperator('${operation}',value)));`,
      value,
    );
  const grantCode = `import {operatorSession} from './dist/modules/access/operator-session.js';import {moduleAccessOperator} from './dist/modules/module-access/module-access-operator.js';${inputCode}const {cookie,...command}=value; if(command.action==='grant')command.identityAccessToken=await operatorSession(command.userId,cookie,process.env);console.log(JSON.stringify(await moduleAccessOperator(command)));`;
  const grants = new Map(),
    roles = new Map(definitions.map((m) => [m.id, randomUUID()]));
  const changePermission = async (id, action, replay) => {
    const proof = await normalProof();
    const command = replay ?? {
      operatorId: proof.operatorId,
      key: randomUUID(),
      expectedRevision: proof.expectedRevision,
      userId: fixture.users.member.id,
      moduleId: id,
      roleId: roles.get(id),
      action,
      reason: 'MOD-I07 disposable ordinary-login qualification',
    };
    const result = await invoke(grantCode, { ...command, cookie: proof.administratorCookie });
    await session();
    if (action === 'grant' && !replay) grants.set(id, command);
    return result;
  };
  await login('member');
  await page.getByRole('heading', { name: 'Welcome, member.', exact: true }).waitFor();
  assert.deepEqual((await request('/api/modules')).modules, []);
  await request('/api/modules?unexpected=1', 400);
  // Existing setup/release handover is authoritative and cannot be skipped by signing a module grant.
  await release('bootstrap-administrator', await normalProof());
  await release('open', {
    ...(await normalProof()),
    releaseId: moduleFixture.releaseId,
    incompatibleProcessesStopped: true,
  });
  const admin = await session();
  assert.equal(
    admin.permissions.some((p) => /turnstile:(incidents|risks):read/.test(p)),
    false,
  );
  assert.deepEqual(
    (await request('/api/modules')).modules,
    [],
    'System administrator is not an implicit module reader',
  );
  for (const m of definitions)
    await request(`/api/modules/${m.id}/entry`, installed.includes(m) ? 403 : 404);
  for (const m of installed) {
    await page.goto(`${origin}/modules/${m.id}`);
    await page.getByRole('heading', { name: 'Module access unavailable', exact: true }).waitFor();
  }
  // Service-level entry admission must deny before executing a module implementation, without a controller.
  await invoke(
    `import 'reflect-metadata';import {ProductPersistenceService} from './dist/infrastructure/database/product-persistence.service.js';import {ModuleAccessService} from './dist/modules/module-access/module-access.service.js';${inputCode}const persistence=new ProductPersistenceService();let executed=false;try {await new ModuleAccessService(persistence).entry(value,'incident-management',()=>{executed=true;return {id:'incident-management',message:'unexpected'}});throw new Error('Internal bypass');}catch(e){if(e.getStatus?.()!==403||executed)throw e;}finally{await persistence.onApplicationShutdown();}console.log('{}');`,
    { userId: fixture.users.member.id, requestId: randomUUID() },
  );
  for (const m of definitions) await changePermission(m.id, 'grant');
  phase = 'granted module access';
  // Real deferred database guards reject unit-scoped module readers; system SQL templates stay unchanged.
  await invoke(
    `import {withProductOperator} from './dist/infrastructure/database/product-operator.js';${inputCode}await withProductOperator(process.env,async(db,installed)=>{const t=installed.tenant_id;const bad=(await db.query("SELECT 1 FROM turnstile.access_role r JOIN turnstile.access_role_permission p ON p.tenant_id=r.tenant_id AND p.role_id=r.id WHERE r.tenant_id=$1 AND r.system_key IS NOT NULL AND p.permission=ANY($2::text[])",[t,value.permissions])).rows;if(bad.length)throw new Error('Implicit system grant');const a=(await db.query('SELECT member_id FROM turnstile.access_assignment WHERE tenant_id=$1 AND role_id=$2',[t,value.roleId])).rows[0];const unit=(await db.query("SELECT id FROM turnstile.organization_unit WHERE tenant_id=$1 AND type='site' LIMIT 1",[t])).rows[0].id;await db.query('SAVEPOINT scope_guard');let denied=false;try{await db.query("INSERT INTO turnstile.access_assignment(tenant_id,id,member_id,role_id,scope_kind,include_children,scope_key) VALUES($1,$2,$3,$4,'units',false,$5)",[t,value.assignmentId,a.member_id,value.roleId,'units:false:'+unit]);await db.query('INSERT INTO turnstile.access_scope_anchor(tenant_id,assignment_id,unit_id) VALUES($1,$2,$3)',[t,value.assignmentId,unit]);await db.query('SET CONSTRAINTS ALL IMMEDIATE');}catch(e){if(e.code!=='23514'||e.message!=='Company action requires company scope')throw e;denied=true;}await db.query('ROLLBACK TO SAVEPOINT scope_guard');if(!denied)throw new Error('Module scope guard failed');});console.log('{}');`,
    {
      roleId: roles.get(installed.at(-1)?.id ?? definitions[0].id),
      assignmentId: randomUUID(),
      permissions: definitions.map((m) => m.permission),
    },
  );
  const caps = await request('/api/modules');
  assert.deepEqual(
    caps.modules.map((m) => m.id),
    installed.map((m) => m.id),
  );
  assert.equal(caps.context.releaseId, moduleFixture.releaseId);
  await request('/api/dms/capabilities');
  for (const m of definitions) {
    await page.goto(`${origin}/modules/${m.id}`);
    if (installed.includes(m)) {
      await page.getByRole('heading', { name: m.title, exact: true }).waitFor();
      await page.getByText(m.message, { exact: true }).waitFor();
      assert.ok(
        await page
          .getByRole('navigation')
          .getByRole('link', { name: m.title, exact: true })
          .count(),
      );
      assert.equal((await request(`/api/modules/${m.id}/entry`)).message, m.message);
    } else {
      await page.getByRole('heading', { name: 'Page not found', exact: true }).waitFor();
      await request(`/api/modules/${m.id}/entry`, 404);
    }
  }
  const retired = Object.keys(
    JSON.parse(readFileSync('packages/turnstile-contracts/module-permissions.json', 'utf8')),
  ).filter((id) => !definitions.some((module) => module.id === id));
  for (const id of retired) {
    await request(`/api/modules/${id}/entry`, 404);
    await page.goto(`${origin}/modules/${id}`);
    await page.getByRole('heading', { name: 'Page not found', exact: true }).waitFor();
  }
  if (installed.length) {
    phase = 'permission revocation and replay';
    const target = installed.at(-1);
    await changePermission(target.id, 'revoke');
    assert.equal(
      (await changePermission(target.id, 'grant', grants.get(target.id))).replayed,
      true,
      'Lost grant acknowledgement replay cannot undo an intervening revocation',
    );
    await request(`/api/modules/${target.id}/entry`, 403);
    await page.goto(`${origin}/modules/${target.id}`);
    await page.getByRole('heading', { name: 'Module access unavailable', exact: true }).waitFor();
    assert.equal(
      (await request('/api/modules')).modules.some((m) => m.id === target.id),
      false,
    );
    await changePermission(target.id, 'grant');
    phase = 'local disablement';
    await disable([target.id]);
    await page.goto(`${origin}/modules/${target.id}`);
    await page.getByRole('heading', { name: 'Module access unavailable', exact: true }).waitFor();
    await request(`/api/modules/${target.id}/entry`, 403);
    assert.deepEqual(
      (await request('/api/modules')).modules.map((m) => m.id),
      installed.filter((m) => m.id !== target.id).map((m) => m.id),
      'Local disablement must preserve independently enabled modules',
    );
    await disable([]);
    await session();
    assert.equal((await request(`/api/modules/${target.id}/entry`)).message, target.message);
    await moduleFixture.change('turnstile', 'approved', ['foundation']);
    phase = 'signed removal';
    assert.deepEqual((await request('/api/modules')).modules, []);
    await request(`/api/modules/${target.id}/entry`, 403);
    await moduleFixture.change('turnstile', 'approved');
    phase = 'reapproval';
    await request(`/api/modules/${target.id}/entry`);
    await moduleFixture.change('turnstile', 'approved', undefined, 1);
    phase = 'signed expiry';
    await delay(1500);
    assert.deepEqual(
      (await request('/api/modules')).modules,
      [],
      'Expired module authority cannot use product retained reads',
    );
    await request(`/api/modules/${target.id}/entry`, 403);
    await moduleFixture.change('turnstile', 'suspended');
    phase = 'signed suspension';
    assert.deepEqual(
      (await request('/api/modules')).modules,
      [],
      'Suspension denies module business reads',
    );
    await request(`/api/modules/${target.id}/entry`, 403);
    await moduleFixture.change('turnstile', 'approved');
  }
  // DMS enrollment and product approval remain separate from Turnstile module authority.
  phase = 'independent DMS policy';
  await moduleFixture.change('dms', 'suspended');
  assert.equal((await request('/api/dms/capabilities')).deploymentAccess, 'existing-reads');
  assert.deepEqual(
    (await request('/api/modules')).modules.map((m) => m.id),
    installed.map((m) => m.id),
  );
  await moduleFixture.change('dms', 'approved');
  assert.equal((await request('/api/dms/capabilities')).deploymentAccess, 'full');
  await command('deny-machine-scope');
  await request('/api/dms/capabilities', 403);
  assert.deepEqual(
    (await request('/api/modules')).modules.map((m) => m.id),
    installed.map((m) => m.id),
  );
  await command('restore-machine-scope');
  await request('/api/dms/capabilities');
  await context.clearCookies();
  await request('/api/modules', 401);
  for (const m of installed) await request(`/api/modules/${m.id}/entry`, 401);
  console.log(
    `Selected image module qualification passed: ${installed.map((m) => m.id).join(', ') || 'core only'}; normal login, private handover, explicit permissions, service guard, direct URLs/API, SQL scope and independent DMS approval/scopes${installed.length ? ', local disablement, revocation/replay and signed removal/expiry/suspension' : ', excluded routes remain unregistered'}.`,
  );
}
