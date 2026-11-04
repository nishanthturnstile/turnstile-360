import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
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
  await page.reload();
  await heading('Welcome, member.');
  await page.getByRole('link', { name: 'Roles', exact: true }).first().click();
  await heading('Roles');
  await page.getByRole('button', { name: 'View Member', exact: true }).click();
  await page.getByRole('region', { name: 'Role details', exact: true }).waitFor();
  await page.getByText('System templates are read-only.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Review custom copy', exact: true }).click();
  await page.getByRole('button', { name: 'Review current impact', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm and save', exact: true }).click();
  await heading('Member copy');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1440, height: 900 });
  // The administrator Home may load its authorized legacy-configuration prompt.
  // From this point, administration routes must use their independent owning loaders.
  calls.length = 0;
  stage('consolidated settings and structure navigation');
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
  await page.getByLabel('Structure view', { exact: true }).selectOption('chart');
  assert.equal(await page.locator('.access-structure-view').getAttribute('data-view'), 'chart');
  await page.getByRole('button', { name: 'Add site', exact: true }).click();
  await page.getByLabel('Unit name', { exact: true }).fill('Navigation test site');
  await page.getByRole('button', { name: 'Review new unit', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm and save', exact: true }).click();
  await heading('Navigation test site');
  await page.getByRole('button', { name: 'Manage Navigation test site', exact: true }).click();
  await page.getByLabel('Action', { exact: true }).selectOption('delete');
  await page.getByRole('button', { name: 'Review deletion', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm and save', exact: true }).click();
  await page
    .getByRole('region', { name: 'Unit details', exact: true })
    .waitFor({ state: 'detached' });
  for (const section of ['Members', 'Invitations', 'Roles']) {
    await page
      .getByRole('navigation', { name: 'Workspace navigation' })
      .getByRole('link', { name: section, exact: true })
      .click();
    await heading(section);
    await page
      .getByRole('navigation', { name: 'Workspace navigation' })
      .getByRole('link', { name: section, exact: true })
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
  stage('role creation');
  await page.getByRole('button', { name: 'Create role', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Browser reviewer');
  await capturePanel('create-role');
  await page.getByRole('button', { name: 'Review new role', exact: true }).click();
  await page.getByRole('button', { name: 'Review current impact', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm and save', exact: true }).click();
  await page.getByRole('heading', { name: 'Browser reviewer', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Create role', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Uncertain reviewer');
  await page.getByRole('button', { name: 'Review new role', exact: true }).click();
  await page.getByRole('button', { name: 'Review current impact', exact: true }).click();
  stage('uncertain command recovery');
  setFault('people-outcome');
  await page.getByRole('button', { name: 'Confirm and save', exact: true }).click();
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
  await page.getByRole('button', { name: 'Review current impact', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm and save', exact: true }).waitFor();
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
  await page.getByRole('button', { name: 'Confirm and save', exact: true }).click();
  await page
    .getByRole('alert')
    .filter({ hasText: /Saved access has changed/ })
    .waitFor();
  await page.getByRole('button', { name: 'Back to draft', exact: true }).click();
  assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Stale review draft');
  await page.getByRole('button', { name: 'Cancel and discard draft', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh session and access', exact: true }).click();

  stage('invitation approval');
  await clearRateLimits();
  await page.getByRole('link', { name: 'Members', exact: true }).first().click();
  await heading('Members');
  await page.getByRole('button', { name: 'Invite person', exact: true }).click();
  await heading('Invitations');
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
  await page.getByRole('button', { name: 'Invite person', exact: true }).click();
  await heading('Invitations');
  await page.getByLabel('Recipient email', { exact: true }).fill('browser-invite@example.test');
  await page.getByRole('button', { name: 'Add role assignment', exact: true }).click();
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
  await page.getByRole('button', { name: 'Review current impact', exact: true }).click();
  await capturePanel('invitation-review');
  stage('invitation impact ready');
  await page.getByRole('button', { name: 'Confirm and save', exact: true }).click();
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
  await page.getByRole('button', { name: 'Review current impact', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm and save', exact: true }).click();
  await row.getByText('Suspended', { exact: true }).waitFor();
  await row.getByRole('button', { name: /^View access for / }).click();
  await page.getByRole('button', { name: 'Review reactivation', exact: true }).click();
  await page.getByRole('button', { name: 'Review current impact', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm and save', exact: true }).click();
  await row.getByText('Active', { exact: true }).waitFor();
  stage('member overview and deliberate access editing');
  await row.getByRole('button', { name: /^View access for / }).click();
  const details = page.getByRole('region', { name: 'Access details', exact: true });
  await details.getByRole('button', { name: 'Edit access', exact: true }).click();
  await page.getByRole('button', { name: 'Add role assignment', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Role', exact: true })
    .last()
    .selectOption({ label: 'Member' });
  await page.getByRole('button', { name: 'Review assignments', exact: true }).click();
  await page.getByRole('button', { name: 'Review current impact', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm and save', exact: true }).click();
  await details.waitFor({ state: 'detached' });
  await row.getByText('Member', { exact: true }).waitFor();
  await row.getByRole('button', { name: /^View access for / }).click();
  await details.getByRole('heading', { name: 'Member', exact: true }).waitFor();
  await page
    .getByRole('region', { name: 'Workspace content', exact: true })
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
  await page.goto(`${origin}/people/roles`);
  await heading('Roles');
  await page.getByRole('button', { name: 'Create role', exact: true }).waitFor();
  assert.deepEqual(forbidden(), []);
  assert.equal(calls.includes('/api/people/members'), false);
  await page.getByRole('button', { name: 'Create role', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Unsaved role');
  page.once('dialog', (d) => void d.dismiss());
  await page.getByRole('link', { name: 'Home', exact: true }).first().click();
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
    await page.getByRole('button', { name: 'Refresh session and access', exact: true }).click();
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
    await page.getByRole('button', { name: 'Refresh session and access', exact: true }).click();
    await page.getByText('Checking session…', { exact: true }).waitFor({ state: 'hidden' });
    assert.equal(
      calls.some((path) => path.startsWith('/api/people/')),
      false,
      'Blocked draft owners must not call administration loaders',
    );
    await changeOperatorRole(true);
    await page.getByRole('button', { name: 'Refresh session and access', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Unsaved role');
  } finally {
    await administratorContext.close();
  }
  stage('same-document session recovery retains the draft');
  await context.clearCookies();
  await page.getByRole('button', { name: 'Refresh session and access', exact: true }).click();
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
  await page.getByRole('button', { name: 'Review current impact', exact: true }).click();
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
  const northBranch = page
    .locator('.access-branch')
    .filter({ has: page.getByRole('heading', { name: 'North', exact: true }) })
    .last();
  await northBranch.getByRole('heading', { name: 'Operations', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Manage People browser fixture', exact: true }).count(),
    0,
  );
  await page.getByRole('button', { name: 'Toggle North branch', exact: true }).click();
  assert.equal(
    await page.getByRole('heading', { name: 'Operations', exact: true }).isVisible(),
    false,
  );
  assert.equal(
    await page.getByRole('button', { name: 'Manage North', exact: true }).isVisible(),
    true,
  );
  await page.getByRole('button', { name: 'Toggle North branch', exact: true }).click();
  assert.equal(await page.getByRole('heading', { name: 'South', exact: true }).count(), 0);
  assert.deepEqual(forbidden(), []);
  await page.getByRole('button', { name: 'Manage North', exact: true }).click();
  await page.getByLabel('Action', { exact: true }).selectOption('create');
  const longName = `Browser department ${'Long'.repeat(23)}`;
  await page.getByLabel('Unit name', { exact: true }).fill(longName);
  await page.getByRole('button', { name: 'Review new unit', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm and save', exact: true }).click();
  await page.getByRole('heading', { name: longName, exact: true }).waitFor();
  await page.getByRole('button', { name: 'Manage Operations', exact: true }).click();
  await page.getByLabel('Action', { exact: true }).selectOption('move');
  await page
    .getByLabel('Parent for new unit or move destination', { exact: true })
    .selectOption({ label: `People browser fixture / North / ${longName}` });
  await page.getByRole('button', { name: 'Review move', exact: true }).click();
  await page.getByText(/0 members and 0 invitations affected/).waitFor();
  await page.getByRole('button', { name: 'Confirm and save', exact: true }).click();
  await page
    .locator('.access-branch')
    .filter({ has: page.getByRole('heading', { name: longName, exact: true }) })
    .last()
    .getByRole('heading', { name: 'Operations', exact: true })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await heading('Structure');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
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
  return {
    secrets: [
      recipientPassword,
      new URL(inviteLink).hash.slice(1),
      new URL(verification).searchParams.get('token'),
    ],
  };
}
