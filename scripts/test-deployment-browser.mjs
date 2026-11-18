import assert from 'node:assert/strict';
import { fixturePolicy } from './fixtures/deployment-policy.mjs';
export async function testDeployment({ page, context, login, origin }) {
  const turnstile = await fixturePolicy('turnstile'),
    dms = await fixturePolicy('dms');
  try {
    await context.clearCookies();
    await login('member');
    await page.getByRole('heading', { name: 'Welcome, member.', exact: true }).waitFor();
    const get = async (path) =>
      page.evaluate(async (path) => {
        const r = await fetch(path);
        return { status: r.status, body: await r.json() };
      }, path);
    await turnstile.set('pending', { fresh: true });
    await page.reload();
    await page
      .getByRole('heading', { name: 'Installation activation required', exact: true })
      .waitFor();
    assert.equal((await get('/api/auth/session')).status, 200);
    assert.equal((await get('/api/people/members')).body.code, 'DEPLOYMENT_RESTRICTED');
    await turnstile.set('suspended');
    assert.equal(
      (await get('/api/people/members')).status,
      403,
      'Never-approved suspension cannot read',
    );
    await turnstile.set('approved');
    await page.getByRole('button', { name: 'Check activation', exact: true }).click();
    await page.getByRole('heading', { name: 'Welcome, member.', exact: true }).waitFor();
    await turnstile.set('suspended');
    await page.reload();
    await page
      .getByText(
        'Installation restricted: existing authorized reads remain available. Changes require renewed approval.',
        { exact: true },
      )
      .waitFor();
    assert.equal((await get('/api/people/members')).status, 200);
    const denial = await page.evaluate(async () => {
      const s = await (await fetch('/api/auth/session')).json();
      const r = await fetch('/api/people/roles', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': s.csrfToken },
        body: '{}',
      });
      return { status: r.status, body: await r.json() };
    });
    assert.equal(denial.status, 403);
    assert.equal(denial.body.code, 'DEPLOYMENT_RESTRICTED');
    await turnstile.set('approved', { fresh: true, expired: true });
    assert.equal(
      (await get('/api/people/members')).status,
      200,
      'Expired applied approval retains qualified reads',
    );
    await turnstile.set('approved');
    await turnstile.rollover();
    await turnstile.set('approved');
    assert.equal(
      (await get('/api/people/members')).status,
      200,
      'Staged new signing key preserves HTTP access',
    );
    await turnstile.revoke();
    assert.equal(
      (await get('/api/people/members')).status,
      403,
      'Independent trust revocation closes current HTTP reads',
    );
    assert.equal(
      (await get('/api/auth/session')).status,
      200,
      'Trust revocation preserves local recovery identity',
    );
    await turnstile.rollover();
    await turnstile.set('approved', { fresh: true });
    assert.equal(
      (await get('/api/people/members')).status,
      200,
      'Fresh fixture-owned epoch and trusted approval recover HTTP access',
    );
    const proof = turnstile.proof();
    const anonymous = await page.evaluate(async (proof) => {
      const response = await fetch('/api/auth/session', {
        credentials: 'omit',
        headers: { authorization: `Bearer ${proof}` },
      });
      return response.status;
    }, proof);
    assert.equal(anonymous, 401, 'A signed central decision cannot create a customer session');
    const safeStatus = await get('/api/deployment/status');
    assert.deepEqual(Object.keys(safeStatus.body).sort(), ['access', 'state']);
    const stored = await page.evaluate(() =>
      JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
    );
    assert.ok(!stored.includes(proof), 'Central decisions do not belong in browser storage');
    await dms.set('pending', { fresh: true });
    const capabilities = await get('/api/dms/capabilities');
    assert.equal(capabilities.status, 200);
    assert.equal(capabilities.body.deploymentAccess, 'closed');
    await dms.set('approved');
    await page.reload();
    await page.getByRole('heading', { name: 'Welcome, member.', exact: true }).waitFor();
    assert.ok(new URL(page.url()).origin === origin);
    console.log(
      'TCP-I06 browser: pending/suspension before activation, activation/retry, qualified restricted/expired reads, write denial, independent DMS restriction and preserved local session passed. Existing People journey exercised real private identity setup/acceptance/projections.',
    );
  } finally {
    await turnstile.restore();
    await dms.restore();
  }
}
