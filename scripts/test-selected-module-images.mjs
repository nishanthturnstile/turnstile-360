import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  decodeProtectedHeader,
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  importPKCS8,
  SignJWT,
} from 'jose';
import {
  createProfile,
  deliveryReleaseId,
  profileDigest,
} from '../packages/module-catalog/dist/index.js';
import { run } from './module-artifacts.mjs';
import { hash, sourceCatalogue, sourceInventory } from './module-build-source.mjs';
import { buildBundle, verifyBundle, verifyToken } from './module-delivery.mjs';

const store = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const access = process.argv.includes('--access');
if (access && !process.argv.includes('--resume'))
  run('docker', [
    'build',
    '-f',
    'apps/dms-api/Dockerfile',
    '-t',
    'thaarei-mod-i07-dms:qualification',
    '.',
  ]);
assert.ok(
  store && isAbsolute(store) && (!existsSync(store) || process.argv.includes('--resume')),
  'Supply a new absolute fixture bundle directory',
);
const resuming = existsSync(store);
if (!resuming) mkdirSync(store, { mode: 0o700 });
const keys = resuming
  ? {
      privateKey: await importPKCS8(
        JSON.parse(readFileSync(join(store, 'fixture-signing.json'), 'utf8')).privateKey,
        'RS256',
      ),
    }
  : await generateKeyPair('RS256', { extractable: true });
const trust = resuming
  ? JSON.parse(readFileSync(join(store, 'trust.json'), 'utf8'))
  : {
      issuer: 'https://module-images.fixture.test',
      keys: [{ kid: 'fixture', publicKey: await exportSPKI(keys.publicKey) }],
    };
const signingFile = join(store, 'fixture-signing.json');
if (!resuming)
  writeFileSync(
    signingFile,
    JSON.stringify({
      issuer: trust.issuer,
      kid: 'fixture',
      privateKey: await exportPKCS8(keys.privateKey),
    }),
    { mode: 0o600 },
  );
if (!resuming) writeFileSync(join(store, 'trust.json'), JSON.stringify(trust), { mode: 0o600 });
const catalogue = sourceCatalogue(hash(JSON.stringify(sourceInventory()))),
  records = [];
for (const ids of [
  [],
  ['incident-management'],
  ['risk-management'],
  ['incident-management', 'risk-management'],
]) {
  const profile = await createProfile(catalogue, { requestedIndividualIds: ids }, [
    'foundation',
    ...ids,
  ]);
  const request = { version: 1, catalogue, profile, profileDigest: await profileDigest(profile) };
  console.log(`Building and verifying profile: ${ids.join(', ') || 'core'}`);
  const result = await buildBundle(request, store, signingFile, trust);
  const evidence = await verifyBundle(result.path, request, trust);
  assert.equal(
    (await buildBundle(request, store, signingFile, trust)).reused,
    true,
    'Exact profile must reuse verified artifacts',
  );
  const descriptor = JSON.parse(readFileSync(join(result.path, 'delivery.json'), 'utf8'));
  await assert.rejects(
    verifyToken(`${descriptor.attestation.slice(0, -8)}AAAAAAAA`, request, trust),
  );
  await assert.rejects(
    verifyToken(descriptor.attestation, { ...request, profileDigest: 'a'.repeat(64) }, trust),
  );
  const file = join(result.path, 'README.md'),
    old = readFileSync(file);
  writeFileSync(file, 'substituted documentation');
  await assert.rejects(verifyBundle(result.path, request, trust));
  writeFileSync(file, old);
  renameSync(join(result.path, 'images.tar'), join(result.path, 'missing.tar'));
  await assert.rejects(verifyBundle(result.path, request, trust));
  renameSync(join(result.path, 'missing.tar'), join(result.path, 'images.tar'));
  if (ids.length === 0) {
    // A correctly signed pipeline result with the wrong required image must still fail actual archive inspection.
    const substituted = structuredClone(evidence);
    substituted.inventory.images[0].digest = substituted.inventory.images[1].digest;
    substituted.inventory.releaseId = await deliveryReleaseId(substituted);
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT(substituted)
      .setProtectedHeader({
        alg: 'RS256',
        typ: 'thaarei-module-delivery+jwt',
        kid: decodeProtectedHeader(descriptor.attestation).kid,
      })
      .setIssuer(trust.issuer)
      .setAudience('urn:thaarei:module-delivery')
      .setIssuedAt(now)
      .setNotBefore(now)
      .setExpirationTime(now + 600)
      .sign(keys.privateKey);
    const descriptorPath = join(result.path, 'delivery.json'),
      original = readFileSync(descriptorPath);
    writeFileSync(descriptorPath, JSON.stringify({ request, attestation: token }));
    await assert.rejects(
      verifyBundle(result.path, request, trust, { images: false }),
      /Missing or substituted archive image/,
    );
    writeFileSync(descriptorPath, original);
  }

  if (ids.length === 0) {
    const requestPath = join(store, 'fixture-request.json');
    writeFileSync(requestPath, JSON.stringify(request), { mode: 0o600 });
    const env = {
      ...process.env,
      MODULE_BUNDLE_STORE: store,
      MODULE_REFERENCE_STORE: join(store, 'references'),
      MODULE_RELEASE_TRUST_FILE: join(store, 'trust.json'),
      MODULE_RELEASE_SIGNING_KEY_FILE: signingFile,
    };
    for (const command of ['load', 'publish', 'publish', 'renew', 'publish', 'verify'])
      run(process.execPath, ['scripts/module-delivery.mjs', command, requestPath], { env });
  }
  if (access) {
    const fixturePath = join(store, `access-${ids.length ? ids.join('-') : 'core'}.json`);
    writeFileSync(
      fixturePath,
      JSON.stringify({ bundleDirectory: result.path, releaseTrust: trust }),
      { mode: 0o600 },
    );
    console.log(
      run(process.execPath, ['scripts/test-auth-database.mjs', '--browser', '--modules'], {
        env: {
          ...process.env,
          MOD_I07_MODULE_FIXTURE: fixturePath,
          AUTH_BROWSER_FULL_IMAGES: 'true',
          AUTH_BROWSER_DMS_IMAGE: 'thaarei-mod-i07-dms:qualification',
          AUTH_BROWSER_API_IMAGE: `sha256:${evidence.inventory.images.find((i) => i.role === 'turnstile-api').digest}`,
          AUTH_BROWSER_WEB_IMAGE: `sha256:${evidence.inventory.images.find((i) => i.role === 'turnstile-web').digest}`,
        },
      }),
    );
  }
  records.push({
    profileDigest: request.profileDigest,
    modules: profile.modules,
    releaseId: evidence.inventory.releaseId,
    images: evidence.inventory.images,
  });
  console.log(
    'Profile passed: production startup, exclusion, archive identity, signatures, substitution rejection and reuse.',
  );
}
writeFileSync(
  join(store, 'qualification.json'),
  JSON.stringify({ version: 1, ordinaryLoginModuleAcceptance: access, profiles: records }, null, 2),
  { mode: 0o600, flag: resuming ? 'w' : 'wx' },
);
console.log(
  `All four actual selected API/web image profiles passed${access ? ' with ordinary-login module acceptance' : ''}.`,
);
