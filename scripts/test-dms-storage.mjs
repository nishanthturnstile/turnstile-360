import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { env, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, `${command} failed: ${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}
run('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@thaarei/dms-api']);
const { seaweedIdentityConfiguration, configureStorage } = await import(
  '../apps/dms-api/dist/modules/storage/storage-provision.js'
);
const { STORAGE_ROLES } = await import(
  '../apps/dms-api/dist/modules/storage/storage-configuration.js'
);
const image = parse(readFileSync('deploy/compose.local.yaml', 'utf8')).services.seaweedfs.image;
const name = `thaarei-storage-test-${randomBytes(6).toString('hex')}`;
const folder = mkdtempSync(join(tmpdir(), 'thaarei-storage-'));
const env = {
  ...process.env,
  DMS_STORAGE_ENDPOINT: 'http://127.0.0.1:1',
  DMS_STORAGE_PUBLIC_ORIGIN: 'http://127.0.0.1:1',
  DMS_STORAGE_REGION: 'us-east-1',
  DMS_STORAGE_PATH_STYLE: 'true',
  DMS_STORAGE_ALLOW_HTTP: 'true',
  DMS_STORAGE_STAGING_BUCKET: 'dms-staging',
  DMS_STORAGE_ORIGINALS_BUCKET: 'dms-originals',
  DMS_STORAGE_ARTIFACTS_BUCKET: 'dms-artifacts',
  DMS_STORAGE_BROWSER_ORIGINS: '["http://127.0.0.1:1"]',
  INSTALLATION_TENANT_ID: randomUUID(),
};
for (const role of [...STORAGE_ROLES, 'bootstrap']) {
  const prefix = `DMS_STORAGE_${role.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;
  env[`${prefix}_ACCESS_KEY_ID`] = randomBytes(12).toString('hex');
  env[`${prefix}_SECRET_ACCESS_KEY`] = randomBytes(36).toString('base64url');
}
let created = false;
try {
  const config = join(folder, 'identities.json');
  writeFileSync(config, JSON.stringify(seaweedIdentityConfiguration(env)), { mode: 0o600 });
  run('docker', [
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '--mount',
    `type=bind,src=${config},dst=/run/secrets/storage-identities.json,readonly`,
    '--mount',
    `type=bind,src=${resolve('deploy/storage/seaweed-entrypoint.sh')},dst=/run/dms-seaweed.sh,readonly`,
    '-p',
    '127.0.0.1::8333',
    '--entrypoint',
    '/bin/sh',
    image,
    '/run/dms-seaweed.sh',
  ]);
  created = true;
  const port = run('docker', [
    'inspect',
    '--format',
    '{{(index (index .NetworkSettings.Ports "8333/tcp") 0).HostPort}}',
    name,
  ]);
  env.DMS_STORAGE_ENDPOINT = `http://127.0.0.1:${port}`;
  env.DMS_STORAGE_TEST_CONTAINER = name;
  env.DMS_STORAGE_TEST_DIRECTORY = folder;
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      await configureStorage(env);
      ready = true;
      break;
    } catch {
      await setTimeout(500);
    }
  }
  if (!ready) {
    console.error(run('docker', ['logs', name]).replace(/(accessKey|secretKey).*/gi, '[redacted]'));
    throw new Error('Storage fixture unavailable');
  }
  run(
    'pnpm',
    [
      '--filter',
      '@thaarei/dms-api',
      'exec',
      'vitest',
      'run',
      '--config',
      'vitest.config.storage.ts',
    ],
    env,
  );
  console.log(
    'Pinned SeaweedFS: authenticated storage and browser/Node/Python transfer boundary verified.',
  );
} finally {
  if (created) run('docker', ['rm', '--force', name]);
  rmSync(folder, { recursive: true, force: true });
}
