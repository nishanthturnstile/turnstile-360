import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { exportPKCS8, exportSPKI, generateKeyPair, importPKCS8 } from 'jose';
import {
  createProfile,
  profileDigest,
  resolveSelection,
} from '../packages/module-catalog/dist/index.js';
import { run } from './module-artifacts.mjs';
import { hash, sourceCatalogue, sourceInventory } from './module-build-source.mjs';
import { buildBundle, verifyBundle } from './module-delivery.mjs';

const directory = process.argv[2];
assert.ok(directory && isAbsolute(directory) && [3, 4].includes(process.argv.length));
const resuming = existsSync(directory);
assert.ok(
  !resuming || process.argv.includes('--resume'),
  'Use a new private directory or explicit --resume',
);
if (!resuming) mkdirSync(directory, { mode: 0o700 });
const keys = resuming
  ? {
      privateKey: await importPKCS8(
        JSON.parse(readFileSync(join(directory, 'signer.json'), 'utf8')).privateKey,
        'RS256',
      ),
    }
  : await generateKeyPair('RS256', { extractable: true });
const trust = resuming
  ? JSON.parse(readFileSync(join(directory, 'release-trust.json'), 'utf8'))
  : {
      issuer: 'https://releases.fixture.test',
      keys: [{ kid: 'cutover-fixture', publicKey: await exportSPKI(keys.publicKey) }],
    };
const signing = join(directory, 'signer.json');
if (!resuming)
  writeFileSync(
    signing,
    JSON.stringify({
      issuer: trust.issuer,
      kid: 'cutover-fixture',
      privateKey: await exportPKCS8(keys.privateKey),
    }),
    { mode: 0o600 },
  );
if (!resuming)
  writeFileSync(join(directory, 'release-trust.json'), JSON.stringify(trust), { mode: 0o600 });
const catalogue = sourceCatalogue(hash(JSON.stringify(sourceInventory()))),
  bundles = [];
const classificationFile = join(directory, `classification-${catalogue.sourceDigest}.json`);
const promoted = existsSync(classificationFile)
  ? JSON.parse(readFileSync(classificationFile, 'utf8'))
  : {
      ...catalogue,
      id: randomUUID(),
      modules: catalogue.modules.map((m) =>
        m.id === 'risk-management' ? { ...m, category: 'core' } : m,
      ),
    };
if (!existsSync(classificationFile))
  writeFileSync(classificationFile, JSON.stringify(promoted), { mode: 0o600 });
for (const [selected, ids] of [
  [catalogue, ['incident-management']],
  [catalogue, ['incident-management', 'risk-management']],
  [catalogue, ['risk-management']],
  [promoted, []],
]) {
  const profile = await createProfile(
    selected,
    { requestedIndividualIds: ids },
    resolveSelection(selected, { requestedIndividualIds: ids }).resolvedIds,
  );
  const request = {
    version: 1,
    catalogue: selected,
    profile,
    profileDigest: await profileDigest(profile),
  };
  console.log(`Build MOD-I08 selected profile: ${ids.join(', ')}`);
  assert.equal(
    hash(JSON.stringify(sourceInventory())),
    request.profile.sourceDigest,
    'Source changed during qualification',
  );
  const cached = join(directory, request.profileDigest);
  const bundle = existsSync(cached)
    ? { path: cached }
    : await buildBundle(request, directory, signing, trust);
  const evidence = await verifyBundle(bundle.path, request, trust);
  bundles.push({ directory: bundle.path, request, inventory: evidence.inventory });
}
const runDirectory = join(directory, `run-${randomUUID()}`);
mkdirSync(runDirectory, { mode: 0o700 });
const fixture = join(directory, 'fixture.json');
writeFileSync(
  fixture,
  JSON.stringify({ version: 1, directory, runDirectory, releaseTrust: trust, bundles }),
  {
    mode: 0o600,
  },
);
for (const [file, tag] of [
  ['apps/thaarei-control-plane/Dockerfile', 'thaarei-mod-i08-central:qualification'],
  ['apps/dms-api/Dockerfile', 'thaarei-mod-i08-dms:qualification'],
])
  run('docker', ['build', '-f', file, '-t', tag, '.']);
const log = join(directory, 'qualification.log');
const result = spawnSync(process.execPath, ['scripts/test-control-plane.mjs'], {
  env: {
    ...process.env,
    MOD_I08_SELECTED_FIXTURE: fixture,
    CONTROL_PLANE_TEST_IMAGE: 'thaarei-mod-i08-central:qualification',
    CONTROL_PLANE_QUALIFY_CONTAINERS: 'true',
  },
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
  timeout: 1200000,
});
writeFileSync(log, `${result.stdout}\n${result.stderr}`, { mode: 0o600 });
assert.equal(result.status, 0, `Actual cutover qualification failed; inspect private ${log}`);
console.log('MOD-I08 actual selected cutover/browser/central qualification passed.');
