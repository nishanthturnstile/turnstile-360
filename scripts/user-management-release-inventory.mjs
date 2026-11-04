import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !entry.name.endsWith('.tsbuildinfo'))
    .flatMap((entry) =>
      entry.isDirectory()
        ? filesBelow(join(directory, entry.name))
        : [
            {
              path: join(directory, entry.name),
              sha256: sha256(readFileSync(join(directory, entry.name))),
            },
          ],
    )
    .sort((a, b) => a.path.localeCompare(b.path));
}
export function migrationInventory(directory) {
  const journal = JSON.parse(readFileSync(join(directory, 'meta/_journal.json'), 'utf8'));
  return {
    journal,
    sql: journal.entries.map(({ tag }) => ({
      path: `${tag}.sql`,
      sha256: sha256(readFileSync(join(directory, `${tag}.sql`))),
    })),
  };
}
export function candidateInventory(authority, api, web) {
  const images = {};
  for (const [kind, reference] of Object.entries({ authority, api, web })) {
    assert.ok(typeof reference === 'string' && reference.length > 0 && !reference.startsWith('-'));
    const result = spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', reference], {
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.equal(result.status, 0, 'Build every exact candidate image first');
    const id = result.stdout.trim();
    assert.match(id, /^sha256:[0-9a-f]{64}$/);
    images[kind] = { reference, id };
  }
  const payload = {
    version: 1,
    capabilityVersion: 1,
    images,
    migrations: {
      product: migrationInventory('apps/turnstile-api/database/migrations'),
      authority: migrationInventory('apps/dms-api/database/auth/migrations'),
      dms: migrationInventory('apps/dms-api/database/dms/migrations'),
    },
    compiled: {
      api: filesBelow('apps/turnstile-api/dist'),
      authority: filesBelow('apps/dms-api/dist'),
      web: filesBelow('apps/turnstile-web/dist'),
    },
    packages: Object.fromEntries(
      ['dms-contracts', 'turnstile-contracts', 'dms-client'].map((name) => [
        name,
        filesBelow(`packages/${name}/dist`),
      ]),
    ),
    operations: [
      'scripts/test-user-management-images.mjs',
      'scripts/user-management-release-inventory.mjs',
      'scripts/user-management-credentials.mjs',
      'scripts/backup-local-user-management.mjs',
      'scripts/retire-local-user-management-credentials.mjs',
      'scripts/rehearse-local-user-management.mjs',
      'scripts/verify-local-user-management-release.mjs',
      'scripts/backup-local-onboarding.mjs',
      'scripts/rehearse-local-onboarding-upgrade.mjs',
    ].map((path) => ({ path, sha256: sha256(readFileSync(path)) })),
  };
  return { ...payload, releaseId: sha256(JSON.stringify(payload)) };
}
export function readCandidateInventory(path) {
  assert.equal(statSync(path).mode & 0o077, 0, 'Protected candidate inventory required');
  const { releaseId, ...payload } = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(payload.version, 1);
  assert.equal(payload.capabilityVersion, 1);
  assert.equal(releaseId, sha256(JSON.stringify(payload)), 'Candidate inventory checksum mismatch');
  const current = candidateInventory(
    ...['authority', 'api', 'web'].map((kind) => payload.images[kind].id),
  );
  assert.deepEqual(
    current.migrations,
    payload.migrations,
    'Workspace migrations must match the verified candidate',
  );
  assert.deepEqual(
    current.compiled,
    payload.compiled,
    'Compiled commands/assets must match the candidate',
  );
  assert.deepEqual(
    current.packages,
    payload.packages,
    'Public workspace packages must match the candidate',
  );
  assert.deepEqual(
    current.operations,
    payload.operations,
    'Private release commands must match the verified candidate',
  );
  return { ...payload, releaseId };
}
