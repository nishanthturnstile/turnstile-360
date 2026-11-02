import assert from 'node:assert/strict';

// Called only by the disposable HTTPS/authority browser harness. Uses supported HTTP
// and private fixture grants; no customer data, SQL bootstrap, or alternate auth path.
export async function testOnboarding({
  page,
  context,
  browser,
  origin,
  login,
  setAccess,
  clearRateLimits,
  restartProduct,
}) {
  const heading = (target, name) => target.getByRole('heading', { name, exact: true }).waitFor();
  const managerPermissions = [
    'turnstile:access',
    'turnstile:dms:capabilities:read',
    'turnstile:configuration:manage',
  ];
  await login('reset');
  await heading(page, 'Waiting for setup');
  assert.equal(new URL(page.url()).pathname, '/waiting-for-setup');
  const ordinary = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
  });
  await ordinary.addCookies(await context.cookies());
  const waiting = await ordinary.newPage();
  waiting.setDefaultTimeout(10000);
  try {
    await waiting.goto(`${origin}/onboarding/review`);
    await heading(waiting, 'Waiting for setup');
    const minimal = await waiting.evaluate(
      async () => await (await fetch('/api/workspace/status')).json(),
    );
    assert.deepEqual(minimal, { status: 'incomplete', canManageConfiguration: false });
    assert.equal(
      await waiting.getByRole('button', { name: 'Activate workspace', exact: true }).count(),
      0,
    );
    let releaseStatus;
    const statusGate = new Promise((resolve) => {
      releaseStatus = resolve;
    });
    const delayedStatus = async (route) => {
      await statusGate;
      await route.continue();
    };
    await page.route('**/api/workspace/status', delayedStatus);
    await login('member');
    await page.getByRole('status').filter({ hasText: 'Loading workspace…' }).waitFor();
    assert.equal(
      await page.getByRole('heading', { name: 'Welcome, member.', exact: true }).count(),
      0,
    );
    assert.equal(await page.locator('.auth-layout').count(), 0);
    releaseStatus();
    await heading(page, 'Tell us about your organization');
    await page.unroute('**/api/workspace/status', delayedStatus);
    await page.goto(`${origin}/onboarding/review`);
    await heading(page, 'Tell us about your organization');
    await page.goto(`${origin}/unknown-workspace-path`);
    await heading(page, 'Page not found');
    assert.equal(await page.getByRole('heading', { name: 'A place to begin' }).count(), 0);
    await page.goBack();
    await heading(page, 'Tell us about your organization');
    let profileWrites = 0;
    const countProfileWrites = (request) => {
      if (new URL(request.url()).pathname === '/api/organization' && request.method() === 'PATCH')
        profileWrites++;
    };
    page.on('request', countProfileWrites);
    await page.getByRole('button', { name: 'Save and exit', exact: true }).click();
    await heading(page, 'Setup saved for later');
    assert.equal(profileWrites, 0);
    page.off('request', countProfileWrites);
    await page.getByRole('link', { name: 'Resume setup', exact: true }).click();
    await heading(page, 'Tell us about your organization');
    await page.getByLabel('Organization name', { exact: true }).fill('Unsaved draft');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('link', { name: 'Cancel', exact: true }).click();
    assert.equal(
      await page.getByLabel('Organization name', { exact: true }).inputValue(),
      'Unsaved draft',
    );
    await page.getByLabel('Organization name', { exact: true }).fill('');
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await page
      .getByLabel('Organization name', { exact: true })
      .getAttribute('aria-invalid')
      .then((value) => assert.equal(value, 'true'));
    await page
      .getByLabel('Organization name', { exact: true })
      .fill('Browser fixture organization');
    assert.equal(
      await page
        .getByLabel('Organization name', { exact: true })
        .evaluate((element) => document.activeElement === element),
      true,
    );
    await page.getByRole('button', { name: 'Save and exit', exact: true }).click();
    await heading(page, 'Setup saved for later');
    await page.getByText('Not confirmed yet', { exact: true }).waitFor();
    await restartProduct();
    await page.reload();
    await heading(page, 'Setup saved for later');
    await page.getByRole('link', { name: 'Resume setup', exact: true }).click();
    await heading(page, 'Tell us about your organization');
    assert.equal(
      await page.getByLabel('Organization name', { exact: true }).inputValue(),
      'Browser fixture organization',
    );
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
    assert.equal(
      await page
        .getByLabel('Time zone', { exact: true })
        .evaluate((element) => document.activeElement === element),
      true,
    );
    await page.getByLabel('Time zone', { exact: true }).selectOption('UTC');

    // Recoverable readiness outages hide content while retaining the same form instance.
    await page.getByLabel('Organization name', { exact: true }).fill('Retained outage draft');
    const unavailable = async (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'CONFIGURATION_UNAVAILABLE' }),
      });
    await page.route('**/api/workspace/status', unavailable);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await heading(page, 'Setup is temporarily unavailable');
    assert.equal(await page.getByLabel('Organization name', { exact: true }).isVisible(), false);
    await page.unroute('**/api/workspace/status', unavailable);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await heading(page, 'Tell us about your organization');
    assert.equal(
      await page.getByLabel('Organization name', { exact: true }).inputValue(),
      'Retained outage draft',
    );
    const authUnavailable = async (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'AUTH_UNAVAILABLE' }),
      });
    await page.route('**/api/auth/session', authUnavailable);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await heading(page, 'We can’t connect right now');
    assert.equal(await page.getByLabel('Organization name', { exact: true }).isVisible(), false);
    await page.unroute('**/api/auth/session', authUnavailable);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await heading(page, 'Tell us about your organization');
    assert.equal(
      await page.getByLabel('Organization name', { exact: true }).inputValue(),
      'Retained outage draft',
    );
    await page
      .getByLabel('Organization name', { exact: true })
      .fill('Browser fixture organization');

    let failSave = true;
    const transient = async (route) => {
      if (route.request().method() === 'PATCH' && failSave) {
        failSave = false;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'CONFIGURATION_UNAVAILABLE' }),
        });
      } else await route.continue();
    };
    await page.route('**/api/organization', transient);
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await page.getByText(/We couldn’t confirm this change/).waitFor();
    // The unsent UTC selection must remain distinct from the persisted null zone.
    await page.getByRole('heading', { name: 'Saved organization', exact: true }).waitFor();
    await page.getByText('Not confirmed yet', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Time zone', { exact: true }).inputValue(), 'UTC');
    assert.equal(
      await page.getByLabel('Organization name', { exact: true }).inputValue(),
      'Browser fixture organization',
    );
    await page.unroute('**/api/organization', transient);
    await page.getByRole('button', { name: 'Load latest saved data', exact: true }).click();
    await page.getByText(/Latest saved data loaded/).waitFor();

    let releaseSave;
    const gate = new Promise((resolve) => {
      releaseSave = resolve;
    });
    let entered;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    let finishedSave;
    const saveHandled = new Promise((resolve) => {
      finishedSave = resolve;
    });
    const delayed = async (route) => {
      if (route.request().method() === 'PATCH') {
        entered();
        await gate;
      }
      await route.continue();
      finishedSave();
    };
    await page.route('**/api/organization', delayed);
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await started;
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await heading(page, 'You’re signed out');
    releaseSave();
    await saveHandled;
    await page.unroute('**/api/organization', delayed);
    await heading(page, 'You’re signed out');
    await login('member');
    await heading(page, 'Tell us about your organization');
    await page.getByLabel('Time zone', { exact: true }).selectOption('UTC');
    await page.getByRole('button', { name: 'Save and exit', exact: true }).click();
    await heading(page, 'Setup saved for later');
    await page.getByRole('link', { name: 'Resume setup', exact: true }).click();
    await heading(page, 'Ready to open your workspace?');
    await page.getByRole('link', { name: 'Edit organization', exact: true }).click();
    await heading(page, 'Tell us about your organization');

    // Clearing saved required values and exiting pauses without a mutation.
    profileWrites = 0;
    page.on('request', countProfileWrites);
    await page.getByLabel('Organization name', { exact: true }).fill('');
    await page.getByLabel('Time zone', { exact: true }).selectOption('');
    await page.getByRole('button', { name: 'Save and exit', exact: true }).click();
    await heading(page, 'Setup saved for later');
    assert.equal(profileWrites, 0);
    page.off('request', countProfileWrites);
    await page.getByText('Browser fixture organization', { exact: true }).waitFor();
    await page.getByText('UTC', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Resume setup', exact: true }).click();
    await heading(page, 'Ready to open your workspace?');
    await page.getByRole('link', { name: 'Edit organization', exact: true }).click();
    await heading(page, 'Tell us about your organization');
    assert.equal(
      await page.getByLabel('Organization name', { exact: true }).inputValue(),
      'Browser fixture organization',
    );
    assert.equal(await page.getByLabel('Time zone', { exact: true }).inputValue(), 'UTC');

    // Exiting with one cleared field submits only the remaining value.
    await page.getByLabel('Organization name', { exact: true }).fill('');
    await page.getByLabel('Time zone', { exact: true }).selectOption('Europe/London');
    const exitWrite = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === '/api/organization' && request.method() === 'PATCH',
    );
    await page.getByRole('button', { name: 'Save and exit', exact: true }).click();
    const exitPayload = JSON.parse((await exitWrite).postData() ?? '{}');
    assert.equal(exitPayload.name, undefined);
    assert.equal(exitPayload.timeZone, 'Europe/London');
    await heading(page, 'Setup saved for later');
    await page.getByText('Browser fixture organization', { exact: true }).waitFor();
    await page.getByText('Europe/London', { exact: true }).waitFor();

    // Restore the canonical regional value before the remaining shared journey.
    await page.getByRole('link', { name: 'Resume setup', exact: true }).click();
    await heading(page, 'Ready to open your workspace?');
    await page.getByRole('link', { name: 'Edit organization', exact: true }).click();
    await heading(page, 'Tell us about your organization');
    await page.getByLabel('Time zone', { exact: true }).selectOption('UTC');
    await page.getByRole('button', { name: 'Save and exit', exact: true }).click();
    await heading(page, 'Setup saved for later');
    await page.getByText('UTC', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Resume setup', exact: true }).click();
    await heading(page, 'Ready to open your workspace?');
    await page.getByRole('link', { name: 'Edit organization', exact: true }).click();
    await heading(page, 'Tell us about your organization');

    await setAccess('reset', managerPermissions);
    await waiting.goto(`${origin}/onboarding/organization`);
    await heading(waiting, 'Tell us about your organization');
    assert.equal(
      await waiting.getByLabel('Organization name', { exact: true }).inputValue(),
      'Browser fixture organization',
    );
    await waiting
      .getByLabel('Organization name', { exact: true })
      .fill('Shared administrator update');
    await waiting.getByRole('button', { name: 'Save and exit', exact: true }).click();
    await heading(waiting, 'Setup saved for later');
    await setAccess('reset', ['turnstile:access', 'turnstile:dms:capabilities:read']);
    await waiting.goto(`${origin}/waiting-for-setup`);
    await heading(waiting, 'Waiting for setup');
    await page
      .getByLabel('Organization name', { exact: true })
      .fill('Deliberately reconciled organization');
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await page.getByText(/Saved setup has changed/).waitFor();
    assert.equal(
      await page.getByLabel('Organization name', { exact: true }).inputValue(),
      'Deliberately reconciled organization',
    );
    await page.getByRole('button', { name: 'Load latest saved data', exact: true }).click();
    await page.getByText('Shared administrator update', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await heading(page, 'Add structure, if you need it');
    // Reset only the disposable fixture window so the expanded journey stays inside the
    // real authority's 100/minute introspection limit. Production limits stay enabled.
    await clearRateLimits();

    const attempts = [];
    let dropUnit = true;
    const lostUnit = async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      attempts.push({
        body: route.request().postData(),
        key: route.request().headers()['idempotency-key'],
      });
      if (dropUnit) {
        dropUnit = false;
        const result = await route.fetch({
          url: route.request().url().replace('auth.fixture.test', '127.0.0.1'),
          headers: { ...route.request().headers(), host: new URL(origin).host },
          maxRetries: 0,
        });
        assert.equal(result.status(), 201);
        await route.abort('failed');
      } else await route.continue();
    };
    await page.route('**/api/organization/units', lostUnit);
    await page.getByLabel('Unit name', { exact: true }).fill('Main site');
    await page.getByRole('button', { name: 'Add unit', exact: true }).click();
    await page.getByRole('button', { name: 'Retry same request', exact: true }).waitFor();
    assert.equal(attempts.length, 1);
    await page.getByRole('button', { name: 'Load latest saved data', exact: true }).click();
    await page
      .getByRole('list', { name: 'Saved units' })
      .getByText('Main site', { exact: true })
      .waitFor();
    await page.getByRole('button', { name: 'Retry same request', exact: true }).click();
    await page
      .getByText('Request confirmed. The latest saved structure is shown.', { exact: true })
      .waitFor();
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[0], attempts[1]);
    assert.equal(
      await page
        .getByRole('list', { name: 'Saved units' })
        .getByText('Main site', { exact: true })
        .count(),
      1,
    );
    await page.unroute('**/api/organization/units', lostUnit);
    await page.getByLabel('Unit name', { exact: true }).fill('Main site');
    const duplicateResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/organization/units' &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Add unit', exact: true }).click();
    assert.equal((await duplicateResponse).status(), 409);
    await page
      .getByText('A unit with this name already exists under this parent.', { exact: true })
      .waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Add unit', exact: true }).isEnabled(),
      true,
    );
    assert.equal(
      await page
        .getByLabel('Unit name', { exact: true })
        .evaluate((element) => document.activeElement === element),
      true,
    );
    assert.equal(
      await page.getByLabel('Unit name', { exact: true }).getAttribute('aria-invalid'),
      'true',
    );
    await page.getByLabel('Unit name', { exact: true }).fill('Renamed draft');
    assert.equal(
      await page.getByRole('button', { name: 'Add unit', exact: true }).isEnabled(),
      true,
    );
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('link', { name: 'Continue to review', exact: true }).click();
    await heading(page, 'Ready to open your workspace?');
    await page.getByText(/1 optional sites or departments saved/).waitFor();
    await page.getByRole('link', { name: 'Edit structure', exact: true }).click();
    await heading(page, 'Add structure, if you need it');
    await page
      .getByRole('list', { name: 'Saved units' })
      .getByText('Main site', { exact: true })
      .waitFor();
    // Remove the optional fixture unit through the already-supported owning API so the
    // same real browser journey also proves root-only activation. Rename/delete UI is I06.
    assert.equal(
      await page.evaluate(async () => {
        const session = await (await fetch('/api/auth/session')).json();
        const units = await (await fetch('/api/organization/units')).json();
        const unit = units.units.find((item) => item.type === 'site');
        return (
          await fetch(`/api/organization/units/${unit.id}`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
            body: JSON.stringify({ expectedRevision: units.revision }),
          })
        ).status;
      }),
      200,
    );
    await page.getByRole('link', { name: 'Continue to review', exact: true }).click();
    await heading(page, 'Ready to open your workspace?');
    await page.getByText(/0 optional sites or departments saved/).waitFor();
    await page.setViewportSize({ width: 320, height: 760 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.screenshot({ path: '/tmp/turnstile-onb-i05-review-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.screenshot({ path: '/tmp/turnstile-onb-i05-review-desktop.png', fullPage: true });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    let dropActivation = true;
    const activations = [];
    const lostActivation = async (route) => {
      activations.push(route.request().postData());
      if (dropActivation) {
        dropActivation = false;
        const result = await route.fetch({
          url: route.request().url().replace('auth.fixture.test', '127.0.0.1'),
          headers: { ...route.request().headers(), host: new URL(origin).host },
          maxRetries: 0,
        });
        assert.equal(result.status(), 200);
        await route.abort('failed');
      } else await route.continue();
    };
    await page.route('**/api/setup/complete', lostActivation);
    await page.getByRole('button', { name: 'Activate workspace', exact: true }).click();
    await page.getByText(/We couldn’t confirm this change/).waitFor();
    assert.equal(new URL(page.url()).pathname, '/onboarding/review');
    assert.equal(activations.length, 1);
    await page.getByRole('button', { name: 'Activate workspace', exact: true }).click();
    await heading(page, 'Welcome, member.');
    assert.equal(activations.length, 2);
    assert.equal(activations[0], activations[1]);
    await page.unroute('**/api/setup/complete', lostActivation);
    await waiting.getByRole('button', { name: 'Retry', exact: true }).click();
    await heading(waiting, 'Welcome, reset.');
    await page.goto(`${origin}/onboarding/organization`);
    await heading(page, 'Welcome, member.');
    assert.equal(new URL(page.url()).pathname, '/');
    await page.goto(`${origin}/unknown-workspace-path`);
    await heading(page, 'Page not found');
    await page.getByRole('link', { name: 'Return to workspace', exact: true }).click();
    await heading(page, 'Welcome, member.');
    let releaseConnection;
    const connectionGate = new Promise((resolve) => {
      releaseConnection = resolve;
    });
    let connectionStarted;
    const connectionEntered = new Promise((resolve) => {
      connectionStarted = resolve;
    });
    let connectionFinished;
    const connectionHandled = new Promise((resolve) => {
      connectionFinished = resolve;
    });
    const delayedConnection = async (route) => {
      connectionStarted();
      await connectionGate;
      await route.continue();
      connectionFinished();
    };
    await page.route('**/api/dms/capabilities', delayedConnection);
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await connectionEntered;
    // Deterministic persisted-pageshow ordering while a pre-restore request owns busy.
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
    );
    await heading(page, 'Welcome, member.');
    assert.equal(
      await page.getByRole('button', { name: 'Check connection', exact: true }).isEnabled(),
      true,
    );
    assert.equal(
      await page.getByRole('button', { name: 'Sign out', exact: true }).isEnabled(),
      true,
    );
    releaseConnection();
    await connectionHandled;
    await page.unroute('**/api/dms/capabilities', delayedConnection);
    console.log(
      'Onboarding browser journey passed: ordinary waiting, partial save/exit/resume across restart, shared administrators, revision reconciliation, retained optional units, exact-key lost-response retry, root-only activation/readback, logout fencing, deep links/Back, no implicit POST retries and 320px/reduced-motion layouts.',
    );
  } finally {
    await ordinary.close();
  }
}
