import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { testDeployment } from './test-deployment-browser.mjs';
export async function testPeople({
  page,
  context,
  origin,
  login,
  mailUrl,
  mailLink,
  setFault,
  fixture,
  clearRateLimits,
  activateFeature,
  restartProduct,
  verifyDeploymentClockQueue,
}) {
  const stage = (name) => console.log(`People browser stage: ${name}`);
  const capturePanel = async (name) => {
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: Optional artifacts from this uncached standalone runner.
    if (process.env.MEMBERS_DESIGN_CAPTURE === '1')
      await page.screenshot({ path: `/tmp/turnstile-panel-${name}.png` });
  };

  const heading = async (name) => {
    try {
      await page.getByRole('heading', { name, exact: true }).waitFor();
    } catch (error) {
      console.log('Missing expected People heading:', name);
      throw error;
    }
  };
  const tabReady = async (name) => {
    await heading(name);
    await page.locator('button[aria-label="Reload current data"]:not([disabled])').waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
  };
  const confirmChange = () =>
    page
      .locator('[data-confirm-access-change]')
      .or(page.getByRole('button', { name: 'Confirm and save', exact: true }));
  const refreshAccess = async () => {
    if (await page.locator('[data-slot=sheet-content]').isVisible()) {
      const response = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/api/auth/session',
      );
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await response;
      return;
    }
    const tools = page.locator('details.access-session-tools');
    if ((await tools.getAttribute('open')) === null) await tools.locator('summary').click();
    await page.getByRole('button', { name: 'Refresh session and access', exact: true }).click();
  };
  const calls = [];
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith('/api/')) calls.push(path);
  });
  page.on('response', async (response) => {
    const path = new URL(response.url()).pathname;
    if (
      (!path.startsWith('/api/people/') &&
        !path.startsWith('/api/structure/') &&
        !path.startsWith('/api/invitations/') &&
        path !== '/api/auth/session' &&
        path !== '/api/workspace/status') ||
      response.status() < 400
    )
      return;
    const value = await response.json().catch(() => ({}));
    // Only finite error classification; never print response credentials or transport details.
    console.log(
      'People browser HTTP failure:',
      response.request().method(),
      path,
      response.status(),
      value.code ?? value.error?.code,
      value.reason,
    );
  });
  stage('administrator login');
  await login('member');
  await heading('Welcome, member.');
  await activateFeature();
  stage('queued deployment-clock preflight stays approved');
  await verifyDeploymentClockQueue();
  await page.reload();
  await heading('Welcome, member.');
  const negotiatedCatalog = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/people/catalog' &&
      r.request().headers()['x-turnstile-people-features'] === 'imports-v1',
  );
  await page.getByRole('link', { name: 'Users', exact: true }).first().click();
  await heading('Members');
  assert.equal((await negotiatedCatalog).status(), 200);
  await tabReady('Members');
  await page.getByRole('link', { name: 'Roles', exact: true }).click();
  await heading('Roles');
  await page.getByRole('button', { name: 'View Member', exact: true }).waitFor();
  stage('stable Users shell, cached tab revisits and explicit background refresh');
  await page.evaluate(() => {
    window.__usersCacheHeader = document.querySelector('.access-heading');
  });
  // Delay the actual request without replacing the production session handler or its response.
  let sessionArrived;
  let releaseSession;
  const arrived = new Promise((resolve) => {
    sessionArrived = resolve;
  });
  const released = new Promise((resolve) => {
    releaseSession = resolve;
  });
  const sessionRoute = async (route) => {
    sessionArrived();
    await released;
    await route.continue();
  };
  await page.route('**/api/auth/session', sessionRoute, { times: 1 });
  await page.getByRole('link', { name: 'Invitations', exact: true }).click();
  await arrived;
  assert.equal(await page.getByRole('heading', { name: 'Users', exact: true }).isVisible(), true);
  assert.equal(await page.getByRole('navigation', { name: 'People sections' }).isVisible(), true);
  assert.equal(
    await page.getByRole('button', { name: 'View Member', exact: true }).isVisible(),
    true,
  );
  assert.equal(await page.getByText('Loading page…', { exact: true }).count(), 0);
  releaseSession();
  await tabReady('Invitations');
  for (const tab of ['Activity', 'Members', 'Roles']) {
    await page.getByRole('link', { name: tab, exact: true }).click();
    await tabReady(tab);
  }
  const warmReads = calls.filter((path) => path.startsWith('/api/people/')).length;
  const warmCounts = {};
  for (const path of calls.filter((path) => path.startsWith('/api/people/')))
    warmCounts[path] = (warmCounts[path] ?? 0) + 1;
  const warmContextReads = calls.filter((path) =>
    ['/api/workspace/status', '/api/modules'].includes(path),
  ).length;
  const navigationCount = await page.evaluate(
    () => performance.getEntriesByType('navigation').length,
  );
  for (const tab of ['Members', 'Invitations', 'Activity', 'Roles']) {
    await clearRateLimits();
    await page.getByRole('link', { name: tab, exact: true }).click();
    await tabReady(tab);
    assert.equal(await page.getByText('Loading page…', { exact: true }).count(), 0);
    assert.equal(
      await page.evaluate(
        () => document.querySelector('.access-heading') === window.__usersCacheHeader,
      ),
      true,
    );
  }
  if (calls.filter((path) => path.startsWith('/api/people/')).length !== warmReads) {
    const afterCounts = {};
    for (const path of calls.filter((path) => path.startsWith('/api/people/')))
      afterCounts[path] = (afterCounts[path] ?? 0) + 1;
    console.log('Unexpected tab cache reads:', { warmCounts, afterCounts });
  }
  assert.equal(calls.filter((path) => path.startsWith('/api/people/')).length, warmReads);
  assert.equal(
    calls.filter((path) => ['/api/workspace/status', '/api/modules'].includes(path)).length,
    warmContextReads,
  );
  assert.equal(
    await page.evaluate(() => performance.getEntriesByType('navigation').length),
    navigationCount,
  );
  const refreshRoles = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/people/roles',
  );
  await page.getByRole('button', { name: 'Reload current data', exact: true }).click();
  assert.equal((await refreshRoles).status(), 200);
  await page.getByRole('button', { name: 'View Member', exact: true }).click();
  await page.getByRole('dialog', { name: 'Role details', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Duplicate role', exact: true }).click();
  await page.getByRole('button', { name: 'Review custom copy', exact: true }).click();
  await confirmChange().click();
  await heading('Member copy');
  stage('role details, permission differences, editable duplicate and deletion');
  await page.getByRole('button', { name: 'View Member copy', exact: true }).click();
  await page.getByRole('button', { name: 'Edit details', exact: true }).click();
  await page.getByLabel('Description', { exact: true }).fill('Browser-tested custom role');
  await page.getByRole('button', { name: 'Review details', exact: true }).click();
  await confirmChange().click();
  await page.getByRole('button', { name: 'View Member copy', exact: true }).click();
  await page.getByRole('button', { name: 'Edit permissions', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Read units', exact: true }).click();
  await page.getByRole('button', { name: 'Review permissions', exact: true }).click();
  await page
    .getByRole('region', { name: 'Permission changes', exact: true })
    .getByText('Read units', { exact: true })
    .waitFor();
  await confirmChange().click();
  await page.getByRole('button', { name: 'View Member copy', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate role', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Editable duplicate');
  await page.getByRole('checkbox', { name: 'Read units', exact: true }).click();
  await page.getByRole('button', { name: 'Review custom copy', exact: true }).click();
  await confirmChange().click();
  await page.getByRole('button', { name: 'View Editable duplicate', exact: true }).click();
  await page.getByRole('button', { name: 'Delete role', exact: true }).click();
  await page.getByRole('button', { name: 'Review deletion', exact: true }).click();
  await confirmChange().click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page
    .getByRole('heading', { name: 'Editable duplicate', exact: true })
    .waitFor({ state: 'detached' });

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1440, height: 900 });
  // The administrator Home may load its authorized legacy-configuration prompt.
  // From this point, administration routes must use their independent owning loaders.
  calls.length = 0;
  stage('authorized activity filtering and bounded CSV export');
  await clearRateLimits();
  await page.getByRole('link', { name: 'Activity', exact: true }).click();
  await heading('Activity');
  await page.getByLabel('Action', { exact: true }).selectOption('role_created');
  await page
    .locator('[data-slot=card-title]')
    .getByText('Role created', { exact: true })
    .first()
    .waitFor();
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export displayed events', exact: true }).click();
  const download = await exported;
  assert.equal(download.suggestedFilename(), 'turnstile-user-activity.csv');
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const exportedCsv = Buffer.concat(chunks).toString();
  assert.ok(exportedCsv.includes('"role_created"'));
  assert.ok(!exportedCsv.includes('"role_deleted"'), 'Export reflects the current filter');
  await page.getByRole('link', { name: 'Roles', exact: true }).click();
  await heading('Roles');
  stage('consolidated settings and structure navigation');
  await clearRateLimits();
  await page.goto(`${origin}/settings/organization`);
  await heading('General settings');
  await page.getByLabel('Organization name', { exact: true }).waitFor();
  await page.getByLabel('Time zone', { exact: true }).waitFor();
  await page.goto(`${origin}/settings/workspace`);
  await heading('General settings');
  assert.equal(new URL(page.url()).pathname, '/settings/organization');
  await page.goto(`${origin}/settings/organization/structure`);
  await heading('Structure');
  assert.equal(new URL(page.url()).pathname, '/structure');
  assert.equal(await page.getByRole('navigation', { name: 'People sections' }).count(), 0);
  await page.getByRole('button', { name: 'Chart', exact: true }).click();
  await page.getByRole('region', { name: 'Organization chart', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Fit chart', exact: true }).isVisible(),
    true,
  );
  await page.getByRole('button', { name: 'Add site', exact: true }).click();
  await page.getByLabel('Unit name', { exact: true }).fill('Navigation test site');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  assert.equal(
    await page.getByLabel('Unit name', { exact: true }).inputValue(),
    'Navigation test site',
  );
  await page.getByRole('button', { name: 'Review new unit', exact: true }).click();
  await page.getByRole('button', { name: 'Back to draft', exact: true }).click();
  assert.equal(
    await page.getByLabel('Unit name', { exact: true }).inputValue(),
    'Navigation test site',
  );
  await page.getByRole('button', { name: 'Review new unit', exact: true }).click();
  setFault('structure-outcome');
  await confirmChange().click();
  await page.getByRole('button', { name: 'Check command status', exact: true }).click();
  await capturePanel('structure-receipt');
  await heading('Navigation test site');
  await capturePanel('structure-saved');
  const canvasWidth = await page.locator('.hierarchy-map').evaluate((e) => e.clientWidth);
  await page
    .getByRole('button', {
      name: 'View People browser fixture / Navigation test site',
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Rename unit', exact: true }).click();
  assert.equal(await page.locator('.hierarchy-map').evaluate((e) => e.clientWidth), canvasWidth);
  await page.getByLabel('Unit name', { exact: true }).fill('Navigation test site renamed');
  await page.getByRole('button', { name: 'Review rename', exact: true }).click();
  setFault('structure-before-forward');
  await confirmChange().click();
  await page
    .getByRole('button', { name: 'Read current state and review the same command', exact: true })
    .click();
  await confirmChange().click();
  await heading('Navigation test site renamed');
  await page
    .getByRole('button', {
      name: 'View People browser fixture / Navigation test site renamed',
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Delete unit', exact: true }).click();
  await page.getByRole('button', { name: 'Review deletion', exact: true }).click();
  await confirmChange().click();
  await page
    .getByRole('dialog', { name: 'Edit organization unit', exact: true })
    .waitFor({ state: 'detached' });
  const workspaceNavigation = page.getByRole('navigation', { name: 'Workspace navigation' });
  await workspaceNavigation.getByRole('link', { name: 'Users', exact: true }).click();
  for (const section of ['Members', 'Invitations', 'Roles']) {
    await clearRateLimits();
    assert.equal(
      await workspaceNavigation.getByRole('link', { name: section, exact: true }).count(),
      0,
    );
    await page
      .getByRole('navigation', { name: 'People sections' })
      .getByRole('link', { name: section, exact: true })
      .click();
    await heading(section);
    await page
      .getByRole('navigation', { name: 'Workspace navigation' })
      .getByRole('link', { name: 'Users', exact: true })
      .getAttribute('aria-current')
      .then((v) => assert.equal(v, 'page'));
    assert.equal(
      await page
        .getByRole('navigation', { name: 'People sections' })
        .getByRole('link', { name: section, exact: true })
        .getAttribute('aria-current'),
      'page',
    );
  }
  calls.length = 0;
  await clearRateLimits();
  stage('Users task layout, validation and dismiss regressions');
  const selectedTab = await page.locator('.access-sections a[aria-current=page]').evaluate((e) => ({
    radius: getComputedStyle(e).borderRadius,
    border: getComputedStyle(e).borderBottomWidth,
    color: getComputedStyle(e).borderBottomColor,
  }));
  assert.equal(selectedTab.radius, '0px');
  assert.equal(selectedTab.border, '2px');
  assert.notEqual(selectedTab.color, 'rgba(0, 0, 0, 0)');
  await page.getByRole('button', { name: 'View Member', exact: true }).click();
  const roleTask = page.getByRole('dialog', { name: 'Role details', exact: true });
  assert.equal(await roleTask.getByRole('textbox', { name: 'Name', exact: true }).count(), 0);
  await page.keyboard.press('Escape');
  await roleTask.waitFor({ state: 'detached' });
  assert.equal(
    await page
      .getByRole('button', { name: 'View Member', exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await page.getByRole('link', { name: 'Invitations', exact: true }).click();
  await heading('Invitations');
  await page.getByRole('button', { name: 'Invite multiple members', exact: true }).click();
  await page.getByLabel('Email addresses', { exact: true }).fill('bad-email');
  await page.getByRole('combobox', { name: 'Role', exact: true }).selectOption({ label: 'Member' });
  await page.getByRole('button', { name: 'Review invitations', exact: true }).click();
  assert.equal(
    await page.getByLabel('Email addresses', { exact: true }).getAttribute('aria-invalid'),
    'true',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  assert.equal(await page.getByText('Changes saved.', { exact: true }).count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page
      .locator('.access-surface .overflow-x-auto')
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
    true,
  );
  const primary = await page
    .getByRole('button', { name: 'Invite member', exact: true })
    .boundingBox();
  const batch = await page
    .getByRole('button', { name: 'Invite multiple members', exact: true })
    .boundingBox();
  assert.ok(
    primary &&
      batch &&
      (primary.y + primary.height <= batch.y ||
        batch.y + batch.height <= primary.y ||
        primary.x + primary.width <= batch.x ||
        batch.x + batch.width <= primary.x),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('link', { name: 'Roles', exact: true }).click();
  await heading('Roles');
  stage('role creation');
  await page.getByRole('button', { name: 'Create role', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Browser reviewer');
  await capturePanel('create-role');
  await page.getByRole('button', { name: 'Review new role', exact: true }).click();
  await confirmChange().click();
  await page.getByRole('heading', { name: 'Browser reviewer', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Create role', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Uncertain reviewer');
  await page.getByRole('button', { name: 'Review new role', exact: true }).click();
  stage('uncertain command recovery');
  setFault('people-outcome');
  await confirmChange().click();
  assert.equal(
    await page.getByRole('button', { name: 'Close panel', exact: true }).isDisabled(),
    true,
    'Uncertain saves must keep the panel mounted',
  );
  await capturePanel('uncertain-save');
  await page.getByRole('button', { name: 'Check command status', exact: true }).click();
  await page.getByRole('heading', { name: 'Uncertain reviewer', exact: true }).waitFor();

  stage('stale review preserves draft');
  await page.getByRole('button', { name: 'Create role', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Stale review draft');
  await page.getByRole('button', { name: 'Review new role', exact: true }).click();
  await confirmChange().waitFor();
  const concurrentStatus = await page.evaluate(async () => {
    const session = await (await fetch('/api/auth/session')).json();
    const response = await fetch('/api/people/roles', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': session.csrfToken,
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        command: {
          operation: 'role.create',
          source: 'new',
          name: 'Concurrent reviewer',
          description: null,
          permissions: ['turnstile:access'],
          expectedAccessRevision: session.access.accessRevision,
        },
        confirmation: null,
      }),
    });
    return response.status;
  });
  assert.equal(concurrentStatus, 201);
  await confirmChange().click();
  await page
    .getByRole('alert')
    .filter({ hasText: /Saved access has changed/ })
    .waitFor();
  await page.getByRole('button', { name: 'Back to draft', exact: true }).click();
  assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Stale review draft');
  await page.getByRole('button', { name: 'Cancel and discard draft', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await refreshAccess();

  stage('invitation approval');
  await clearRateLimits();
  await page.getByRole('link', { name: 'Members', exact: true }).first().click();
  await heading('Members');
  await page.getByRole('button', { name: 'Invite member', exact: true }).click();
  await page.getByRole('dialog', { name: 'Invite member', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/people/members');
  await page.getByLabel('Recipient email', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  await page.getByRole('link', { name: 'Members', exact: true }).first().click();
  await heading('Members');
  await page.getByRole('link', { name: 'Invitations', exact: true }).first().click();
  await heading('Invitations');
  assert.equal(
    await page.getByLabel('Recipient email', { exact: true }).count(),
    0,
    'Consumed intent must not reopen a composer',
  );
  await page.getByRole('link', { name: 'Members', exact: true }).first().click();
  await heading('Members');
  await page.getByRole('button', { name: 'Invite member', exact: true }).click();
  await page.getByRole('dialog', { name: 'Invite member', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/people/members');
  await page.getByLabel('Recipient email', { exact: true }).fill('browser-invite@example.test');
  // Later revocation coverage deliberately edits Fixture operator; keep this
  // invitation on the immutable Member template so it remains independently current.
  assert.equal(
    await page.getByRole('combobox', { name: /^Role/ }).inputValue(),
    '',
    'Adding access requires an explicit role choice',
  );
  await page.getByRole('combobox', { name: /^Role/ }).selectOption({ label: 'Member' });
  await page.getByRole('combobox', { name: /^Scope/ }).selectOption('units');
  assert.equal(
    await page.getByRole('checkbox', { name: 'Include child units', exact: true }).isChecked(),
    true,
  );
  await page.getByRole('combobox', { name: /^Scope/ }).selectOption('company');
  await capturePanel('invitation');
  stage('invitation draft ready');
  await page.getByRole('button', { name: 'Review invitation', exact: true }).click();
  stage('invitation command ready');
  await capturePanel('invitation-review');
  stage('invitation impact ready');
  await confirmChange().click();
  await page.locator('.access-panel').waitFor({ state: 'detached' });
  await page.getByRole('link', { name: 'Invitations', exact: true }).click();
  await page.getByRole('heading', { name: 'browser-invite@example.test', exact: true }).waitFor();
  stage('production entrypoint restart preserves session and durable invitation');
  await restartProduct();
  await page.reload();
  await heading('Invitations');
  assert.equal(
    await page.evaluate(async () => {
      const response = await fetch('/api/people/invitations?limit=100');
      if (!response.ok) return false;
      const value = await response.json();
      return value.items.some(
        (item) => item.email === 'browser-invite@example.test' && item.state === 'pending',
      );
    }),
    true,
  );
  await clearRateLimits();
  stage('role reference drilldowns and shareable filters survive navigation and reload');
  await clearRateLimits();
  await page.getByRole('link', { name: 'Roles', exact: true }).click();
  await page.getByRole('link', { name: 'Members using Member', exact: true }).click();
  await heading('Members');
  const memberFilterUrl = page.url();
  assert.ok(new URL(memberFilterUrl).searchParams.has('roleId'));
  await page.getByLabel('Sort members', { exact: true }).selectOption('name_desc');
  assert.equal(new URL(page.url()).searchParams.get('sort'), 'name_desc');
  await page.goBack();
  assert.equal(await page.getByLabel('Sort members', { exact: true }).inputValue(), 'name');
  await page.reload();
  await heading('Members');
  assert.equal(
    new URL(page.url()).searchParams.get('roleId'),
    new URL(memberFilterUrl).searchParams.get('roleId'),
  );
  await page.getByRole('link', { name: 'Roles', exact: true }).click();
  await page.getByRole('link', { name: 'Open invitations using Member', exact: true }).click();
  await heading('Invitations');
  assert.equal(new URL(page.url()).searchParams.get('actionable'), 'true');
  const deliveryFiltered = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/people/invitations' &&
      new URL(r.url()).searchParams.get('delivery') === 'smtp_accepted',
  );
  await page.getByLabel('Email delivery filter', { exact: true }).selectOption('smtp_accepted');
  assert.equal((await deliveryFiltered).status(), 200);
  await page.getByRole('button', { name: 'Clear role invitation filter', exact: true }).click();
  await page.getByLabel('Email delivery filter', { exact: true }).selectOption('');
  stage('server-backed member role filters');
  await page.getByRole('link', { name: 'Members', exact: true }).click();
  await page.getByText('Filter by role or coverage', { exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Role filter', exact: true })
    .locator('option')
    .filter({ hasText: /^Member$/ })
    .waitFor({ state: 'attached' });
  stage('expanded assignment filters stay compact and align by available width');
  await page.locator('.directory-assignment-filters .unit-picker-results').waitFor();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await page.locator('.directory-filter-disclosure').evaluate((root) => {
      const role = root.querySelector('.directory-filter-role [data-slot=field-label]');
      const coverage = root.querySelector('.directory-filter-coverage [data-slot=field-label]');
      const results = root.querySelector('.unit-picker-results');
      return {
        height: root.getBoundingClientRect().height,
        searchHeights: [...root.querySelectorAll('.access-search')].map(
          (e) => e.getBoundingClientRect().height,
        ),
        roleTop: role.getBoundingClientRect().top,
        coverageTop: coverage.getBoundingClientRect().top,
        resultsHeight: results.clientHeight,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.ok(
      geometry.searchHeights.every((height) => height < 60),
      'Vertical pickers must not inherit toolbar flex heights',
    );
    assert.ok(
      geometry.height < (width === 1440 ? 420 : 650),
      'Expanded filters should fit their actual controls',
    );
    assert.ok(geometry.resultsHeight <= 193, 'Unit results remain bounded and scrollable');
    assert.equal(geometry.overflow, false);
    if (width === 1440)
      assert.ok(
        Math.abs(geometry.roleTop - geometry.coverageTop) < 2,
        'Desktop role and coverage labels align',
      );
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page
    .getByRole('combobox', { name: 'Role filter', exact: true })
    .selectOption({ label: 'Member' });
  await tabReady('Members');
  const filteredResponse = page.waitForResponse((r) =>
    r.url().includes('/api/people/members?roleId='),
  );
  await page.getByRole('button', { name: 'Reload current data', exact: true }).click();
  assert.equal((await filteredResponse).status(), 200);
  const coverageResponse = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/people/members' &&
      new URL(r.url()).searchParams.has('unitId'),
  );
  await page.locator('.directory-filter-coverage').getByRole('checkbox').first().click();
  assert.equal((await coverageResponse).status(), 200);
  await page.getByRole('button', { name: 'Clear assignment filters', exact: true }).click();
  await page.getByText('Filter by role or coverage', { exact: true }).click();
  stage('member access overview accepts negotiated catalog capabilities, including cached reads');
  await page
    .getByRole('button', { name: /^View access for / })
    .first()
    .click();
  const accessSheet = page.getByRole('dialog', { name: 'Access details', exact: true });
  await accessSheet.getByText('Roles & coverage', { exact: true }).waitFor();
  assert.equal(await accessSheet.getByRole('alert').count(), 0);
  await accessSheet.getByRole('button', { name: 'Close details', exact: true }).click();
  stage('durable CSV import validation, progress, recovery navigation and row error download');
  await clearRateLimits();
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  const imports = page.getByRole('dialog', { name: 'CSV imports', exact: true });
  await imports.getByLabel('Recipients CSV', { exact: true }).setInputFiles({
    name: 'browser-recipients.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'email\ncsv-browser@example.test\nCSV-BROWSER@example.test\ninvalid-recipient\n',
    ),
  });
  assert.equal(
    await imports.getByRole('button', { name: 'Validate and review', exact: true }).isDisabled(),
    true,
  );
  await imports.getByRole('button', { name: 'Add role assignment', exact: true }).click();
  assert.equal(
    await imports.getByRole('button', { name: 'Validate and review', exact: true }).isDisabled(),
    true,
  );
  await imports.getByRole('combobox', { name: /^Role/ }).selectOption({ label: 'Member' });
  await imports.getByRole('combobox', { name: /^Scope/ }).selectOption('units');
  assert.equal(
    await imports.getByRole('button', { name: 'Validate and review', exact: true }).isDisabled(),
    true,
  );
  await imports.getByRole('combobox', { name: /^Scope/ }).selectOption('company');
  await imports.getByRole('button', { name: 'Validate and review', exact: true }).click();
  await imports.getByRole('button', { name: 'Start import · 1 recipients', exact: true }).waitFor();
  assert.ok(await imports.getByText('Duplicate in this file', { exact: true }).isVisible());
  assert.ok(await imports.getByText('Invalid email address', { exact: true }).isVisible());
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    assert.ok(
      await imports
        .getByRole('button', { name: 'Start import · 1 recipients', exact: true })
        .isVisible(),
    );
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const errorDownload = page.waitForEvent('download');
  await imports.getByRole('button', { name: 'Download row errors', exact: true }).click();
  const importedErrors = await errorDownload;
  assert.ok(importedErrors.suggestedFilename().endsWith('-errors.csv'));
  await imports.getByRole('button', { name: 'Start import · 1 recipients', exact: true }).click();
  await imports.getByRole('button', { name: 'Close imports', exact: true }).first().click();
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  await imports.getByRole('button', { name: 'Open import', exact: true }).first().click();
  await imports
    .getByText('1 invitations saved · 1 skipped · 1 need attention · 0 cancelled', { exact: true })
    .waitFor({ timeout: 30000 });
  await imports.getByRole('button', { name: 'Close imports', exact: true }).first().click();
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  await imports.getByLabel('Recipients CSV', { exact: true }).setInputFiles({
    name: 'cancelled-import.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('email\nnever-queued@example.test\n'),
  });
  await imports.getByRole('button', { name: 'Add role assignment', exact: true }).click();
  await imports.getByRole('combobox', { name: /^Role/ }).selectOption({ label: 'Member' });
  await imports.getByRole('button', { name: 'Validate and review', exact: true }).click();
  await imports.getByRole('button', { name: 'Cancel remaining work', exact: true }).click();
  await imports.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
  await imports.getByText('Cancelled', { exact: true }).waitFor();
  await imports.getByRole('button', { name: 'Close imports', exact: true }).first().click();
  await clearRateLimits();
  stage('bulk recovery retries an uncommitted transport failure with the same command key');
  const recoveryWrites = [];
  const captureRecovery = (request) => {
    if (
      new URL(request.url()).pathname !== '/api/people/invitations' ||
      request.method() !== 'POST'
    )
      return;
    const body = request.postDataJSON();
    if (body.command.email === 'batch-recovery@example.test')
      recoveryWrites.push({ key: request.headers()['idempotency-key'], command: body.command });
  };
  page.on('request', captureRecovery);
  await page.getByRole('button', { name: 'Invite multiple members', exact: true }).click();
  await page.getByLabel('Email addresses', { exact: true }).fill('batch-recovery@example.test');
  await page.getByRole('combobox', { name: /^Role/ }).selectOption({ label: 'Member' });
  await page.getByRole('button', { name: 'Review invitations', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm and send 1 invitation', exact: true }).waitFor();
  setFault('bulk-invitation-before-forward');
  await page.getByRole('button', { name: 'Confirm and send 1 invitation', exact: true }).click();
  await page.getByText('Outcome uncertain', { exact: true }).waitFor();
  await page
    .getByRole('button', { name: 'Check outcome for batch-recovery@example.test', exact: true })
    .click();
  await page
    .getByRole('alert')
    .filter({ hasText: /no longer available/ })
    .waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Close batch', exact: true }).isDisabled(),
    true,
  );
  assert.equal(recoveryWrites.length, 1, 'Receipt lookup never retries a write');
  await page
    .getByRole('button', { name: 'Review recovery for batch-recovery@example.test', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'Retry reviewed invitation for batch-recovery@example.test',
      exact: true,
    })
    .click();
  await page.getByText('Saved · Pending acceptance', { exact: true }).waitFor();
  assert.equal(recoveryWrites.length, 2);
  assert.deepEqual(
    recoveryWrites[1],
    recoveryWrites[0],
    'Retry preserves the exact command and key',
  );
  page.off('request', captureRecovery);
  const recoveredInvitations = await page.evaluate(async () =>
    (await (await fetch('/api/people/invitations?limit=100')).json()).items.filter(
      (i) => i.email === 'batch-recovery@example.test',
    ),
  );
  assert.equal(recoveredInvitations.length, 1);
  await page.getByRole('button', { name: 'Close batch', exact: true }).click();
  await clearRateLimits();
  stage('bulk invitations stop on a lost acknowledgement and recover without replay');
  await page.getByRole('button', { name: 'Invite multiple members', exact: true }).click();
  await page
    .getByLabel('Email addresses', { exact: true })
    .fill('batch-one@example.test\nbatch-two@example.test');
  await page.getByRole('combobox', { name: /^Role/ }).selectOption({ label: 'Member' });
  await page.getByRole('button', { name: 'Review invitations', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm and send 2 invitations', exact: true }).waitFor();
  setFault('bulk-invitation-outcome');
  await page.getByRole('button', { name: 'Confirm and send 2 invitations', exact: true }).click();
  await page.getByText('Outcome uncertain', { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel('Unsent recipients', { exact: true }).inputValue(),
    'batch-two@example.test',
  );
  assert.equal(
    await page.getByRole('button', { name: 'Close batch', exact: true }).isDisabled(),
    true,
  );
  const cancelledBatch = await page.evaluate(async () => {
    const session = await (await fetch('/api/auth/session')).json();
    const list = await (await fetch('/api/people/invitations?limit=100')).json();
    const invitation = list.items.find((i) => i.email === 'batch-one@example.test');
    const command = {
      operation: 'invitation.cancel',
      id: invitation.id,
      expectedVersion: invitation.version,
      expectedGeneration: invitation.generation,
      expectedAccessRevision: session.access.accessRevision,
    };
    const headers = { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
    const impact = await (
      await fetch('/api/people/impact', {
        method: 'POST',
        headers,
        body: JSON.stringify({ command }),
      })
    ).json();
    const response = await fetch(`/api/people/invitations/${invitation.id}/cancel`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ command, confirmation: impact.confirmation }),
    });
    return response.status;
  });
  assert.equal(cancelledBatch, 200);
  await page
    .getByRole('button', { name: 'Check outcome for batch-one@example.test', exact: true })
    .click();
  await page.getByText('Saved · Cancelled', { exact: true }).waitFor();
  const batchRows = await page.evaluate(async () =>
    (await (await fetch('/api/people/invitations?limit=100')).json()).items.filter((item) =>
      ['batch-one@example.test', 'batch-two@example.test'].includes(item.email),
    ),
  );
  assert.equal(
    batchRows.length,
    1,
    'A lost acknowledgement stops the batch before later recipients',
  );
  assert.equal(batchRows[0].email, 'batch-one@example.test');
  assert.equal(
    batchRows[0].state,
    'cancelled',
    'Receipt recovery preserves intervening cancellation',
  );
  await page.getByRole('button', { name: 'Close batch', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await clearRateLimits();
  stage('bulk success records two independent invitations');
  await page.getByRole('button', { name: 'Invite multiple members', exact: true }).click();
  await page
    .getByLabel('Email addresses', { exact: true })
    .fill('batch-ok-one@example.test\nbatch-ok-two@example.test');
  await page.getByRole('combobox', { name: /^Role/ }).selectOption({ label: 'Member' });
  await page.getByRole('button', { name: 'Review invitations', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm and send 2 invitations', exact: true }).click();
  await page.getByText('Saved · Pending acceptance', { exact: true }).nth(1).waitFor();
  await page.getByRole('button', { name: 'Close batch', exact: true }).click();
  await clearRateLimits();
  stage('member suspension and reactivation');
  await page.getByRole('link', { name: 'Members', exact: true }).first().click();
  await heading('Members');
  await page.getByLabel('Search', { exact: true }).fill('bff-reset');
  await page.getByLabel('Search', { exact: true }).press('Enter');
  const row = page
    .locator('[data-slot="table-row"]')
    .filter({ has: page.getByRole('heading', { name: 'reset', exact: true }) });
  await row.getByRole('button', { name: /^View access for / }).click();
  await page.getByRole('button', { name: 'Review suspension', exact: true }).click();
  await confirmChange().click();
  await row.getByText('Suspended', { exact: true }).waitFor();
  await row.getByRole('button', { name: /^View access for / }).click();
  await page.getByRole('button', { name: 'Review reactivation', exact: true }).click();
  await confirmChange().click();
  await row.getByText('Active', { exact: true }).waitFor();
  stage('member overview and deliberate access editing');
  await row.getByRole('button', { name: /^View access for / }).click();
  const details = page.getByRole('dialog', { name: 'Access details', exact: true });
  await details.getByText('Check effective access', { exact: true }).click();
  await details.getByLabel('Permission to check', { exact: true }).selectOption('turnstile:access');
  await details.getByText('Allowed by workspace access', { exact: true }).waitFor();
  await details.getByText('Check effective access', { exact: true }).click();
  await details.getByRole('button', { name: 'Edit access', exact: true }).click();
  await page.getByRole('button', { name: 'Add role assignment', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Role', exact: true })
    .last()
    .selectOption({ label: 'Member' });
  await page.getByRole('button', { name: 'Review assignments', exact: true }).click();
  await confirmChange().click();
  await details.waitFor({ state: 'detached' });
  await row.getByText('Member', { exact: true }).waitFor();
  await row.getByRole('button', { name: /^View access for / }).click();
  await details.getByRole('heading', { name: 'Member', exact: true }).waitFor();
  await page
    .locator('.users-task-sheet .access-panel-body')
    .evaluate((e) => e.scrollTo({ top: 0, behavior: 'instant' }));
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: Optional screenshots in this standalone uncached browser runner.
  if (process.env.MEMBERS_DESIGN_CAPTURE === '1')
    await page.screenshot({ path: '/tmp/turnstile-members-overview.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1440, height: 900 });

  await details.getByRole('button', { name: 'Edit access', exact: true }).click();
  await page.getByRole('button', { name: 'Add role assignment', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel changes', exact: true }).click();
  assert.equal(await details.getByRole('combobox', { name: 'Role', exact: true }).count(), 0);
  await details.getByRole('button', { name: 'Close details', exact: true }).click();
  await clearRateLimits();

  const forbidden = () =>
    calls.filter(
      (p) => p === '/api/setup' || p === '/api/organization' || p === '/api/organization/units',
    );
  assert.deepEqual(forbidden(), [], 'People routes must not load company snapshots');
  await context.clearCookies();
  stage('independent People-only access');
  await login('reset');
  await heading('Welcome, reset.');
  calls.length = 0;
  await page.goto(`${origin}/people/members`);
  await heading('Members');
  await page
    .getByRole('button', { name: /^View access for / })
    .first()
    .waitFor();
  assert.deepEqual(forbidden(), []);
  await page.goto(`${origin}/people/roles`);
  await page
    .getByRole('alert')
    .filter({ hasText: /do not have access/ })
    .waitFor();
  assert.equal(calls.includes('/api/people/roles'), false);
  stage('independent role-only access and drafts');
  await login('operator');
  await heading('Welcome, operator.');
  calls.length = 0;
  await page.getByRole('link', { name: 'Users', exact: true }).first().click();
  await heading('Roles');
  assert.equal(new URL(page.url()).pathname, '/people/roles');
  await page.getByRole('button', { name: 'Create role', exact: true }).waitFor();
  assert.deepEqual(forbidden(), []);
  assert.equal(calls.includes('/api/people/members'), false);
  assert.equal(await page.getByRole('link', { name: 'Activity', exact: true }).count(), 0);
  assert.equal(await page.evaluate(async () => (await fetch('/api/people/audit')).status), 403);
  await page.getByRole('button', { name: 'Create role', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Unsaved role');
  await page.keyboard.press('Escape');
  await page.getByRole('alertdialog').waitFor();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Unsaved role');
  stage('same-subject role revocation and restoration retain the draft');
  const draftShell = await page.locator('.workspace').elementHandle();
  await clearRateLimits();
  const administratorContext = await context.browser().newContext({ ignoreHTTPSErrors: true });
  try {
    const administrator = await administratorContext.newPage();
    await administrator.goto(`${origin}/api/auth/login`);
    await administrator
      .getByLabel('Email address', { exact: true })
      .fill(fixture.users.member.email);
    await administrator.getByLabel('Password', { exact: true }).fill(fixture.password);
    await administrator.getByRole('button', { name: 'Sign in', exact: true }).click();
    await administrator.getByRole('heading', { name: 'Welcome, member.', exact: true }).waitFor();
    const changeOperatorRole = async (restore) => {
      const status = await administrator.evaluate(
        async ({ restore }) => {
          const session = await (await fetch('/api/auth/session')).json();
          const catalog = await (await fetch('/api/people/catalog')).json();
          const roles = await (await fetch('/api/people/roles?limit=100')).json();
          const role = roles.items.find((candidate) => candidate.name === 'Fixture operator');
          const command = {
            operation: 'role.patch',
            change: 'permissions',
            id: role.id,
            expectedVersion: role.version,
            expectedAccessRevision: session.access.accessRevision,
            expectedOrganizationRevision: catalog.organizationRevision,
            permissions: ['turnstile:access', ...(restore ? ['turnstile:roles:manage'] : [])],
          };
          const headers = { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
          const impact = await fetch('/api/people/impact', {
            method: 'POST',
            headers,
            body: JSON.stringify({ command }),
          });
          if (!impact.ok) return impact.status;
          const { confirmation } = await impact.json();
          const result = await fetch(`/api/people/roles/${role.id}`, {
            method: 'PATCH',
            headers: { ...headers, 'idempotency-key': crypto.randomUUID() },
            body: JSON.stringify({ command, confirmation }),
          });
          return result.status;
        },
        { restore },
      );
      assert.equal(status, 200, 'Owning role command must change real operator authorization');
    };
    await changeOperatorRole(false);
    await refreshAccess();
    await page
      .getByRole('alert')
      .filter({ hasText: /do not have access/ })
      .waitFor();
    assert.equal(await page.getByLabel('Name', { exact: true }).isVisible(), false);
    assert.equal(
      await page.getByRole('heading', { name: 'Fixture operator', exact: true }).isVisible(),
      false,
    );
    assert.equal(
      await page.evaluate(async () => (await fetch('/api/people/roles?limit=25')).status),
      403,
      'Real owning HTTP must deny the revoked actor',
    );
    calls.length = 0;
    await refreshAccess();
    await page.getByText('Checking session…', { exact: true }).waitFor({ state: 'hidden' });
    assert.equal(
      calls.some((path) => path.startsWith('/api/people/')),
      false,
      'Blocked draft owners must not call administration loaders',
    );
    await changeOperatorRole(true);
    await refreshAccess();
    await page.getByLabel('Name', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Unsaved role');
  } finally {
    await administratorContext.close();
  }
  stage('same-document session recovery retains the draft');
  await context.clearCookies();
  // Focus/periodic revalidation may already hide the editor after cookie removal.
  // Exercise that real recovery path instead of racing its disappearing button.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await heading('Your session has ended');
  assert.equal(await page.getByLabel('Name', { exact: true }).isVisible(), false);
  calls.length = 0;
  await page.getByRole('button', { name: 'Check session and access', exact: true }).click();
  await page
    .getByRole('button', { name: 'Check session and access', exact: true })
    .waitFor({ state: 'visible' });
  assert.equal(
    calls.some((path) => path.startsWith('/api/people/')),
    false,
  );
  const recovery = await context.newPage();
  await recovery.goto(`${origin}/api/auth/login`);
  await recovery.getByLabel('Email address', { exact: true }).fill(fixture.users.operator.email);
  await recovery.getByLabel('Password', { exact: true }).fill(fixture.password);
  await recovery.getByRole('button', { name: 'Sign in', exact: true }).click();
  await recovery.getByRole('heading', { name: 'Welcome, operator.', exact: true }).waitFor();
  await recovery.close();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByLabel('Name', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Unsaved role');
  assert.equal(
    await draftShell.evaluate((element) => element.isConnected),
    true,
    'Same-subject recovery must preserve the mounted workspace shell',
  );
  await context.clearCookies();
  await page.getByRole('button', { name: 'Review new role', exact: true }).click();
  await page
    .getByRole('alert')
    .filter({ hasText: /Your session ended/ })
    .waitFor();
  await page.getByRole('button', { name: 'Back to draft', exact: true }).click();
  assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Unsaved role');
  stage('confirmed identity change clears the old subject draft');
  const otherIdentity = await context.newPage();
  await otherIdentity.goto(`${origin}/api/auth/login`);
  await otherIdentity.getByLabel('Email address', { exact: true }).fill(fixture.users.member.email);
  await otherIdentity.getByLabel('Password', { exact: true }).fill(fixture.password);
  await otherIdentity.getByRole('button', { name: 'Sign in', exact: true }).click();
  await otherIdentity.getByRole('heading', { name: 'Welcome, member.', exact: true }).waitFor();
  await otherIdentity.close();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText(fixture.users.member.email, { exact: true }).waitFor();
  await page
    .getByRole('button', { name: 'Create role', exact: true })
    .waitFor({ state: 'visible' });
  assert.equal(await page.getByLabel('Name', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Create role', exact: true }).click();
  assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), '');
  await page.getByRole('button', { name: 'Cancel and discard draft', exact: true }).click();
  stage('scoped structure');
  await login('suspended');
  await heading('Welcome, suspended.');
  calls.length = 0;
  await page.goto(`${origin}/structure`);
  await heading('Structure');
  await page.getByRole('heading', { name: 'North', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Operations', exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole('link', { name: 'Edit organization name in General settings', exact: true })
      .count(),
    0,
  );
  await page
    .getByRole('button', { name: 'Collapse People browser fixture / North', exact: true })
    .click();
  assert.equal(
    await page.getByRole('heading', { name: 'Operations', exact: true }).isVisible(),
    false,
  );
  assert.equal(
    await page
      .getByRole('button', { name: 'View People browser fixture / North', exact: true })
      .isVisible(),
    true,
  );
  await page
    .getByRole('button', { name: 'Expand People browser fixture / North', exact: true })
    .click();
  assert.equal(await page.getByRole('heading', { name: 'South', exact: true }).count(), 0);
  assert.deepEqual(forbidden(), []);
  await page
    .getByRole('button', { name: 'View People browser fixture / North', exact: true })
    .click();
  assert.equal(
    await page.getByRole('button', { name: 'Delete unit', exact: true }).isDisabled(),
    true,
  );
  await page.getByRole('button', { name: 'Add department', exact: true }).click();
  assert.deepEqual(
    await page.getByLabel('New unit type', { exact: true }).locator('option').allTextContents(),
    ['Department'],
  );
  const longName = `Browser department ${'Long'.repeat(23)}`;
  await page.getByLabel('Unit name', { exact: true }).fill(longName);
  await page.getByRole('button', { name: 'Review new unit', exact: true }).click();
  await confirmChange().click();
  await page.getByRole('heading', { name: longName, exact: true }).waitFor();
  await page
    .getByRole('button', { name: 'View People browser fixture / North / Operations', exact: true })
    .click();
  await page.getByRole('button', { name: 'Move to…', exact: true }).click();
  await page
    .getByLabel('New parent', { exact: true })
    .selectOption({ label: `People browser fixture / North / ${longName}` });
  await page.getByRole('button', { name: 'Review move', exact: true }).click();
  await page.getByText(/0 members and 0 invitations affected/).waitFor();
  await confirmChange().click();
  await page
    .getByRole('button', {
      name: `View People browser fixture / North / ${longName} / Operations`,
      exact: true,
    })
    .waitFor();
  await page.getByRole('button', { name: 'Outline', exact: true }).click();
  const moveHandle = page.getByRole('button', {
    name: `Move People browser fixture / North / ${longName} / Operations`,
    exact: true,
  });
  const moveCount = calls.filter((p) => p.startsWith('/api/structure/')).length;
  await moveHandle.dragTo(
    page.getByRole('button', {
      name: `View People browser fixture / North / ${longName} / Operations`,
      exact: true,
    }),
  );
  assert.equal(
    await page.getByRole('dialog', { name: 'Edit organization unit', exact: true }).count(),
    0,
  );
  assert.equal(
    calls.filter((p) => p.startsWith('/api/structure/')).length,
    moveCount,
    'An invalid drop submits no command',
  );
  await moveHandle.dragTo(
    page.getByRole('button', { name: 'View People browser fixture / North', exact: true }),
  );
  await page.getByLabel('New parent', { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel('New parent', { exact: true }).locator('option:checked').textContent(),
    'People browser fixture / North',
  );
  await page.getByRole('button', { name: 'Review move', exact: true }).click();
  await confirmChange().click();
  await page
    .getByRole('button', { name: 'View People browser fixture / North / Operations', exact: true })
    .waitFor();
  await capturePanel('structure-outline');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await heading('Structure');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page
    .getByRole('button', { name: 'View People browser fixture / North', exact: true })
    .tap();
  await page.getByRole('dialog', { name: 'Unit details', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add department', exact: true }).tap();
  await page.getByLabel('Unit name', { exact: true }).fill('Phone draft');
  await page.getByRole('button', { name: 'Review new unit', exact: true }).tap();
  await page.getByRole('button', { name: 'Back to draft', exact: true }).tap();
  assert.equal(await page.getByLabel('Unit name', { exact: true }).inputValue(), 'Phone draft');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Keep editing', exact: true }).tap();
  await capturePanel('structure-phone-task');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).tap();
  await page.getByRole('button', { name: 'Close unit details', exact: true }).tap();
  await capturePanel('structure-phone-outline');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).tap();
  await page.getByRole('dialog').getByRole('link', { name: 'Home', exact: true }).tap();
  await heading('Welcome, suspended.');
  await page.goBack();
  await heading('Structure');
  assert.deepEqual(forbidden(), []);

  stage('recipient account setup');
  let inviteLink;
  for (let attempt = 0; attempt < 40 && !inviteLink; attempt++) {
    const list = await (await fetch(`${mailUrl}/api/v1/messages`)).json();
    const entry = list.messages.find(
      (m) =>
        m.To.some((to) => to.Address === 'browser-invite@example.test') &&
        m.Subject.toLowerCase().includes('invitation'),
    );
    if (entry) {
      const detail = await (await fetch(`${mailUrl}/api/v1/message/${entry.ID}`)).json();
      inviteLink = detail.Text.match(/https?:\/\/[^\s]+/g)?.find((link) =>
        link.includes('/invitations/join#'),
      );
    }
    if (!inviteLink) await delay(500);
  }
  assert.ok(inviteLink, 'Expected captured invitation');
  await context.clearCookies();
  await page.goto(inviteLink);
  await heading('Join your workspace');
  assert.equal(new URL(page.url()).hash, '');
  await page.getByRole('button', { name: 'Review invitation', exact: true }).click();
  stage('wrong account switch');
  await page.getByRole('button', { name: 'Sign in with an existing account', exact: true }).click();
  await page.getByLabel('Email address', { exact: true }).fill(fixture.users.operator.email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page
    .getByRole('button', { name: 'Sign out of this identity and switch accounts', exact: true })
    .click();
  await page
    .getByRole('alert')
    .filter({ hasText: /Sign in with the email address/ })
    .waitFor();
  await context.clearCookies();
  await page.goto(inviteLink);
  await page.getByRole('button', { name: 'Review invitation', exact: true }).click();
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await heading('Create your account');
  const recipientPassword = randomBytes(24).toString('base64url');
  await page.getByLabel('Your name', { exact: true }).fill('Browser recipient');
  await page.getByLabel('Choose a password', { exact: true }).fill(recipientPassword);
  await page
    .getByRole('button', { name: 'Create account and send verification', exact: true })
    .click();
  await heading('Verify your email');
  const verification = await mailLink('verify', 'browser-invite@example.test');
  stage('recipient verification and acceptance');
  const verificationPage = await context.newPage();
  await verificationPage.goto(verification);
  await verificationPage.getByLabel('Email address', { exact: true }).waitFor();
  await verificationPage.close();
  await page.getByRole('button', { name: 'I verified my email — continue', exact: true }).click();
  await page.getByLabel('Email address', { exact: true }).fill('browser-invite@example.test');
  await page.getByLabel('Password', { exact: true }).fill(recipientPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await heading('Welcome, Browser recipient.');
  console.log(
    'People browser: real HTTPS/OIDC role creation, invitation approval, member suspension/reactivation, independent policy/loaders, dirty navigation and narrow scoped structure passed.',
  );
  await testDeployment({ page, context, login, origin });
  stage('complete authorized hierarchy across the 100-unit page boundary');
  // The deployment journey ends at the verified administrator Home. Reuse that
  // session instead of interrupting a new OIDC callback with the next navigation.
  await heading('Welcome, member.');
  await clearRateLimits();
  await page.goto(`${origin}/structure`);
  await page.getByRole('button', { name: 'Reload structure', exact: true }).waitFor();
  const targetTotal = 101;
  for (let batch = 0; batch < 5; batch++) {
    await clearRateLimits();
    const outcome = await page.evaluate(
      async ({ batch, targetTotal }) => {
        const session = await (await fetch('/api/auth/session')).json();
        const initial = await (await fetch('/api/structure/units?limit=100')).json();
        const root = initial.ancestors.find((u) => u.type === 'organization');
        let revision = initial.revision,
          accessRevision = initial.accessRevision;
        const amount = Math.min(20, targetTotal - initial.total);
        if (!root) return { ok: false, code: 'root' };
        for (let index = 0; index < amount; index++) {
          const response = await fetch('/api/structure/units', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-csrf-token': session.csrfToken,
              'idempotency-key': crypto.randomUUID(),
            },
            body: JSON.stringify({
              expectedOrganizationRevision: revision,
              expectedAccessRevision: accessRevision,
              parentId: root.id,
              type: 'department',
              name: `Hierarchy load ${String(batch * 20 + index).padStart(3, '0')}`,
            }),
          });
          const value = await response.json();
          if (!response.ok) return { ok: false, status: response.status, code: value.code };
          revision = value.current.revision;
          accessRevision = value.current.accessRevision;
        }
        return { ok: true };
      },
      { batch, targetTotal },
    );
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
  }
  await clearRateLimits();
  calls.length = 0;
  await page.reload();
  await page.getByText('101 units within your access', { exact: true }).waitFor();
  await page.locator('button[aria-label="Reload structure"]:not([disabled])').waitFor();
  assert.equal(calls.filter((p) => p === '/api/structure/units').length, 2);
  const readCount = calls.length;
  await page.getByLabel('Find a site or department', { exact: true }).fill('Hierarchy load 095');
  await page.getByRole('heading', { name: 'Hierarchy load 095', exact: true }).waitFor();
  assert.equal(
    await page.getByText('1 matching unit within your access', { exact: true }).isVisible(),
    true,
  );
  await page.getByRole('button', { name: 'Outline', exact: true }).click();
  await page.getByRole('button', { name: 'Chart', exact: true }).click();
  assert.equal(
    calls.length,
    readCount,
    'Local search and view changes reuse the complete verified hierarchy',
  );
  return {
    secrets: [
      recipientPassword,
      new URL(inviteLink).hash.slice(1),
      new URL(verification).searchParams.get('token'),
    ],
  };
}
