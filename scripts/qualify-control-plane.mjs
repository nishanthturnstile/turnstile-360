import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const output = process.argv[2];
assert.ok(
  output && process.argv.length === 3,
  'Pass a new evidence JSON path; this qualifies disposable local fixtures only',
);
const evidence = {
  version: 1,
  scope: 'isolated-local',
  startedAt: new Date().toISOString(),
  source: null,
  images: {},
  checks: [],
  targetAcceptance: 'pending',
  releaseQualified: false,
  remaining: [
    'Actual host DNS/TLS/SMTP/time, existing-installation cutover and operator acceptance',
  ],
};
async function run(command, args, env = process.env) {
  return (await exec(command, args, { env, maxBuffer: 16 * 1024 * 1024, timeout: 1800000 })).stdout;
}
async function check(name, command, args, env) {
  const start = Date.now();
  await run(command, args, env);
  evidence.checks.push({
    name,
    status: 'passed',
    seconds: Math.round((Date.now() - start) / 1000),
  });
  console.log(`${name}: passed`);
}
// Fingerprint production directories and workspace configuration, excluding tests and private env files.
const files = (await run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z']))
  .split('\0')
  .filter(
    (p) =>
      p &&
      (/^(apps|packages|tooling|deploy)\//.test(p) ||
        [
          'package.json',
          'pnpm-lock.yaml',
          'pnpm-workspace.yaml',
          'turbo.json',
          'LICENSE',
          'THIRD_PARTY_NOTICES',
          '.dockerignore',
        ].includes(p)),
  )
  .filter(
    (p) =>
      !/(^|\/)(test|tests|dist|node_modules|\.next)\//.test(p) &&
      !/(^|\/)\.env(?!\.example$)/.test(p),
  )
  .sort();
const hash = createHash('sha256');
for (const path of files) {
  hash.update(path);
  hash.update('\0');
  hash.update(await readFile(path));
  hash.update('\0');
}
evidence.source = {
  sha256: hash.digest('hex'),
  files: files.length,
  head: (await run('git', ['rev-parse', 'HEAD'])).trim(),
  dirty: (await run('git', ['status', '--porcelain'])).length > 0,
  scope:
    'production directories and workspace configuration; packaging helpers recorded separately',
};
evidence.packagingHelpers = [];
for (const path of ['scripts/package-control-plane.mjs', 'scripts/provision-auth-database.mjs'])
  evidence.packagingHelpers.push({
    path,
    sha256: createHash('sha256')
      .update(await readFile(path))
      .digest('hex'),
  });
evidence.verificationHelpers = [];
for (const path of (
  await run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
)
  .split('\0')
  .filter((path) =>
    /^(scripts\/.*\.(mjs|py)|(?:apps|packages)\/.*\/(?:test|tests)\/.*\.(ts|mjs|py|json))$/.test(
      path,
    ),
  )
  .sort())
  evidence.verificationHelpers.push({
    path,
    sha256: createHash('sha256')
      .update(await readFile(path))
      .digest('hex'),
  });
await writeFile(resolve(output), `${JSON.stringify(evidence, null, 2)}\n`, {
  flag: 'wx',
  mode: 0o600,
});
try {
  for (const gate of ['check', 'build', 'test', 'test:integration'])
    await check(`workspace:${gate}`, 'pnpm', [gate]);
  for (const [name, dockerfile] of [
    ['central', 'apps/thaarei-control-plane/Dockerfile'],
    ['dms', 'apps/dms-api/Dockerfile'],
    ['turnstile', 'apps/turnstile-api/Dockerfile'],
    ['web', 'apps/turnstile-web/Dockerfile'],
  ]) {
    const tag = `thaarei-tcp-i08-${name}:local`;
    await check(`image:${name}:build`, 'docker', [
      'build',
      '--label',
      `org.thaarei.control-plane.source=${evidence.source.sha256}`,
      '-f',
      dockerfile,
      '-t',
      tag,
      '.',
    ]);
    const image = JSON.parse(await run('docker', ['image', 'inspect', tag]))[0];
    assert.ok(
      image.Config.User && image.Config.User !== 'root' && image.Config.User !== '0',
      'Nonroot image required',
    );
    assert.ok(
      !image.Config.Env.some((v) =>
        /^(?:.*DATABASE_URL|.*CLIENT_SECRET|AUTH_SECRET|.*ENCRYPTION_KEY)=/.test(v),
      ),
      'Image must not embed service credentials',
    );
    evidence.images[name] = {
      id: image.Id,
      tag,
      source: evidence.source.sha256,
      os: image.Os,
      architecture: image.Architecture,
      user: image.Config.User,
    };
  }
  await check(
    'container-images:two-customers-reporters-key-recovery-restores',
    'node',
    ['scripts/test-control-plane.mjs'],
    {
      ...process.env,
      CONTROL_PLANE_QUALIFY_TWO_CLIENTS: 'true',
      CONTROL_PLANE_QUALIFY_CONTAINERS: 'true',
      TURNSTILE_CONTROL_TEST_IMAGE: evidence.images.turnstile.id,
      CONTROL_PLANE_TEST_IMAGE: evidence.images.central.id,
      DMS_CONTROL_TEST_IMAGE: evidence.images.dms.id,
    },
  );
  for (const journey of ['auth', 'people'])
    await check(
      `candidate-images:browser:${journey}`,
      'node',
      [
        'scripts/test-auth-database.mjs',
        '--browser',
        ...(journey === 'people' ? ['--people-ui'] : []),
      ],
      {
        ...process.env,
        AUTH_BROWSER_FULL_IMAGES: 'true',
        AUTH_BROWSER_API_IMAGE: evidence.images.turnstile.id,
        AUTH_BROWSER_DMS_IMAGE: evidence.images.dms.id,
        AUTH_BROWSER_WEB_IMAGE: evidence.images.web.id,
      },
    );
  evidence.coverage = {
    central:
      'candidate image through container TLS ingress, production profile and verified STARTTLS',
    isolation:
      'two separately networked customer PostgreSQL clusters and independent registrations',
    reporters:
      'shipped DMS coordinator and Turnstile reporter entrypoints, real container HTTPS and owning SQL',
    dmsRecovery:
      'candidate API HTTP: real central rollover, offline compromised-key revocation, rebind/reapproval and full database/journal restore',
    turnstileRecovery:
      'owning PostgreSQL and production preflight restore/rebind; candidate API HTTP trust rollover/revocation in the browser fixture',
    browser:
      'DMS authority, Turnstile API and Nginx candidate images, canonical container DNS/TLS, real SMTP, auth and People/deployment journeys; fixture provisioning uses separate owning processes',
    rollback:
      'owning schema upgrade tests, quarantined database/journal restores and candidate restart; no prior published enforcing release exists for a historical image downgrade',
  };
  const finalHash = createHash('sha256');
  for (const path of files) {
    finalHash.update(path);
    finalHash.update('\0');
    finalHash.update(await readFile(path));
    finalHash.update('\0');
  }
  assert.equal(
    finalHash.digest('hex'),
    evidence.source.sha256,
    'Production inputs changed during qualification',
  );
  for (const helper of [...evidence.packagingHelpers, ...evidence.verificationHelpers])
    assert.equal(
      createHash('sha256')
        .update(await readFile(helper.path))
        .digest('hex'),
      helper.sha256,
      'Qualification helper changed during execution',
    );
  evidence.inputsStable = true;
  evidence.localQualification = 'passed';
  evidence.localChecksResult = 'passed';
} catch (error) {
  evidence.localChecksResult = 'failed';
  throw new Error(
    'Local qualification failed; inspect the last named check and rerun after correction',
    { cause: error },
  );
} finally {
  evidence.finishedAt = new Date().toISOString();
  await writeFile(resolve(output), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
}
