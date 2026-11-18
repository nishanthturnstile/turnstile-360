import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

export async function verifyLogPrivacy(run, apiContainer) {
  const marker = randomBytes(32).toString('hex');
  const probe = `
    const marker = ${JSON.stringify(marker)};
    const origin = process.env.AUTH_PUBLIC_ORIGIN;
    const response = await fetch(origin + '/identity/sign-in/email?log-proof=' + marker, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ email: 'nobody@dms.test', password: marker })
    });
    if (![400, 401, 403].includes(response.status) || (await response.text()).includes(marker))
      throw new Error('Production authentication failure projection failed');
    console.log('Production authentication failure completed');
  `;
  await run('docker', ['exec', '-i', apiContainer, 'node', '--input-type=module', '-'], {
    input: probe,
  });
  const logs = await run('docker', ['logs', '--since', '10m', apiContainer]);
  assert.ok(
    !logs.stdout.includes(marker) && !logs.stderr.includes(marker),
    'Production request/error logging disclosed the credential/query marker',
  );
}
