import assert from 'node:assert/strict';

// Real completed HTTPS workspace, with read-only v1 projections for legacy presentation.
// The database upgrade suite separately verifies real preserved v1 completions/guards.
export async function testWorkspaceNavigation({ page, origin }) {
  const heading = (name) => page.getByRole('heading', { name, exact: true }).waitFor();
  const home = () => heading('Welcome, member.');
  const nav = () => page.getByRole('navigation', { name: 'Workspace navigation', exact: true });
  console.log('Workspace verification: legacy direct entry and optional manager suggestion.');
  const canonical = await page.evaluate(async () => ({
    profile: await (await fetch('/api/organization')).json(),
    structure: await (await fetch('/api/organization/units')).json(),
    setup: await (await fetch('/api/setup')).json(),
  }));
  const legacy = {
    ...canonical.setup,
    requirementVersion: 1,
    requirements: canonical.setup.requirements.filter((item) => item.id !== 'first_unit'),
    completion: { ...canonical.setup.completion, requirementVersion: 1 },
  };
  const rootOnly = {
    ...canonical.structure,
    units: canonical.structure.units.filter((unit) => unit.type === 'organization'),
  };
  const routes = [
    ['/api/organization', canonical.profile],
    ['/api/organization/units', rootOnly],
    ['/api/setup', legacy],
  ];
  let writes = 0;
  const observeWrite = (request) => {
    if (
      /^\/api\/(organization|setup)(\/|$)/.test(new URL(request.url()).pathname) &&
      request.method() !== 'GET'
    )
      writes++;
  };
  page.on('request', observeWrite);
  const handlers = [];
  try {
    for (const [path, body] of routes) {
      const handler = (route) =>
        route.request().method() === 'GET' ? route.fulfill({ json: body }) : route.continue();
      handlers.push([path, handler]);
      await page.route(`**${path}`, handler);
    }
    await page.goto(origin);
    await home();
    await heading('Add your first site or department');
    assert.equal(await page.locator('.entry-layout').count(), 0);
    await page.getByRole('link', { name: 'Add an optional unit', exact: true }).click();
    await heading('Organization structure');
    assert.equal(await page.getByRole('button', { name: 'Finish setup', exact: true }).count(), 0);
    assert.equal(writes, 0, 'Legacy entry and Settings navigation must not mutate activation');
  } finally {
    for (const [path, handler] of handlers) await page.unroute(`**${path}`, handler);
    page.off('request', observeWrite);
  }
  await page.goto(origin);
  await home();
  assert.equal(
    await page.getByRole('heading', { name: 'Add your first site or department' }).count(),
    0,
  );

  console.log('Workspace verification: icon rail, modal focus and cancelled/accepted navigation.');
  await page.evaluate(() => {
    window.workspaceChromeProbe = {
      header: document.querySelector('.workspace-header'),
      navigation: document.querySelector('[aria-label="Workspace navigation"]'),
    };
  });
  const width = () =>
    page.locator('.workspace-sidebar').evaluate((element) => element.getBoundingClientRect().width);
  assert.ok((await width()) >= 224 && (await width()) <= 240);
  const collapse = page.getByRole('button', { name: 'Collapse navigation', exact: true });
  assert.equal(await collapse.getAttribute('aria-expanded'), 'true');
  await page.screenshot({ path: '/tmp/turnstile-rd07-dashboard-desktop.png' });
  await collapse.click();
  assert.ok((await width()) >= 56 && (await width()) <= 64);
  const settings = nav().getByRole('link', { name: 'Settings', exact: true });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  assert.equal(await settings.evaluate((element) => element === document.activeElement), true);
  // Base UI deliberately makes tooltips visual-only; the trigger owns its accessible name.
  await page
    .locator('[data-slot="tooltip-content"]')
    .filter({ hasText: /^Settings$/ })
    .waitFor();
  await settings.press('Enter');
  await heading('Setup overview');
  assert.equal(
    await page.getByRole('button', { name: 'Expand navigation' }).getAttribute('aria-expanded'),
    'false',
  );
  await page
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('link', { name: 'Organization', exact: true })
    .click();
  await heading('Organization');
  await page.getByLabel('Organization name', { exact: true }).fill('Mobile navigation draft');
  await page.setViewportSize({ width: 320, height: 640 });
  const trigger = page.locator('.workspace-mobile-navigation [data-slot="sheet-trigger"]');
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Workspace navigation', exact: true });
  const waitForMenu = async () => {
    await dialog.waitFor();
    await page.waitForFunction(() => {
      const popup = document.querySelector('[data-slot="sheet-content"]');
      return (
        popup &&
        getComputedStyle(popup).opacity === '1' &&
        !popup.hasAttribute('data-starting-style') &&
        popup.contains(document.activeElement)
      );
    });
  };
  await waitForMenu();
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
  for (let index = 0; index < 6; index++) {
    await page.keyboard.press('Tab');
    await page.waitForFunction(
      () => document.querySelector('[data-slot="sheet-content"]')?.contains(document.activeElement),
      undefined,
      { timeout: 2000 },
    );
  }
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await dialog.getByRole('link', { name: 'Home', exact: true }).click();
  assert.equal(await dialog.isVisible(), true);
  assert.equal(
    await page.getByLabel('Organization name', { exact: true }).inputValue(),
    'Mobile navigation draft',
  );
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(
    () => document.activeElement?.textContent?.trim() === 'Open navigation',
  );
  await page.screenshot({ path: '/tmp/turnstile-rd07-settings-mobile.png' });
  await trigger.click();
  await waitForMenu();
  await page.screenshot({ path: '/tmp/turnstile-rd07-navigation-mobile.png' });
  page.once('dialog', (confirmation) => confirmation.accept());
  await dialog.getByRole('link', { name: 'Home', exact: true }).click();
  await home();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === 'Workspace content',
  );
  await trigger.click();
  await waitForMenu();
  await page.setViewportSize({ width: 1280, height: 850 });
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === 'Expand navigation',
  );
  assert.equal(
    await page.evaluate(() => {
      const probe = window.workspaceChromeProbe;
      return (
        probe.header === document.querySelector('.workspace-header') &&
        probe.navigation === document.querySelector('[aria-label="Workspace navigation"]')
      );
    }),
    true,
  );
  await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
  assert.ok((await width()) >= 224);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}
