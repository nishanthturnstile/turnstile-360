// Disposable complete-chain fixture. No product/DMS authorization handler is replaced.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { DOCUMENTS_PERMISSIONS } from '../packages/turnstile-contracts/dist/documents.js';
import { testDocumentsUpload } from './test-documents-upload-browser.mjs';

export async function testDocuments({
  page,
  context,
  origin,
  login,
  fixture,
  environment,
  activateFeature,
  temporary,
  productMaintenanceArgs,
  restartProduct,
  clearRateLimits,
  setFault,
  documentReadHeld,
  machineScope,
  uploadCommand,
  documentsVersions,
  documentsBatches,
  documentsLifecycle,
  documentsProcessing,
  verifyReleaseRestore,
}) {
  const stage = (name) => console.log(`Documents browser: ${name}`);
  const visualEvidence = await mkdtemp(join(tmpdir(), 'thaarei-documents-ui-'));
  const pool = new Pool({ connectionString: environment.TURNSTILE_MIGRATION_DATABASE_URL, max: 2 });
  const tenant = environment.INSTALLATION_TENANT_ID;
  async function owned(work) {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
      const result = await work(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }
  async function request(path, { method = 'GET', body, key, csrf } = {}) {
    return page.evaluate(
      async ({ path, method, body, key, csrf }) => {
        const response = await fetch(path, {
          method,
          credentials: 'same-origin',
          headers: {
            'x-turnstile-access-contract': '3',
            ...(body ? { 'content-type': 'application/json', 'x-csrf-token': csrf } : {}),
            ...(key ? { 'idempotency-key': key } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return {
          status: response.status,
          requestId: response.headers.get('x-request-id'),
          body: await response.json(),
        };
      },
      { path, method, body, key, csrf },
    );
  }

  const session = () => request('/api/auth/session');
  const cookie = async () => {
    const value = (await context.cookies()).find((c) => c.name === '__Host-turnstile');
    assert.ok(value);
    return `${value.name}=${value.value}`;
  };
  async function invoke(input, dropAcknowledgement = false) {
    const args = productMaintenanceArgs
      ? [...productMaintenanceArgs.slice(0, -1), 'dist/modules/documents/documents-operator.js']
      : ['apps/turnstile-api/dist/modules/documents/documents-operator.js'];
    const child = spawn(productMaintenanceArgs ? 'docker' : process.execPath, args, {
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '',
      errors = '';
    child.stdout.on('data', (chunk) => {
      if (!dropAcknowledgement) output += chunk;
      if (output.length > 16384) child.kill();
    });
    child.stderr.on('data', (chunk) => {
      errors += chunk;
      if (errors.length > 16384) child.kill();
    });
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => child.kill(), 30000);
      child.once('error', reject);
      child.once('close', (code) => {
        clearTimeout(timer);
        resolve({ code, output, errors });
      });
    });
    child.stdin.end(JSON.stringify(input));
    return result;
  }
  const legacyContexts = [];
  try {
    stage('real administrator handover and retained v2 records');
    await login('member');
    await page.getByRole('heading', { name: 'Welcome, member.', exact: true }).waitFor();
    await activateFeature();
    await page.reload();
    await page.getByRole('heading', { name: 'Welcome, member.', exact: true }).waitFor();
    let administratorCookie = await cookie();
    const administratorCookies = await context.cookies();
    const initial = await session();
    assert.equal(initial.status, 200);
    let current = initial.body;
    assert.equal(typeof current.csrfToken, 'string');
    stage('retained role creation');
    const roleKey = randomUUID();
    const roleResult = await request('/api/people/roles', {
      method: 'POST',
      csrf: current.csrfToken,
      key: roleKey,
      body: {
        command: {
          operation: 'role.create',
          source: 'new',
          name: 'Retained Documents fixture',
          expectedAccessRevision: current.access.accessRevision,
          permissions: ['turnstile:access'],
        },
        confirmation: null,
      },
    });
    assert.equal(roleResult.status, 201);
    const role = roleResult.body.current;
    const assignments = [
      { roleId: role.id, expectedRoleVersion: role.version, scope: { kind: 'company' } },
    ];
    stage('retained import preview');
    const imported = await request('/api/people/imports', {
      method: 'POST',
      csrf: current.csrfToken,
      body: {
        id: randomUUID(),
        filename: 'validation.csv',
        csv: 'email\nimport-validation@example.test\n',
        assignments,
      },
    });
    assert.equal(imported.status, 200);
    current = (await session()).body;
    const catalog = await request('/api/people/catalog');
    stage('retained invitation preview');
    const invitationCommand = {
      operation: 'invitation.issue',
      expectedAccessRevision: current.access.accessRevision,
      expectedOrganizationRevision: catalog.body.organizationRevision,
      email: 'invite-validation@example.test',
      assignments,
    };
    const impact = await request('/api/people/impact', {
      method: 'POST',
      csrf: current.csrfToken,
      body: { command: invitationCommand },
    });
    assert.equal(impact.status, 200);
    const invitationKey = randomUUID();
    const invitation = await request('/api/people/invitations', {
      method: 'POST',
      csrf: current.csrfToken,
      key: invitationKey,
      body: { command: invitationCommand, confirmation: impact.body.confirmation },
    });
    assert.equal(invitation.status, 201);
    const retainedDigests = await owned(
      async (db) =>
        (
          await db.query(
            'SELECT key,digest FROM turnstile.access_command_receipt WHERE tenant_id=$1 AND key=ANY($2::uuid[]) ORDER BY key',
            [tenant, [roleKey, invitationKey]],
          )
        ).rows,
    );
    stage('actual installed old bundle before activation');
    const legacy = JSON.parse(
      await readFile('packages/turnstile-contracts/test/documents-legacy-v2.fixture.json', 'utf8'),
    );
    const root = join(temporary, 'legacy-web');
    await mkdir(root);
    const holder = `documents-legacy-${randomUUID()}`;
    execFileSync('docker', ['create', '--name', holder, legacy.provenance.webImage], {
      stdio: 'ignore',
    });
    try {
      execFileSync('docker', ['cp', `${holder}:/usr/share/nginx/html/.`, root], {
        stdio: 'ignore',
      });
    } finally {
      execFileSync('docker', ['rm', holder], { stdio: 'ignore' });
    }
    for (const asset of legacy.provenance.webAssets) {
      const bytes = await readFile(join(root, asset.path.replace('/usr/share/nginx/html/', '')));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
    }
    async function oldPage(cookies) {
      const old = await context
        .browser()
        .newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 850 } });
      legacyContexts.push(old);
      await old.addCookies(cookies);
      let oldAssets = true;
      const tab = await old.newPage();
      await tab.route(`${origin}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (
          !oldAssets ||
          path.startsWith('/api/') ||
          path.startsWith('/identity/') ||
          path.startsWith('/.well-known/')
        )
          return route.continue();
        const file = path.startsWith('/assets/') ? path.slice(1) : 'index.html';
        const contentType = file.endsWith('.js')
          ? 'application/javascript'
          : file.endsWith('.css')
            ? 'text/css'
            : file.endsWith('.woff2')
              ? 'font/woff2'
              : 'text/html';
        await route.fulfill({ status: 200, contentType, body: await readFile(join(root, file)) });
      });
      await tab.goto(`${origin}/people/members`);
      await tab.getByRole('heading', { name: 'Members', exact: true }).waitFor();
      let legacyCsrf;
      for (const path of [
        '/api/auth/session',
        '/api/people/catalog',
        '/api/people/members',
        '/api/people/eligible-roles',
        '/api/people/invitations',
        `/api/people/commands/${roleKey}`,
      ]) {
        const result = await tab.evaluate(async (path) => {
          const response = await fetch(path);
          return { status: response.status, body: await response.json() };
        }, path);
        if (result.status !== 403 && !(path.includes('/commands/') && result.status === 404)) {
          assert.equal(result.status, 200, path);
          const value = result.body;
          if (path.endsWith('/session')) {
            assert.equal(value.access.catalogVersion, 2);
            legacyCsrf = value.csrfToken;
          }
          if (path.endsWith('/catalog')) assert.equal(value.catalogVersion, 2);
        }
      }
      return {
        tab,
        old,
        csrf: legacyCsrf,
        currentAssets: () => {
          oldAssets = false;
        },
      };
    }
    const oldAdministrator = await oldPage(administratorCookies);
    await login('reset');
    await page.getByRole('heading', { name: 'Welcome, reset.', exact: true }).waitFor();
    const targetCookie = await cookie(),
      targetCookies = await context.cookies();
    const oldTarget = await oldPage(targetCookies);
    stage('private proof/revision/audit rollback before first grant');
    const revision = await owned(
      async (db) =>
        (
          await db.query('SELECT revision FROM turnstile.access_context WHERE tenant_id=$1', [
            tenant,
          ])
        ).rows[0].revision,
    );
    const grant = {
      action: 'grant',
      key: randomUUID(),
      expectedAccessRevision: revision,
      operatorId: 'documents-fixture',
      operatorUserId: fixture.users.member.id,
      operatorCookie: administratorCookie,
      targetUserId: fixture.users.reset.id,
      targetCookie,
      roleId: randomUUID(),
      scope: 'company',
      reason: 'DV-I02 reviewed validator',
      permissions: ['turnstile:access', ...DOCUMENTS_PERMISSIONS],
      activateV3Barrier: true,
    };
    assert.equal((await invoke({ ...grant, targetCookie: administratorCookie })).code, 1);
    assert.equal(
      (
        await invoke({
          ...grant,
          operatorUserId: fixture.users.reset.id,
          operatorCookie: targetCookie,
        })
      ).code,
      1,
    );
    const systemRole = await owned(
      async (db) =>
        (
          await db.query(
            "SELECT id FROM turnstile.access_role WHERE tenant_id=$1 AND system_key='workspace_administrator'",
            [tenant],
          )
        ).rows[0].id,
    );
    assert.equal((await invoke({ ...grant, roleId: systemRole })).code, 1);
    assert.equal((await invoke({ ...grant, expectedAccessRevision: revision + 1 })).code, 1);
    assert.equal((await invoke({ ...grant, scope: 'units' })).code, 1);
    await owned((db) =>
      db.query(
        `CREATE FUNCTION turnstile.documents_fixture_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$; CREATE TRIGGER documents_fixture_audit_failure BEFORE INSERT ON turnstile.access_audit FOR EACH ROW EXECUTE FUNCTION turnstile.documents_fixture_audit_failure()`,
      ),
    );
    try {
      assert.equal((await invoke(grant)).code, 1);
      assert.equal(
        await owned(
          async (db) =>
            (
              await db.query(
                'SELECT documents_contract_required FROM turnstile.access_context WHERE tenant_id=$1',
                [tenant],
              )
            ).rows[0].documents_contract_required,
        ),
        false,
      );
    } finally {
      await owned((db) =>
        db.query(
          'DROP TRIGGER documents_fixture_audit_failure ON turnstile.access_audit;DROP FUNCTION turnstile.documents_fixture_audit_failure()',
        ),
      );
    }
    const lost = await invoke(grant, true);
    assert.equal(lost.code, 0);
    assert.equal(lost.output, '');
    const replay = await invoke(grant);
    assert.equal(replay.code, 0);
    assert.equal(JSON.parse(replay.output).replayed, true);
    stage('old assigned/unassigned clients recover via supported 401 into current assets');
    for (const legacyPage of [oldAdministrator, oldTarget]) {
      const denied = await legacyPage.tab.evaluate(async () => {
        const response = await fetch('/api/auth/session');
        return { status: response.status, body: await response.json() };
      });
      assert.equal(denied.status, 401);
      assert.equal(denied.body.code, 'LOGIN_REQUIRED');
      const roleWrite = await legacyPage.tab.evaluate(
        async ({ id, csrf, key, revision, organizationRevision }) => {
          const response = await fetch(`/api/people/roles/${id}`, {
            method: 'PATCH',
            headers: {
              'content-type': 'application/json',
              'x-csrf-token': csrf,
              'idempotency-key': key,
            },
            body: JSON.stringify({
              command: {
                operation: 'role.patch',
                change: 'permissions',
                id,
                expectedVersion: 1,
                expectedAccessRevision: revision,
                expectedOrganizationRevision: organizationRevision,
                permissions: ['turnstile:access'],
              },
              confirmation: null,
            }),
          });
          return response.status;
        },
        {
          id: role.id,
          csrf: legacyPage.csrf,
          key: randomUUID(),
          revision,
          organizationRevision: catalog.body.organizationRevision,
        },
      );
      assert.equal(roleWrite, 401);
      await legacyPage.tab.reload();
      await legacyPage.tab
        .getByRole('heading', { name: 'Your session has ended', exact: true })
        .waitFor();
      legacyPage.currentAssets();
      const recovered = legacyPage.tab.waitForRequest(
        (r) =>
          new URL(r.url()).pathname === '/api/auth/session' &&
          r.headers()['x-turnstile-access-contract'] === '3',
      );
      await legacyPage.tab.getByRole('button', { name: 'Sign in', exact: true }).click();
      await legacyPage.tab.waitForURL((url) => url.pathname === '/people/members');
      await recovered;
      const read = await legacyPage.tab.evaluate(async () => {
        const r = await fetch('/api/auth/session', {
          headers: { 'x-turnstile-access-contract': '3' },
        });
        return { status: r.status, value: await r.json() };
      });
      assert.equal(read.status, 200);
      assert.equal(read.value.access.catalogVersion, 3);
    }
    assert.deepEqual(
      await owned(
        async (db) =>
          (
            await db.query(
              'SELECT key,digest FROM turnstile.access_command_receipt WHERE tenant_id=$1 AND key=ANY($2::uuid[]) ORDER BY key',
              [tenant, [roleKey, invitationKey]],
            )
          ).rows,
      ),
      retainedDigests,
    );
    administratorCookie = (await oldAdministrator.old.cookies())
      .filter((c) => c.name === '__Host-turnstile')
      .map((c) => `${c.name}=${c.value}`)
      .join('');
    grant.operatorCookie = administratorCookie;
    await context.addCookies(await oldTarget.old.cookies());
    stage('ordinary validator login, real DMS reads and retained nested payloads');
    await page.reload();
    await page.getByRole('link', { name: 'Documents', exact: true }).waitFor();
    for (const path of [
      `/api/people/imports/${imported.body.job.id}`,
      `/api/people/invitations/${invitation.body.current.id}`,
      `/api/people/commands/${invitationKey}`,
    ])
      assert.equal(
        await oldAdministrator.tab.evaluate(
          async (path) =>
            (await fetch(path, { headers: { 'x-turnstile-access-contract': '3' } })).status,
          path,
        ),
        200,
        path,
      );
    await page.getByRole('link', { name: 'Documents', exact: true }).click();
    await page.getByRole('link', { name: 'Validation reference', exact: true }).waitFor();
    await page.screenshot({ path: join(visualEvidence, 'directory-desktop.png'), fullPage: true });
    await page.getByRole('link', { name: 'Validation reference', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Validation reference', exact: true }).waitFor();
    await page.screenshot({ path: join(visualEvidence, 'overview-desktop.png'), fullPage: true });
    assert.equal((await page.getByText('read-only fixture', { exact: false }).count()) > 0, true);
    stage('protected checklist and real result diagnostics');
    assert.equal(
      await oldAdministrator.tab.evaluate(
        async () =>
          (
            await fetch('/api/documents/validation', {
              headers: { 'x-turnstile-access-contract': '3' },
            })
          ).status,
      ),
      403,
    );
    await page.getByRole('link', { name: 'Validation', exact: true }).click();
    await page.getByRole('heading', { name: 'Validation checklist', exact: true }).waitFor();
    const coverage = page.getByRole('table', { name: 'Documents operation coverage' });
    assert.equal(await coverage.getByRole('row').count(), 35);
    assert.equal((await request('/api/documents/validation')).body.items.length, 34);
    await page.getByLabel('Operation details', { exact: true }).selectOption('DV-E08');
    await page.getByText('Response verified', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Check service identity', exact: true }).click();
    await page.getByText('Service identity confirmed.', { exact: false }).waitFor();
    assert.match(await page.locator('dd.font-mono').textContent(), /^[0-9a-f-]{36}$/);
    await page.getByRole('button', { name: 'Check admission policy', exact: true }).click();
    await page.getByText('Admission policy read.', { exact: false }).waitFor();
    const observed = await request('/api/documents/connection/identity');
    assert.match(observed.requestId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(observed.body, { name: 'Thaarei DMS API' });
    await page.reload();
    await page.getByText('No observation this visit', { exact: true }).waitFor();
    setFault('dms');
    try {
      await page.getByRole('button', { name: 'Check service identity', exact: true }).click();
      await page.getByText('DOCUMENTS_UNAVAILABLE', { exact: true }).waitFor();
      assert.match(await page.locator('dd.font-mono').textContent(), /^[0-9a-f-]{36}$/);
    } finally {
      setFault('none');
    }
    await page.getByRole('link', { name: 'Connection and policy', exact: true }).click();
    await page.getByRole('heading', { name: 'Connection and policy', exact: true }).waitFor();
    assert.equal((await request('/api/documents/connection')).status, 200);
    await page.getByRole('heading', { name: 'Format capabilities', exact: true }).waitFor();
    await page.getByText('Admission limits', { exact: true }).click();
    await page.getByText('Queued work limit', { exact: true }).waitFor();
    assert.equal((await request('/api/documents/connection/identity')).status, 200);
    assert.equal((await request('/api/documents?tenantId=foreign')).status, 400);
    assert.equal((await request(`/api/documents/${randomUUID()}`)).status, 404);
    stage('compound ordinary permissions and separate no-READ contribution eligibility');
    const checklist = async () => {
      const response = await request('/api/documents/validation');
      assert.equal(response.status, 200);
      return new Map(response.body.items.map((row) => [row.evidenceId, row.allowedByProductRole]));
    };
    const compound = ['DV-E04', 'DV-E07', 'DV-E12', 'DV-E13', 'DV-E14', 'DV-E17'];
    const ordinary = await checklist();
    for (const id of compound) assert.equal(ordinary.get(id), true, id);
    const roleParams = [tenant, grant.roleId, 'turnstile:documents:read'];
    const removed = await owned((db) =>
      db.query(
        'DELETE FROM turnstile.access_role_permission WHERE tenant_id=$1 AND role_id=$2 AND permission=$3',
        roleParams,
      ),
    );
    assert.equal(removed.rowCount, 1);
    try {
      const limited = await checklist();
      for (const id of compound) assert.equal(limited.get(id), false, id);
      assert.equal(limited.get('DV-E19'), true, 'new-file upload remains available');
      const connection = await request('/api/documents/connection');
      assert.equal(connection.status, 200);
      const operations = connection.body.effectiveOperations;
      for (const operation of [
        'processing:reprocess',
        'documents:edit-metadata',
        'documents:references',
        'versions:write',
        'versions:restore',
      ])
        assert.equal(operations.includes(operation), false, operation);
      assert.ok(operations.includes('uploads:control'));
      const { csrfToken } = (await session()).body;
      const command = {
        kind: 'document.edit',
        documentId: randomUUID(),
        expectedRevision: '1',
        payload: { title: 'Partial-role fixture draft' },
      };
      const draft = (mode) =>
        request('/api/documents/operations', {
          method: 'POST',
          csrf: csrfToken,
          body: { mode, command },
        });
      assert.equal((await draft('ordinary')).status, 403);
      assert.equal((await draft('contribute')).status, 201);
      await page.goto(`${origin}/documents/validation`);
      await page.getByLabel('Operation details', { exact: true }).selectOption('DV-E04');
      await page.getByText('Additional access required', { exact: true }).waitFor();
    } finally {
      await owned((db) =>
        db.query(
          'INSERT INTO turnstile.access_role_permission (tenant_id,role_id,permission) VALUES ($1,$2,$3)',
          roleParams,
        ),
      );
    }
    await clearRateLimits();
    await page.goto(`${origin}/documents/connection`);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await page.screenshot({
        path: join(visualEvidence, `connection-${width}.png`),
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
      );
    }
    await page.setViewportSize({ width: 1280, height: 850 });
    if (uploadCommand)
      await testDocumentsUpload({
        page,
        origin,
        request,
        session,
        owned,
        setFault,
        restartProduct,
        uploadCommand,
        clearRateLimits,
        environment,
        documentsVersions,
        documentsBatches,
        documentsLifecycle,
        documentsProcessing,
        async operatorProof() {
          const validatorCookies = await context.cookies();
          await login('member');
          await page.getByRole('heading', { name: 'Welcome, member.', exact: true }).waitFor();
          administratorCookie = await cookie();
          grant.operatorCookie = administratorCookie;
          await context.clearCookies();
          await context.addCookies(validatorCookies);
          return { operatorUserId: grant.operatorUserId, operatorCookie: administratorCookie };
        },
      });
    stage('real read denial/outage keeps the user session and checks current policy');
    await machineScope(false);
    try {
      assert.equal((await request('/api/documents')).status, 403);
      assert.equal((await session()).status, 200);
    } finally {
      await machineScope(true);
    }
    setFault('dms');
    try {
      assert.equal((await request('/api/documents')).status, 503);
      assert.equal((await session()).status, 200);
    } finally {
      setFault('none');
    }
    assert.equal((await request('/api/documents')).status, 200);
    const etag = await page.evaluate(
      async (id) => (await fetch(`/api/documents/${id}`)).headers.get('etag'),
      fixture.documentsFixtureId,
    );
    assert.equal(etag, '"1"');
    if (verifyReleaseRestore) {
      stage('exact-image database archive, independent marker and v3 rollback fence');
      const documentId = fixture.documentsFixtureId;
      const { csrfToken } = (await session()).body;
      const post = (path, body) => request(path, { method: 'POST', csrf: csrfToken, body });
      const savedEdit = await post('/api/documents/operations', {
        mode: 'ordinary',
        command: {
          kind: 'document.edit',
          documentId,
          expectedRevision: '1',
          payload: { metadata: { purpose: 'restored Documents fixture' } },
        },
      });
      assert.equal(savedEdit.status, 201);
      const resolved = savedEdit.body.receipt;
      const completed = await post(`/api/documents/operations/${resolved.id}/execute`, {
        digest: resolved.digest,
      });
      assert.equal(completed.status, 200);
      assert.equal(completed.body.receipt.state, 'RESOLVED');
      const currentDocument = await request(`/api/documents/${documentId}`);
      assert.deepEqual(currentDocument.body.metadata, { purpose: 'restored Documents fixture' });
      const pending = await post('/api/documents/operations', {
        mode: 'ordinary',
        command: {
          kind: 'document.edit',
          documentId,
          expectedRevision: currentDocument.body.revision,
          payload: { title: 'Never dispatch from the older recovery marker' },
        },
      });
      assert.equal(pending.status, 201);
      await verifyReleaseRestore({
        legacyImage: legacy.provenance.apiImage,
        cookie: await cookie(),
        csrf: csrfToken,
        documentId,
        resolved,
        pending: pending.body.receipt,
      });
    }
    stage('revision conflict, revoke and receipt replay cannot restore rights');
    const targetNow = await cookie();
    let latest = await owned(
      async (db) =>
        (
          await db.query('SELECT revision FROM turnstile.access_context WHERE tenant_id=$1', [
            tenant,
          ])
        ).rows[0].revision,
    );
    const revoke = {
      action: 'revoke',
      key: randomUUID(),
      expectedAccessRevision: latest,
      operatorId: grant.operatorId,
      operatorUserId: grant.operatorUserId,
      operatorCookie: administratorCookie,
      targetUserId: grant.targetUserId,
      roleId: grant.roleId,
      scope: 'company',
      reason: 'DV-I02 reviewed revocation',
    };
    assert.equal(
      (
        await invoke({
          ...grant,
          key: randomUUID(),
          targetCookie: targetNow,
          expectedAccessRevision: revision,
        })
      ).code,
      1,
    );
    setFault('documents-held-response');
    const delayed = request(`/api/documents/${fixture.documentsFixtureId}`);
    try {
      for (let n = 0; n < 100 && !documentReadHeld(); n++)
        await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(documentReadHeld(), true, 'The real DMS response must enter the transport hold');
      assert.equal((await invoke(revoke)).code, 0);
      setFault('none');
      assert.equal(
        (await delayed).status,
        403,
        'A late authorized DMS result must not outlive revoked product READ',
      );
    } finally {
      setFault('none');
    }

    assert.equal(
      JSON.parse((await invoke({ ...grant, targetCookie: targetNow })).output).replayed,
      true,
    );
    assert.equal((await request('/api/documents')).status, 403);
    stage('concurrent reviewed commands and deliberate handover');
    await clearRateLimits();
    const resetCookie = await cookie();
    latest = await owned(
      async (db) =>
        (
          await db.query('SELECT revision FROM turnstile.access_context WHERE tenant_id=$1', [
            tenant,
          ])
        ).rows[0].revision,
    );
    const contenderA = {
      ...grant,
      key: randomUUID(),
      expectedAccessRevision: latest,
      targetCookie: resetCookie,
    };
    const contenderB = { ...contenderA, key: randomUUID() };
    const contenders = await Promise.all([invoke(contenderA), invoke(contenderB)]);
    assert.deepEqual(contenders.map((result) => result.code).sort(), [0, 1]);
    assert.equal(
      await owned(
        async (db) =>
          (
            await db.query(
              'SELECT count(*)::int AS n FROM turnstile.access_command_receipt WHERE tenant_id=$1 AND key=ANY($2::uuid[])',
              [tenant, [contenderA.key, contenderB.key]],
            )
          ).rows[0].n,
      ),
      1,
    );
    await login('operator');
    await page.getByRole('heading', { name: 'Welcome, operator.', exact: true }).waitFor();
    const operatorTargetCookie = await cookie();
    latest = await owned(
      async (db) =>
        (
          await db.query('SELECT revision FROM turnstile.access_context WHERE tenant_id=$1', [
            tenant,
          ])
        ).rows[0].revision,
    );
    assert.equal(
      (
        await invoke({
          ...grant,
          key: randomUUID(),
          expectedAccessRevision: latest,
          targetUserId: fixture.users.operator.id,
          targetCookie: operatorTargetCookie,
        })
      ).code,
      1,
      'A grant cannot silently edit a role assigned to another member',
    );
    const handover = {
      ...grant,
      action: 'handover',
      key: randomUUID(),
      expectedAccessRevision: latest,
      fromUserId: fixture.users.reset.id,
      targetUserId: fixture.users.operator.id,
      targetCookie: operatorTargetCookie,
      reason: 'DV-I02 deliberate handover',
    };
    assert.equal((await invoke(handover)).code, 0);
    assert.equal((await request('/api/documents')).status, 200);
    const handedCookie = await cookie();
    const subjects = await owned(
      async (db) =>
        (
          await db.query(
            'SELECT subject_user_id,reviewed_reason FROM turnstile.access_audit WHERE tenant_id=$1 AND request_id=$2 ORDER BY subject_user_id',
            [tenant, handover.key],
          )
        ).rows,
    );
    assert.deepEqual(
      subjects.map((row) => row.subject_user_id).sort(),
      [fixture.users.reset.id, fixture.users.operator.id].sort(),
    );
    assert.ok(subjects.every((row) => row.reviewed_reason === handover.reason));
    latest = await owned(
      async (db) =>
        (
          await db.query('SELECT revision FROM turnstile.access_context WHERE tenant_id=$1', [
            tenant,
          ])
        ).rows[0].revision,
    );
    assert.equal(
      (
        await invoke({
          ...revoke,
          key: randomUUID(),
          expectedAccessRevision: latest,
          targetUserId: fixture.users.operator.id,
        })
      ).code,
      0,
    );
    assert.equal(
      JSON.parse((await invoke({ ...handover, targetCookie: handedCookie })).output).replayed,
      true,
    );
    assert.equal((await request('/api/documents')).status, 403);
    await restartProduct();
    assert.equal(await page.evaluate(async () => (await fetch('/api/auth/session')).status), 401);
    assert.equal(
      (await owned(
        async (db) =>
          (
            await db.query(
              'SELECT count(*)::int AS n FROM turnstile.access_audit WHERE tenant_id=$1 AND actor_id=$2 AND reviewed_reason IS NOT NULL',
              [tenant, grant.operatorUserId],
            )
          ).rows[0].n,
      )) >= 2,
      true,
    );
    await clearRateLimits();
    stage('current recipient client negotiates v3 after activation');
    let invitationLink;
    for (let n = 0; n < 100 && !invitationLink; n++) {
      const list = await (
        await fetch(`${environment.AUTH_BROWSER_MAILPIT_URL}/api/v1/messages`)
      ).json();
      for (const item of list.messages.filter((row) =>
        row.To.some((target) => target.Address === 'invite-validation@example.test'),
      )) {
        const detail = await (
          await fetch(`${environment.AUTH_BROWSER_MAILPIT_URL}/api/v1/message/${item.ID}`)
        ).json();
        invitationLink = detail.Text.match(/https?:\/\/[^\s]+/g)?.find((link) =>
          link.includes('/invitations/join#'),
        );
        if (invitationLink) break;
      }
      if (!invitationLink) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(invitationLink, 'Expected synthetic invitation delivery');
    await context.clearCookies();
    const exchange = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/invitations/exchange',
    );
    await page.goto(invitationLink);
    await page.getByRole('button', { name: 'Review invitation', exact: true }).click();
    const exchanged = await exchange;
    assert.equal(exchanged.status(), 200);
    assert.equal(exchanged.request().headers()['x-turnstile-access-contract'], '3');
    assert.equal((await exchanged.json()).review.assignments[0].role.id, role.id);
    console.log(`Documents synthetic UI screenshots: ${visualEvidence}`);
    stage(
      documentsProcessing
        ? 'processing, verified content, OCR and search qualification passed'
        : documentsLifecycle
          ? 'lifecycle, application sharing, Contribute and audit qualification passed'
          : documentsBatches
            ? 'batch, version and upload qualification passed'
            : uploadCommand
              ? 'read and upload qualification passed'
              : 'read-only compatibility qualification passed',
    );
  } finally {
    for (const old of legacyContexts) await old.close();
    await pool.end();
  }
}
