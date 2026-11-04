import assert from 'node:assert/strict';

// Completed-workspace structure mutations are exercised by the owning People suite.
// Onboarding keeps its independent configuration editor and browser suite.
export async function testSettings({ page, origin, login, setAccess, clearRateLimits }) {
  try {
    const heading = (name) => page.getByRole('heading', { name, exact: true }).waitFor();
    await login('reset');
    await heading('Welcome, reset.');
    let reads = 0;
    const observe = (request) => {
      if (
        request.method() === 'GET' &&
        /^\/api\/(organization(?:\/units)?|setup)$/.test(new URL(request.url()).pathname)
      )
        reads++;
    };
    page.on('request', observe);
    for (const path of ['/settings', '/settings/organization', '/settings/workspace']) {
      await page.goto(`${origin}${path}`);
      await heading('Settings access required');
    }
    page.off('request', observe);
    assert.equal(reads, 0, 'Ordinary members must never fetch company configuration');
    await login('member');
    await heading('Welcome, member.');
    await clearRateLimits();
    await page.goto(`${origin}/settings`);
    await heading('Setup overview');
    const before = await page.evaluate(async () => ({
      profile: await (await fetch('/api/organization')).json(),
      setup: await (await fetch('/api/setup')).json(),
    }));
    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('link', { name: 'General settings', exact: true })
      .click();
    await heading('General settings');
    await page.getByLabel('Organization name', { exact: true }).fill('Consolidated settings');
    await page.getByLabel('Time zone', { exact: true }).selectOption('Europe/London');
    page.once('dialog', (d) => void d.dismiss());
    await page
      .getByRole('navigation', { name: 'Workspace navigation' })
      .getByRole('link', { name: 'Home', exact: true })
      .click();
    assert.equal(
      await page.getByLabel('Organization name', { exact: true }).inputValue(),
      'Consolidated settings',
    );
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByText('General settings saved.', { exact: true }).waitFor();
    await page.reload();
    await heading('General settings');
    assert.equal(
      await page.getByLabel('Organization name', { exact: true }).inputValue(),
      'Consolidated settings',
    );
    assert.equal(await page.getByLabel('Time zone', { exact: true }).inputValue(), 'Europe/London');
    await page.goto(`${origin}/settings/workspace`);
    await heading('General settings');
    assert.equal(new URL(page.url()).pathname, '/settings/organization');
    await page.goto(`${origin}/settings/organization/structure`);
    await heading('Structure');
    assert.equal(new URL(page.url()).pathname, '/structure');
    await page.goto(`${origin}/settings`);
    await heading('Setup overview');
    const after = await page.evaluate(async () => ({
      profile: await (await fetch('/api/organization')).json(),
      setup: await (await fetch('/api/setup')).json(),
    }));
    assert.equal(after.profile.organization.rootId, before.profile.organization.rootId);
    assert.deepEqual(after.setup.completion, before.setup.completion);
    await page.setViewportSize({ width: 320, height: 760 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.setViewportSize({ width: 1280, height: 850 });
    // Preserve the last effective configuration manager while exercising revocation.
    await setAccess('reset', [
      'turnstile:access',
      'turnstile:dms:capabilities:read',
      'turnstile:configuration:manage',
    ]);
    await setAccess('member', ['turnstile:access', 'turnstile:dms:capabilities:read']);
    await page.goto(`${origin}/settings/organization`);
    await heading('Settings access required');
    assert.equal(await page.getByLabel('Organization name', { exact: true }).count(), 0);
    await setAccess('member', [
      'turnstile:access',
      'turnstile:dms:capabilities:read',
      'turnstile:configuration:manage',
    ]);
    await page.getByRole('button', { name: 'Check access', exact: true }).click();
    await heading('General settings');
    await setAccess('reset', ['turnstile:access', 'turnstile:dms:capabilities:read']);
    await page
      .getByRole('navigation', { name: 'Workspace navigation' })
      .getByRole('link', { name: 'Home', exact: true })
      .click();
    await heading('Welcome, member.');
    console.log(
      'Settings browser: combined profile/zone persistence, dirty navigation, route aliases, unchanged activation/root, live authorization and narrow layout passed.',
    );
  } catch (error) {
    console.error(
      'Settings callsite:',
      error instanceof Error
        ? error.stack?.match(/test-settings-browser\.mjs:\d+:\d+/)?.[0]
        : 'unknown',
    );
    throw error;
  }
}
