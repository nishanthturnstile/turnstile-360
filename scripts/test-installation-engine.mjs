// External pipeline and independent customer-operator fixture; customer containers never mount source.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';
import { parse } from 'yaml';
import {
  createProfile,
  profileDigest,
  resolveSelection,
} from '../packages/module-catalog/dist/index.js';
import { buildInstallationRelease } from './installation-release.mjs';
import { run } from './module-artifacts.mjs';
import { hash, sourceCatalogue, sourceInventory } from './module-build-source.mjs';
import { buildBundle, verifyBundle } from './module-delivery.mjs';

const root = process.argv[2];
assert.ok(
  root && isAbsolute(root) && (!existsSync(root) || process.argv.includes('--resume')),
  'Use a new private absolute qualification directory or --resume',
);
if (!existsSync(root)) mkdirSync(root, { mode: 0o700 });
const signer = join(root, 'signer.json'),
  trustFile = join(root, 'release-trust.json');
if (!existsSync(signer)) {
  const keys = await generateKeyPair('RS256', { extractable: true });
  writeFileSync(
    signer,
    JSON.stringify({
      issuer: 'https://releases.fixture.test',
      kid: 'installer-fixture',
      privateKey: await exportPKCS8(keys.privateKey),
    }),
    { mode: 0o600 },
  );
  writeFileSync(
    trustFile,
    JSON.stringify({
      version: 1,
      issuer: 'https://releases.fixture.test',
      revision: 1,
      keys: [
        {
          kid: 'installer-fixture',
          pem: await exportSPKI(keys.publicKey),
          status: 'active',
          lastIssuedAt: null,
        },
      ],
    }),
    { mode: 0o600 },
  );
}
const runtimeTrust = JSON.parse(readFileSync(trustFile, 'utf8'));
const releaseTrust = {
  issuer: runtimeTrust.issuer,
  keys: runtimeTrust.keys.map((k) => ({ kid: k.kid, publicKey: k.pem })),
};
const catalogue = sourceCatalogue(hash(JSON.stringify(sourceInventory()))),
  profile = await createProfile(
    catalogue,
    { requestedIndividualIds: ['incident-management'] },
    resolveSelection(catalogue, { requestedIndividualIds: ['incident-management'] }).resolvedIds,
  );
const request = { version: 1, catalogue, profile, profileDigest: await profileDigest(profile) };
console.log('Build and inspect Incident-only physical delivery.');
const selected = await buildBundle(request, root, signer, releaseTrust);
const evidence = await verifyBundle(selected.path, request, releaseTrust);
for (const [file, tag] of [
  ['deploy/installation/Dockerfile', 'thaarei-mod-i09-engine:qualification'],
  ['apps/dms-api/Dockerfile', 'thaarei-mod-i09-dms:qualification'],
  ['apps/thaarei-control-plane/Dockerfile', 'thaarei-mod-i09-central:qualification'],
])
  run('docker', ['build', '-f', file, '-t', tag, '.']);
const id = (tag) => run('docker', ['image', 'inspect', '--format', '{{.Id}}', tag]);
const postgres = run('docker', [
  'image',
  'inspect',
  '--format',
  '{{.Id}}',
  parse(readFileSync('deploy/compose.local.yaml', 'utf8')).services.postgres.image,
]);
const combinedKey = hash(
  JSON.stringify({
    profile: request.profileDigest,
    module: hash(readFileSync(join(selected.path, 'delivery.json'))),
    engine: id('thaarei-mod-i09-engine:qualification'),
    dms: id('thaarei-mod-i09-dms:qualification'),
    postgres,
    launcher: hash(readFileSync('deploy/installation/installer')),
    readme: hash(readFileSync('docs/runbooks/installation-handover.md')),
    offer: hash(readFileSync('deploy/installation/COVERED_SOURCE_OFFER.txt')),
    notices: hash(readFileSync('THIRD_PARTY_NOTICES')),
    license: hash(readFileSync('LICENSE')),
  }),
);
const releaseDirectory = join(root, `release-${combinedKey}`);
const built = existsSync(releaseDirectory)
  ? { directory: join(releaseDirectory, 'bundle') }
  : await buildInstallationRelease({
      moduleBundleDirectory: selected.path,
      dmsImage: id('thaarei-mod-i09-dms:qualification'),
      postgresImage: postgres,
      engineImage: id('thaarei-mod-i09-engine:qualification'),
      releaseTrustFile: trustFile,
      signingFile: signer,
      outputDirectory: releaseDirectory,
    });
assert.equal(
  hash(JSON.stringify(sourceInventory())),
  request.profile.sourceDigest,
  'Source changed during release qualification; rebuild from current source',
);
const fixture = join(root, 'fixture.json');
writeFileSync(
  fixture,
  JSON.stringify({
    root,
    bundleDirectory: built.directory,
    moduleBundleDirectory: selected.path,
    request,
    inventory: evidence.inventory,
    releaseTrust,
    runtimeTrust,
    engineImage: id('thaarei-mod-i09-engine:qualification'),
  }),
  { mode: 0o600 },
);
run(process.execPath, [
  'scripts/test-installation-jobs.mjs',
  id('thaarei-mod-i09-dms:qualification'),
]);
if (process.argv.includes('--artifacts-only')) {
  console.log('Exact artifact assembly and owning Docker recovery qualification passed.');
  process.exit(0);
}
console.log('Run artifact-only launcher and actual central/customer HTTPS/browser handover.');
const outcome = spawnSync(process.execPath, ['scripts/test-control-plane.mjs'], {
  env: {
    ...process.env,
    MOD_I09_INSTALLATION_FIXTURE: fixture,
    CONTROL_PLANE_TEST_IMAGE: 'thaarei-mod-i09-central:qualification',
    CONTROL_PLANE_QUALIFY_CONTAINERS: 'true',
  },
  encoding: 'utf8',
  maxBuffer: 32 * 1024 ** 2,
  timeout: 1500000,
});
writeFileSync(join(root, 'qualification.log'), `${outcome.stdout}\n${outcome.stderr}`, {
  mode: 0o600,
});
assert.equal(
  outcome.status,
  0,
  `Installer qualification failed; inspect protected ${join(root, 'qualification.log')}`,
);
console.log('MOD-I09 artifact-only fresh installation qualification passed.');
