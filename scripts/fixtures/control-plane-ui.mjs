import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

/** Real deployed handlers, staff sessions and PostgreSQL; no substituted API fixtures. */
export async function verifyControlPlaneUi({ admin, viewer, origin, reauthenticateAdmin }) {
  await reauthenticateAdmin();
  const browser = await chromium.launch({
    headless: true,
    args: ['--host-resolver-rules=MAP central.fixture.test 127.0.0.1'],
  });
  const captures = await mkdtemp(join(tmpdir(), 'thaarei-control-plane-ui-'));
  const errors = [];
  async function contextFor(actor) {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 1000 },
    });
    if (actor)
      await context.addCookies(
        [...actor.jar].map(([name, value]) => ({
          name,
          value,
          url: origin,
          secure: true,
          httpOnly: true,
        })),
      );
    return context;
  }
  async function loseCommittedResponse(page, path) {
    await page.route(
      `**${path}`,
      async (route) => {
        // route.fetch runs in Node, outside Chromium's fixture DNS mapping.
        const target = new URL(route.request().url());
        const host = target.host;
        if (target.hostname === 'central.fixture.test') target.hostname = '127.0.0.1';
        const response = await route.fetch({
          url: target.href,
          headers: { ...route.request().headers(), host },
        });
        assert.ok(response.ok(), 'The production handler committed before transport response loss');
        await route.abort('failed');
      },
      { times: 1 },
    );
  }
  try {
    const context = await contextFor(admin);
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/`);
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Every installation. One clear view.' }),
    ).toBeVisible();
    await page.screenshot({ path: join(captures, 'overview.png'), fullPage: true });
    await page.goto(`${origin}/clients`);
    await page.getByRole('link', { name: 'Register client', exact: true }).click();
    const registration = page.locator('#register-client');
    await page.screenshot({ path: join(captures, 'client-directory.png'), fullPage: true });
    const code = `UX_${randomUUID().slice(0, 8)}`;
    await registration.getByLabel('Client code', { exact: true }).fill(code);
    await registration.getByLabel('Client name', { exact: true }).fill('Atlas Field Services');
    await registration
      .getByLabel('Contact name (optional)', { exact: true })
      .fill('Installation team');
    await registration.getByLabel('Reason', { exact: true }).fill('Disposable UI qualification');
    await loseCommittedResponse(page, '/api/registry');
    await registration.getByRole('button', { name: 'Register client', exact: true }).click();
    await expect(registration.getByRole('button', { name: 'Retry saved request' })).toBeEnabled();
    const committed = (await admin.call(`/api/registry/clients?q=${code}`)).json();
    assert.equal(committed.clients.length, 1);
    const id = committed.clients[0].id;
    await registration.getByRole('button', { name: 'Retry saved request' }).click();
    await page.waitForURL(`${origin}/clients/${id}`);
    await expect(
      page.getByRole('heading', { name: 'Prepare the first installation' }),
    ).toBeVisible();
    await page.screenshot({ path: join(captures, 'client-empty.png'), fullPage: true });
    await page.getByRole('link', { name: 'Start installation' }).click();
    const fresh = page.locator('#fresh-installation');
    await fresh.getByLabel('Environment code').fill('production');
    await fresh.getByLabel('Installation label').fill('Primary installation');
    await fresh.getByLabel('Reason', { exact: true }).fill('Review permanent fresh identities');
    await fresh.getByRole('button', { name: 'Review fresh reservation' }).click();
    const review = page.getByRole('region', { name: 'Review registry change' });
    await expect(review).toContainText('Primary installation');
    await expect(review).toContainText('both pending approval');
    await page.screenshot({ path: join(captures, 'installation-review.png'), fullPage: true });
    assert.equal(
      (await admin.call(`/api/registry/clients/${id}`)).json().installations.length,
      0,
      'Review does not reserve an installation',
    );
    await review.getByRole('button', { name: 'Confirm change' }).click();
    await expect(page.locator('.product-card')).toHaveCount(2);
    const detail = (await admin.call(`/api/registry/clients/${id}`)).json();
    assert.equal(detail.installations.length, 1);
    assert.equal(detail.products.length, 2);
    assert.ok(
      detail.products.every((p) => p.policyState === 'pending' && p.pairingVerifiedAt === null),
    );
    const dms = detail.products.find((p) => p.product === 'dms');
    const product = page.locator(`#product-${dms.id}`);
    await product.getByText('Connect product · Pairing file', { exact: true }).click();
    const pairing = page.locator(`#pairing-${dms.id}`);
    await pairing.getByLabel('Action', { exact: true }).selectOption('revoke');
    await expect(pairing.getByLabel('Pairing ID (for unused code revocation)')).toBeVisible();
    await pairing.getByLabel('Action', { exact: true }).selectOption('issue');
    await expect(pairing.getByLabel('Pairing ID (for unused code revocation)')).toHaveCount(0);
    await pairing
      .getByLabel('Reason', { exact: true })
      .fill('UI lost pairing response qualification');
    await pairing.getByRole('button', { name: 'Review and confirm' }).click();
    await expect(pairing.getByRole('region', { name: 'Review pairing change' })).toBeVisible();
    await page.screenshot({ path: join(captures, 'pairing-review.png'), fullPage: true });
    await loseCommittedResponse(page, '/api/pairing');
    await pairing.getByRole('button', { name: 'Confirm pairing change' }).click();
    await expect(
      pairing.getByRole('button', { name: 'Retry same request', exact: true }),
    ).toBeEnabled();
    const pairingSaved = (await admin.call(`/api/registry/clients/${id}`)).json();
    const pairingRevision = pairingSaved.products.find((p) => p.id === dms.id).revision;
    await pairing.getByRole('button', { name: 'Retry same request', exact: true }).click();
    await expect(
      pairing.getByRole('button', { name: 'Download pairing file again' }),
    ).toBeVisible();
    assert.equal(
      (await admin.call(`/api/registry/clients/${id}`)).json().products.find((p) => p.id === dms.id)
        .revision,
      pairingRevision,
      'Lost-response retry reuses the committed pairing operation',
    );
    // Captures contain synthetic client metadata only; no auth/setup/recovery/pairing values.
    await page.goto(`${origin}/clients/${id}`);
    await page.screenshot({ path: join(captures, 'client-installation.png'), fullPage: true });
    await page.getByRole('link', { name: 'Modules and dependencies' }).click();
    await page.getByText('View the full setup workflow', { exact: true }).click();
    await expect(page.getByRole('region', { name: 'Module setup workflow' })).toBeVisible();
    await page.getByText('View the full setup workflow', { exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Choose the modules to install' }),
    ).toBeVisible();
    await page.screenshot({ path: join(captures, 'module-setup.png'), fullPage: true });
    for (const [path, name] of [
      ['/modules', 'catalogues'],
      [`/reports?clientId=${id}`, 'reports'],
      ['/staff', 'staff'],
      ['/account', 'account'],
      [`/reports/${dms.id}`, 'report-history'],
    ]) {
      await page.goto(`${origin}${path}`);
      await expect(page.getByRole('main')).toBeVisible();
      await page.screenshot({ path: join(captures, `${name}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/clients/${id}`);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await page.getByRole('button', { name: 'Close navigation' }).click();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden();
    await page.getByRole('button', { name: 'Open navigation' }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link').first(),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden();
    await page.screenshot({ path: join(captures, 'client-mobile.png'), fullPage: true });
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll('main *')]
        .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
        .slice(0, 8)
        .map((e) => ({
          tag: e.tagName,
          className: e.className,
          right: e.getBoundingClientRect().right,
        })),
    );
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `Client layout fits a narrow viewport: ${JSON.stringify(overflow)}`,
    );
    await page.goto(
      `${origin}/clients/${id}/products/${detail.products.find((p) => p.product === 'turnstile').id}/modules`,
    );
    await page.getByText('Explore module dependencies', { exact: true }).click();
    await expect(page.getByRole('img', { name: /Module dependencies/ })).toBeVisible();
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'Dependency graph scrolls within its container',
    );
    for (const path of [
      '/modules',
      `/reports?clientId=${id}`,
      '/staff',
      '/account',
      `/reports/${dms.id}`,
      '/access',
    ]) {
      await page.goto(`${origin}${path}`);
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `Narrow layout stays within the viewport: ${path}`,
      );
    }

    const readonlyContext = await contextFor(viewer);
    const readonly = await readonlyContext.newPage();
    await readonly.goto(`${origin}/clients/${id}`);
    await expect(readonly.getByText(/Viewer access · You can inspect/)).toBeVisible();
    await expect(readonly.getByRole('button', { name: 'Review fresh reservation' })).toHaveCount(0);
    await expect(readonly.getByRole('link', { name: 'Staff access', exact: true })).toHaveCount(0);
    await readonly.goto(`${origin}/staff`);
    await expect(
      readonly.getByRole('heading', { name: 'Administrator access required' }),
    ).toBeVisible();
    const publicContext = await contextFor(null);
    const access = await publicContext.newPage();
    await access.goto(`${origin}/access`);
    await expect(access.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(access.getByRole('button', { name: 'Use a recovery code' })).toHaveCount(0);
    await access.screenshot({ path: join(captures, 'sign-in.png'), fullPage: true });
    await access.getByRole('button', { name: 'Forgot password?' }).click();
    await expect(access.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await expect(access.getByLabel('Password', { exact: true })).toHaveCount(0);
    await access.goto(`${origin}/access?flow=reset&error=INVALID_TOKEN`);
    await expect(access.getByRole('status')).toContainText(/invalid|expired/i);
    assert.deepEqual(errors, [], 'No application runtime errors during the UI journeys');
  } finally {
    await browser.close();
  }
  console.log(
    `Control-plane UI HTTPS/PostgreSQL/browser: navigation, fresh reservation review, real committed-response loss for registration and pairing, conditional fields, Viewer/Admin boundaries, recovery and 390px layouts passed. Nonsecret screenshots: ${captures}`,
  );
}
