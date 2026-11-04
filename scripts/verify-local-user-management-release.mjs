// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: Explicit private local verifier; credentials stay in memory/stdin.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { readCandidateInventory } from './user-management-release-inventory.mjs';

try {
  const [candidatePath, output, ...extra] = process.argv.slice(2);
  assert.ok(candidatePath && output && !extra.length);
  const candidate = readCandidateInventory(candidatePath);
  const environment = { ...process.env };
  for (const path of ['apps/turnstile-api/.env', 'apps/turnstile-api/.env.migrate']) {
    assert.equal(statSync(path).mode & 0o077, 0, 'Private local product configuration required');
    Object.assign(environment, parseEnv(readFileSync(path, 'utf8')));
  }
  assert.equal(environment.AUTH_PROFILE, 'local');
  assert.equal(environment.AUTH_PUBLIC_ORIGIN, 'http://localhost:23600');
  for (const key of ['TURNSTILE_DATABASE_URL', 'TURNSTILE_MIGRATION_DATABASE_URL']) {
    const url = new URL(environment[key]);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '23603');
  }
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    assert.ok(Buffer.byteLength(input) <= 16384);
  }
  const operator = JSON.parse(input);
  const check = spawnSync(
    process.execPath,
    ['apps/turnstile-api/dist/modules/access/release-operator.js', 'verify-login'],
    { env: environment, input, encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(check.status, 0, 'The real current protected administrator login must verify');
  const state = JSON.parse(check.stdout);
  assert.equal(state.ready, true);
  assert.equal(state.administratorVerified, true);
  assert.equal(state.publicWritesEnabled, true);
  assert.equal(state.releaseVersion, 1);
  assert.equal(state.releaseId, candidate.releaseId);
  for (const [service, kind] of [
    ['dms-api', 'authority'],
    ['turnstile-api', 'api'],
    ['turnstile-web', 'web'],
  ]) {
    const running = spawnSync('docker', ['compose', 'ps', '--all', '--format', 'json', service], {
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.equal(running.status, 0);
    const container = JSON.parse(running.stdout.trim());
    assert.equal(container.State, 'running');
    const image = spawnSync('docker', ['inspect', '--format', '{{.Image}}', container.ID], {
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.equal(image.status, 0);
    assert.equal(image.stdout.trim(), candidate.images[kind].id);
  }
  let cookie = operator.administratorCookie;
  const get = async (path) => {
    const response = await fetch(`${environment.AUTH_PUBLIC_ORIGIN}${path}`, {
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: { cookie, accept: 'application/json' },
    });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    let length = 0;
    const chunks = [];
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        assert.ok(length <= 1048576);
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const replacement = response.headers
      .getSetCookie()
      .find((value) => value.startsWith('turnstile='));
    if (replacement) cookie = replacement.split(';')[0];
    return JSON.parse(Buffer.concat(chunks).toString());
  };
  assert.equal((await get('/api/auth/session')).user.id, operator.administratorUserId);
  assert.equal((await get('/api/workspace/status')).status, 'complete');
  for (const path of [
    '/api/people/catalog',
    '/api/people/roles?limit=1',
    '/api/people/members?limit=1',
    '/api/people/invitations?limit=1',
    '/api/structure/units?limit=1',
  ])
    await get(path);
  writeFileSync(
    output,
    `${JSON.stringify({ version: 1, releaseId: candidate.releaseId, exactImages: true, protectedAdministratorLogin: true, publicWritersOpen: true, completedSetupPreserved: true, independentAdministrationAndStructureReads: true }, null, 2)}\n`,
    { mode: 0o600, flag: 'wx' },
  );
  console.log(
    'Selected local user-management release verified: exact authority/API/web images, current protected login, version/epoch readiness, completed workspace and independent owning reads. No account, invitation or grant was created.',
  );
} catch {
  console.error(
    'Selected local user-management release verification failed; inspect the private candidate/configuration and keep incompatible writers stopped.',
  );
  process.exitCode = 1;
}
