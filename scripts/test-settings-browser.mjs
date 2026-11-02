import assert from 'node:assert/strict';

// Extends the disposable production-profile HTTPS fixture through supported UI/HTTP.
// Never reads customer configuration or writes grants outside that private fixture.
export async function testSettings({
  page,
  context,
  browser,
  origin,
  login,
  setAccess,
  waitForAuthorityWindow,
}) {
  const configurationResponses = [];
  const recordConfigurationResponse = (response) => {
    const path = new URL(response.url()).pathname;
    if (
      response.request().method() === 'GET' &&
      /^\/api\/(organization(?:\/units)?|setup)$/.test(path)
    ) {
      configurationResponses.push({ path, status: response.status() });
      if (configurationResponses.length > 12) configurationResponses.shift();
    }
  };
  page.on('response', recordConfigurationResponse);
  const heading = (target, name) => target.getByRole('heading', { name, exact: true }).waitFor();
  const managerPermissions = [
    'turnstile:access',
    'turnstile:dms:capabilities:read',
    'turnstile:configuration:manage',
  ];
  const ordinaryPermissions = managerPermissions.slice(0, 2);
  const sections = [
    '/settings',
    '/settings/organization',
    '/settings/organization/structure',
    '/settings/workspace',
  ];
  console.log('Settings verification: ordinary access boundary.');
  await login('reset');
  await heading(page, 'Welcome, reset.');
  assert.equal(
    await page
      .getByRole('navigation', { name: 'Workspace navigation' })
      .getByRole('link', { name: 'Settings', exact: true })
      .count(),
    0,
  );
  let configurationReads = 0;
  const observe = (request) => {
    if (
      request.method() === 'GET' &&
      /\/api\/(organization(?:\/units)?|setup)$/.test(new URL(request.url()).pathname)
    )
      configurationReads++;
  };
  page.on('request', observe);
  for (const path of sections) {
    await page.goto(`${origin}${path}`);
    await heading(page, 'Settings access required');
  }
  page.off('request', observe);
  assert.equal(configurationReads, 0);
  const denials = await page.evaluate(async () => {
    const session = await (await fetch('/api/auth/session')).json();
    const id = crypto.randomUUID();
    const headers = {
      'content-type': 'application/json',
      'x-csrf-token': session.csrfToken,
      'idempotency-key': crypto.randomUUID(),
    };
    const requests = [
      ['/api/organization', 'GET'],
      ['/api/organization/units', 'GET'],
      ['/api/setup', 'GET'],
      ['/api/organization', 'PATCH', { expectedRevision: 0, name: 'Denied edit' }],
      [
        '/api/organization/units',
        'POST',
        { expectedRevision: 0, type: 'site', parentId: id, name: 'Denied unit' },
      ],
      [`/api/organization/units/${id}`, 'PATCH', { expectedRevision: 0, name: 'Denied rename' }],
      [`/api/organization/units/${id}`, 'DELETE', { expectedRevision: 0 }],
    ];
    return Promise.all(
      requests.map(
        async ([path, method, body]) =>
          (await fetch(path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }))
            .status,
      ),
    );
  });
  assert.deepEqual(denials, Array(7).fill(403));
  const secondContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
  });
  await secondContext.addCookies(await context.cookies());
  const second = await secondContext.newPage();
  second.setDefaultTimeout(10000);
  try {
    await login('member');
    await heading(page, 'Welcome, member.');
    const before = await page.evaluate(async () => ({
      profile: await (await fetch('/api/organization')).json(),
      setup: await (await fetch('/api/setup')).json(),
    }));
    await page
      .getByRole('navigation', { name: 'Workspace navigation' })
      .getByRole('link', { name: 'Settings', exact: true })
      .click();
    await heading(page, 'Setup overview');
    await page.getByText('Activated', { exact: true }).waitFor();
    await page.getByText(before.setup.completion.completedBy, { exact: true }).waitFor();
    assert.equal(
      await page.locator('time').getAttribute('datetime'),
      before.setup.completion.completedAt,
    );
    await page
      .getByText(
        'Add sites or departments whenever you need them. Your workspace is ready to use.',
        { exact: true },
      )
      .waitFor();

    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('link', { name: 'Organization', exact: true })
      .click();
    await heading(page, 'Organization');
    await page.getByLabel('Organization name', { exact: true }).fill('');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    assert.equal(
      await page.getByLabel('Organization name', { exact: true }).getAttribute('aria-invalid'),
      'true',
    );
    await page.getByLabel('Organization name', { exact: true }).fill('Discarded Settings draft');
    assert.equal(
      await page.getByLabel('Organization name', { exact: true }).getAttribute('aria-invalid'),
      'false',
    );
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('link', { name: 'Cancel', exact: true }).click();
    await heading(page, 'Setup overview');
    await page.getByText(before.profile.organization.name, { exact: true }).waitFor();
    const patches = [];
    console.log('Settings verification: canonical profile and regional edits.');
    const recordPatch = (request) => {
      if (new URL(request.url()).pathname === '/api/organization' && request.method() === 'PATCH')
        patches.push(request.postDataJSON());
    };
    page.on('request', recordPatch);
    await page.goto(`${origin}/settings/organization`);
    await heading(page, 'Organization');
    await page.getByLabel('Organization name', { exact: true }).fill('Settings organization');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByText('Organization name saved.', { exact: true }).waitFor();
    await page.reload();
    await heading(page, 'Organization');
    assert.equal(
      await page.getByLabel('Organization name', { exact: true }).inputValue(),
      'Settings organization',
    );
    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('link', { name: 'Workspace', exact: true })
      .click();
    await heading(page, 'Workspace regional defaults');
    await page.getByLabel('Time zone', { exact: true }).selectOption('');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    assert.equal(
      await page.getByLabel('Time zone', { exact: true }).getAttribute('aria-invalid'),
      'true',
    );
    await page.getByLabel('Time zone', { exact: true }).selectOption('Europe/London');
    assert.equal(
      await page.getByLabel('Time zone', { exact: true }).getAttribute('aria-invalid'),
      'false',
    );
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByText('Time zone saved.', { exact: true }).waitFor();
    page.off('request', recordPatch);
    assert.deepEqual(
      patches.map((body) => Object.keys(body).sort()),
      [
        ['expectedRevision', 'name'],
        ['expectedRevision', 'timeZone'],
      ],
    );
    await page.reload();
    await heading(page, 'Workspace regional defaults');
    assert.equal(await page.getByLabel('Time zone', { exact: true }).inputValue(), 'Europe/London');

    // Re-saving unchanged values reports no change and never claims a write.
    const stableRevision = await page.evaluate(
      async () => (await (await fetch('/api/organization')).json()).revision,
    );
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByText('No changes to save.', { exact: true }).waitFor();
    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('link', { name: 'Organization', exact: true })
      .click();
    await heading(page, 'Organization');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByText('No changes to save.', { exact: true }).waitFor();
    await page.getByLabel('Organization name', { exact: true }).fill('  Settings organization  ');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByText('No changes to save.', { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(async () => (await (await fetch('/api/organization')).json()).revision),
      stableRevision,
    );

    console.log('Settings verification: structure create and selected edits.');
    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('link', { name: 'Structure', exact: true })
      .click();
    await heading(page, 'Organization structure');
    const list = page.getByRole('list', { name: 'Saved units' });
    const actionButton = (action, name) =>
      list
        .getByRole('listitem')
        .filter({ has: page.getByText(name, { exact: true }) })
        .getByRole('button', { name: new RegExp(`^${action} `) });
    const create = async (name) => {
      await page.getByLabel('Unit name', { exact: true }).fill(name);
      await page.getByRole('button', { name: 'Add unit', exact: true }).click();
      await list.getByText(name, { exact: true }).waitFor();
    };
    await create('First site');
    await create('Second site');
    const firstId = await page.evaluate(
      async () =>
        (await (await fetch('/api/organization/units')).json()).units.find(
          (item) => item.name === 'First site',
        ).id,
    );
    await page.getByLabel('Unit type', { exact: true }).selectOption('department');
    await page.getByLabel('Parent', { exact: true }).selectOption(firstId);
    await create('Child department');
    assert.match(
      await actionButton('Rename', 'Child department').getAttribute('aria-label'),
      /Department.*First site/,
    );
    assert.equal(await actionButton('Remove', 'First site').isEnabled(), false);
    assert.equal(await actionButton('Rename', 'Settings organization').count(), 0);
    assert.equal(await actionButton('Remove', 'Settings organization').count(), 0);

    await setAccess('reset', managerPermissions);
    console.log('Settings verification: concurrent rename reconciliation.');
    await second.goto(`${origin}/settings/organization`);
    await heading(second, 'Organization');
    await actionButton('Rename', 'First site').click();
    await heading(page, 'Rename unit');
    await page.getByLabel('New unit name', { exact: true }).fill('Renamed site');
    await second
      .getByLabel('Organization name', { exact: true })
      .fill('Second administrator Settings');
    await second.getByRole('button', { name: 'Save changes', exact: true }).click();
    await second.getByText('Organization name saved.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Save unit name', exact: true }).click();
    await page.getByText(/Saved setup has changed/).waitFor();
    assert.equal(
      await page.getByLabel('New unit name', { exact: true }).inputValue(),
      'Renamed site',
    );
    assert.equal(
      await page.getByRole('button', { name: 'Save unit name', exact: true }).isEnabled(),
      false,
    );
    await page.getByRole('button', { name: 'Load latest saved data', exact: true }).click();
    await page.getByText(/Latest saved data loaded. Compare it with your entry/).waitFor();
    await page.getByRole('status').filter({ hasText: 'Latest saved data loaded.' }).waitFor();
    await page.getByRole('button', { name: 'Save unit name', exact: true }).click();
    await page.getByText('Unit name saved.', { exact: true }).waitFor();
    await list.getByText('Renamed site', { exact: true }).waitFor();
    await actionButton('Rename', 'Second site').click();
    await heading(page, 'Rename unit');
    await page.getByLabel('New unit name', { exact: true }).fill('Renamed site');
    await page.getByRole('button', { name: 'Save unit name', exact: true }).click();
    await page
      .getByText('A unit with this name already exists under this parent.', { exact: true })
      .waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Save unit name', exact: true }).isEnabled(),
      true,
    );
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await list.getByText('Second site', { exact: true }).waitFor();

    console.log('Settings verification: confirmed and uncertain removal.');
    await actionButton('Remove', 'Child department').click();
    await heading(page, 'Remove unit?');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await list.getByText('Child department', { exact: true }).waitFor();
    const childId = await page.evaluate(
      async () =>
        (await (await fetch('/api/organization/units')).json()).units.find(
          (item) => item.name === 'Child department',
        ).id,
    );
    await page.getByLabel('Parent', { exact: true }).selectOption(childId);
    let deletes = 0;
    const lostDelete = async (route) => {
      if (route.request().method() !== 'DELETE') return route.continue();
      deletes++;
      const result = await route.fetch({
        url: route.request().url().replace('auth.fixture.test', '127.0.0.1'),
        headers: { ...route.request().headers(), host: new URL(origin).host },
        maxRetries: 0,
      });
      assert.equal(result.status(), 200);
      await route.abort('failed');
    };
    await page.route('**/api/organization/units/*', lostDelete);
    await actionButton('Remove', 'Child department').click();
    await page.getByRole('button', { name: 'Remove unit', exact: true }).click();
    await page.getByText(/We couldn’t confirm this change/).waitFor();
    assert.equal(deletes, 1);
    assert.equal(
      await page.getByRole('button', { name: 'Remove unit', exact: true }).isEnabled(),
      false,
    );
    await page.getByRole('button', { name: 'Load latest saved data', exact: true }).click();
    await page
      .getByText('This unit no longer exists. Cancel to return to the saved structure.', {
        exact: true,
      })
      .waitFor();
    assert.equal(deletes, 1);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.unroute('**/api/organization/units/*', lostDelete);
    assert.equal(await list.getByText('Child department', { exact: true }).count(), 0);
    assert.equal(
      await page.getByLabel('Parent', { exact: true }).inputValue(),
      before.profile.organization.rootId,
    );
    const secondId = await page.evaluate(
      async () =>
        (await (await fetch('/api/organization/units')).json()).units.find(
          (item) => item.name === 'Second site',
        ).id,
    );
    await page.getByLabel('Parent', { exact: true }).selectOption(secondId);
    await actionButton('Remove', 'Second site').click();
    await page.getByRole('button', { name: 'Remove unit', exact: true }).click();
    await page.getByText('Unit removed.', { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel('Parent', { exact: true }).inputValue(),
      before.profile.organization.rootId,
    );
    const replacement = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/organization/units',
    );
    await create('Replacement department');
    assert.equal(
      (await replacement).request().postDataJSON().parentId,
      before.profile.organization.rootId,
    );
    await actionButton('Remove', 'Replacement department').click();
    await page.getByRole('button', { name: 'Remove unit', exact: true }).click();
    await page.getByText('Unit removed.', { exact: true }).waitFor();

    // Each uncertain create needs its own subsequent saved readback before a fresh key.
    let uncertainCreates = 0;
    const unavailableCreate = async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      uncertainCreates++;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'CONFIGURATION_UNAVAILABLE' }),
      });
    };
    await page.route('**/api/organization/units', unavailableCreate);
    for (const name of ['Unconfirmed first entry', 'Unconfirmed second entry']) {
      await page.getByLabel('Unit name', { exact: true }).fill(name);
      await page.getByRole('button', { name: 'Add unit', exact: true }).click();
      await page.getByRole('button', { name: 'Retry same request', exact: true }).waitFor();
      assert.equal(
        await page.getByRole('button', { name: 'Start a new entry', exact: true }).count(),
        0,
      );
      await page.getByRole('button', { name: 'Load latest saved data', exact: true }).click();
      await page.getByRole('button', { name: 'Start a new entry', exact: true }).click();
      assert.equal(await page.getByLabel('Unit name', { exact: true }).inputValue(), name);
    }
    assert.equal(uncertainCreates, 2);
    await page.unroute('**/api/organization/units', unavailableCreate);
    await page.getByLabel('Unit name', { exact: true }).fill('');
    await page.reload();
    await heading(page, 'Organization structure');
    await list.getByText('Renamed site', { exact: true }).waitFor();
    assert.equal(await list.getByText('Second site', { exact: true }).count(), 0);
    assert.equal(await actionButton('Remove', 'Renamed site').isEnabled(), true);

    await page.setViewportSize({ width: 320, height: 760 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.screenshot({ path: '/tmp/turnstile-onb-i06-structure-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.screenshot({ path: '/tmp/turnstile-onb-i06-structure-desktop.png', fullPage: true });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('link', { name: 'Setup overview', exact: true })
      .click();
    await heading(page, 'Setup overview');
    await page.getByText('Second administrator Settings', { exact: true }).waitFor();
    await page.getByText('Europe/London', { exact: true }).waitFor();
    await page.getByText('Site: Renamed site', { exact: true }).waitFor();
    const after = await page.evaluate(async () => ({
      profile: await (await fetch('/api/organization')).json(),
      setup: await (await fetch('/api/setup')).json(),
    }));
    assert.equal(after.profile.organization.rootId, before.profile.organization.rootId);
    assert.deepEqual(after.setup.completion, before.setup.completion);
    assert.equal(after.setup.state, 'completed');

    await waitForAuthorityWindow();
    // Current authorization is checked on the mutation, then status removes the editor.
    await page.goto(`${origin}/settings/organization/structure`);
    await heading(page, 'Organization structure');
    await actionButton('Rename', 'Renamed site').click();
    await page.getByLabel('New unit name', { exact: true }).fill('Revoked write');
    await setAccess('member', ordinaryPermissions);
    const revokedResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname.startsWith('/api/organization/units/'),
    );
    await page.getByRole('button', { name: 'Save unit name', exact: true }).click();
    const rejected = await revokedResponse;
    assert.equal(rejected.status(), 403);
    assert.ok(['CSRF_REJECTED', 'PERMISSION_DENIED'].includes((await rejected.json()).code));
    // Live permission changes rotate stored CSRF before the route permission check.
    await page
      .getByText(/Your session changed|You no longer have permission to manage configuration/)
      .waitFor();
    await page.getByRole('button', { name: 'Refresh session', exact: true }).click();
    await heading(page, 'Settings access required');
    assert.equal(await page.getByLabel('New unit name', { exact: true }).count(), 0);
    await setAccess('member', managerPermissions);
    await page.getByRole('button', { name: 'Check access', exact: true }).click();
    await heading(page, 'Organization structure');
    await list.getByText('Renamed site', { exact: true }).waitFor();
    await setAccess('reset', ordinaryPermissions);
    await page
      .getByRole('navigation', { name: 'Workspace navigation' })
      .getByRole('link', { name: 'Home', exact: true })
      .click();
    await heading(page, 'Welcome, member.');
    await page.getByRole('button', { name: 'Check connection', exact: true }).waitFor();
    console.log(
      'Settings browser journey passed: manager-only routes and APIs, canonical profile/zone, explicit cancel, shared create, rename conflict/duplicate recovery, protected root/non-leaf, confirmed and lost-response deletion, stable activation/root, live grant revocation, reload/overview and 320px/reduced-motion layouts.',
    );
  } catch (error) {
    console.error('Recent Settings reads:', configurationResponses);
    // Report only source locations, never fixture cookies, inputs or continuation URLs.
    console.error(
      'Settings fixture source:',
      error instanceof Error
        ? error.stack?.match(/test-settings-browser\.mjs:\d+:\d+/g)
        : 'unknown',
    );
    throw error;
  } finally {
    page.off('response', recordConfigurationResponse);
    await secondContext.close();
  }
}
