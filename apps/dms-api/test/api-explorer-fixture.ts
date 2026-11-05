import { chromium, expect } from '@playwright/test';

export async function verifyExplorer(
  origin: string,
  accessKey: string,
  token: string,
  transport?: (
    path: string,
    headers: Record<string, string>,
  ) => Promise<{ status: number; headers: Record<string, string>; body: string }>,
) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      httpCredentials: { username: 'operator', password: accessKey },
    });
    if (transport)
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) {
          await route.abort();
          return;
        }
        const headers = { ...route.request().headers() };
        if (url.pathname.startsWith('/docs'))
          headers.authorization = `Basic ${Buffer.from(`operator:${accessKey}`).toString('base64')}`;
        const response = await transport(url.pathname + url.search, headers);
        await route.fulfill({
          status: response.status,
          headers: response.headers,
          body: Buffer.from(response.body, 'base64'),
        });
      });
    if (transport) {
      const headers = {
        authorization: `Basic ${Buffer.from(`operator:${accessKey}`).toString('base64')}`,
      };
      for (const path of ['/docs/index.html', '/docs/static/', '/docs/static/index.html']) {
        const response = await transport(path, headers);
        if (response.status !== 302 || response.headers.location !== '/docs/')
          throw new Error('Packaged stock entry was not canonicalized');
      }
      const stock = await transport('/docs/swagger-initializer.js', headers);
      if (stock.status !== 404 || Buffer.from(stock.body, 'base64').toString().includes('petstore'))
        throw new Error('Packaged stock initializer is reachable');
    }
    const page = await context.newPage();
    page.setDefaultTimeout(transport ? 15000 : 5000);
    const outside: string[] = [];
    const requests: { path: string; authorization: string }[] = [];
    const errors: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== origin) outside.push(url.origin);
      if (url.pathname === '/v1/capabilities')
        requests.push({ path: url.pathname, authorization: request.headers().authorization ?? '' });
    });
    page.on('pageerror', (error) => errors.push(error.message));
    const navigation = await page.goto(
      `${origin}/docs/${transport ? '' : 'index.html?url=https://untrusted.invalid/schema.json'}`,
      { timeout: 45000 },
    );
    if (!transport && page.url() !== `${origin}/docs/`)
      throw new Error('Stock entry did not land on hardened UI');
    if (navigation?.status() !== 200)
      throw new Error(`Explorer navigation status ${navigation?.status()}`);
    await page
      .getByText('Thaarei DMS consumer API', { exact: false })
      .first()
      .waitFor({ timeout: 5000 })
      .catch(async () => {
        throw new Error(
          `Explorer initialization failed: ${errors.join('; ')}; ${((await page.locator('body').textContent()) ?? '').slice(0, 200)}`,
        );
      });
    await expect(
      page.getByText('Thaarei DMS consumer API', { exact: false }).first(),
    ).toBeVisible();
    await page
      .getByRole('button', { name: /authorize/i })
      .first()
      .click();
    await expect(page.locator('.dialog-ux')).toBeVisible();
    await expect(
      page.locator('.dialog-ux').getByText('EnrollmentKey', { exact: false }),
    ).toHaveCount(0);
    await page.locator('.dialog-ux input').fill(token);
    await page
      .locator('.dialog-ux')
      .getByRole('button', { name: /apply credentials|^authorize$/i })
      .click();
    await page.locator('.dialog-ux').getByRole('button', { name: /close/i }).last().click();
    const capabilities = page.locator('#operations-default-getDmsCapabilities');
    await capabilities.locator('.opblock-summary').click();
    await capabilities.getByRole('button', { name: 'Try it out' }).click();
    await capabilities.getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(
      capabilities.locator('.live-responses-table tbody .response-col_status').first(),
    ).toHaveText('200');
    const enrollment = page.locator('#operations-default-enrollDmsApplication');
    await enrollment.locator('.opblock-summary').click();
    await expect(enrollment.getByRole('button', { name: 'Try it out' })).toHaveCount(0);
    if (!requests.some((request) => request.authorization === `Bearer ${token}`))
      throw new Error('Explorer did not send the supplied machine bearer');
    requests.length = 0;
    await page.reload();
    await expect(
      page.getByText('Thaarei DMS consumer API', { exact: false }).first(),
    ).toBeVisible();
    await page.locator('#operations-default-getDmsCapabilities .opblock-summary').click();
    const fresh = page.locator('#operations-default-getDmsCapabilities');
    await fresh.getByRole('button', { name: 'Try it out' }).click();
    await fresh.getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(
      fresh.locator('.live-responses-table tbody .response-col_status').first(),
    ).toHaveText('401');
    if (requests.some((request) => request.authorization.startsWith('Bearer ')))
      throw new Error('Explorer retained authorization after reload');
    if (outside.length || errors.length)
      throw new Error('Explorer loaded an external resource or failed to initialize');
    if (
      (await page.evaluate(
        () => Object.keys(localStorage).length + Object.keys(sessionStorage).length,
      )) !== 0
    )
      throw new Error('Explorer persisted browser storage');
  } finally {
    await browser.close();
  }
}
