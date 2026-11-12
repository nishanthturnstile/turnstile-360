import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { decodeJwt, exportPKCS8, exportSPKI, generateKeyPair } from 'jose';
import { createProfile, profileDigest } from '../packages/module-catalog/dist/index.js';
import { docker, run } from './module-artifacts.mjs';
import { hash, sourceCatalogue, sourceInventory } from './module-build-source.mjs';
import { buildBundle } from './module-delivery.mjs';

const root = process.argv[2];
assert.ok(
  root && isAbsolute(root) && !existsSync(root),
  'Supply a new absolute private fixture directory',
);
mkdirSync(root, { mode: 0o700 });
run('pnpm', [
  'exec',
  'turbo',
  'run',
  'build',
  '--filter=@thaarei/dms-api...',
  '--filter=@thaarei/turnstile-api...',
]);
console.log('Building independent DMS initializer image.');
docker(['build', '-f', 'apps/dms-api/Dockerfile', '-t', 'thaarei-mod-i05-dms:fixture', '.']);
const dmsImage = docker(['image', 'inspect', '--format', '{{.Id}}', 'thaarei-mod-i05-dms:fixture']);
const keys = await generateKeyPair('RS256', { extractable: true }),
  trust = {
    issuer: 'https://releases.fixture.test',
    keys: [{ kid: 'installation-release-fixture', publicKey: await exportSPKI(keys.publicKey) }],
  };
const signing = join(root, 'release-signing.json');
writeFileSync(
  signing,
  JSON.stringify({
    issuer: trust.issuer,
    kid: trust.keys[0].kid,
    privateKey: await exportPKCS8(keys.privateKey),
  }),
  { mode: 0o600 },
);
const catalogue = sourceCatalogue(hash(JSON.stringify(sourceInventory()))),
  profile = await createProfile(catalogue, { requestedIndividualIds: [] }, ['foundation']),
  request = { version: 1, catalogue, profile, profileDigest: await profileDigest(profile) };
console.log('Building selected initializer package and inspecting actual images.');
const built = await buildBundle(request, join(root, 'bundles'), signing, trust);
writeFileSync(
  join(root, 'fixture.json'),
  JSON.stringify({ dmsImage, bundleDirectory: built.path, request, releaseTrust: trust }),
  { mode: 0o600 },
);
console.log('Running real central HTTPS/PostgreSQL and private Docker preparation gate.');
run(process.execPath, ['scripts/test-control-plane.mjs'], {
  env: { ...process.env, MOD_I05_PREPARATION_FIXTURE: join(root, 'fixture.json') },
});
writeFileSync(
  join(root, 'qualification.json'),
  JSON.stringify({
    version: 1,
    passed: true,
    dmsImage,
    profileDigest: request.profileDigest,
    releaseId: decodeJwt(
      JSON.parse(readFileSync(join(built.path, 'delivery.json'), 'utf8')).attestation,
    ).inventory.releaseId,
  }),
  { mode: 0o600 },
);
console.log(
  'MOD-I05 actual central, Docker preparation, bootstrap and independent pairing gate passed.',
);
