// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: Private local operator only; no credential enters argv/logs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { releasePrivateFiles } from './rehearse-local-onboarding-upgrade.mjs';
import {
  replacementCredentials,
  retireDatabaseCredentials,
  roleConnections,
} from './user-management-credentials.mjs';

let stage = 'preflight';
try {
  const [directory, ...extra] = process.argv.slice(2);
  assert.ok(directory && isAbsolute(directory) && !extra.length);
  const parent = relative(realpathSync('.'), realpathSync(dirname(directory)));
  assert.ok(
    parent === '..' || parent.startsWith('../') || isAbsolute(parent),
    'Private operator output must be outside the checkout',
  );
  assert.equal(statSync(dirname(directory)).mode & 0o077, 0);
  const originals = releasePrivateFiles.map(([path, name]) => {
    assert.equal(statSync(path).mode & 0o077, 0);
    return { path, name, text: readFileSync(path, 'utf8') };
  });
  const environment = {
    ...process.env,
    ...Object.assign({}, ...originals.map((file) => parseEnv(file.text))),
  };
  assert.equal(environment.AUTH_PROFILE, 'local');
  assert.equal(environment.AUTH_PUBLIC_ORIGIN, 'http://localhost:23600');
  const database = new URL(environment.PROVISION_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(database.hostname) && database.port === '23603');
  for (const service of ['dms-api', 'turnstile-api', 'turnstile-web']) {
    const result = spawnSync('docker', ['compose', 'ps', '--all', '--format', 'json', service], {
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.equal(result.status, 0);
    assert.equal(
      JSON.parse(result.stdout.trim()).State,
      'exited',
      'Stop all application processes before retiring credentials',
    );
  }
  const replacement = replacementCredentials(environment);
  mkdirSync(directory, { mode: 0o700 });
  for (const file of originals) {
    writeFileSync(resolve(directory, `previous-${file.name}`), file.text, {
      mode: 0o600,
      flag: 'wx',
    });
    let next = file.text;
    for (const { key } of roleConnections)
      if (Object.hasOwn(parseEnv(file.text), key)) {
        const pattern = new RegExp(String.raw`^(\s*(?:export\s+)?${key}\s*=).*$`, 'm');
        assert.ok(pattern.test(next), 'An explicit single-line private connection is required');
        next = next.replace(pattern, (_match, prefix) => `${prefix}${replacement[key]}`);
      }
    const parsed = parseEnv(next);
    for (const { key } of roleConnections)
      if (Object.hasOwn(parseEnv(file.text), key))
        assert.equal(
          parsed[key],
          replacement[key],
          'Replacement credential must be installed exactly',
        );
    for (const [key, value] of Object.entries(parseEnv(file.text)))
      if (!roleConnections.some((entry) => entry.key === key))
        assert.equal(parsed[key], value, 'Unrelated secrets/configuration must be unchanged');
    file.next = next;
    writeFileSync(resolve(directory, `replacement-${file.name}`), next, {
      mode: 0o600,
      flag: 'wx',
    });
  }
  stage = 'database-rotation';
  const result = await retireDatabaseCredentials(environment, replacement);
  stage = 'private-file-install';
  for (const file of originals) {
    assert.equal(
      readFileSync(file.path, 'utf8'),
      file.text,
      'Private files changed during retirement',
    );
    const temporary = `${file.path}.um-release-next`;
    writeFileSync(temporary, file.next, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, file.path);
  }
  writeFileSync(
    resolve(directory, 'retirement-proof.json'),
    `${JSON.stringify({ version: 1, ...result }, null, 2)}\n`,
    { mode: 0o600, flag: 'wx' },
  );
  console.log(
    'Six dedicated role credentials retired and existing connections terminated; replacement private configuration installed. Services remain stopped.',
  );
} catch {
  console.error(
    `Local credential retirement failed (${stage}); keep all services stopped. Reconcile the protected previous/replacement files before any retry.`,
  );
  process.exitCode = 1;
}
