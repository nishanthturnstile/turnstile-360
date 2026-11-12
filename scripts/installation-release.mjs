import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { importPKCS8, SignJWT } from 'jose';
import {
  protectedFile,
  readProtectedTrust,
  verifyInstalledModuleRelease,
} from '../packages/deployment-control/dist/index.js';
import { fileHash, verifyArtifacts } from '../packages/installation-engine/dist/artifacts.js';
import {
  customerRelease,
  ENGINE_VERSION,
  RELEASE_AUDIENCE,
  RELEASE_TYPE,
} from '../packages/installation-engine/dist/index.js';
import { run } from './module-artifacts.mjs';
import { verifyBundle } from './module-delivery.mjs';

/** External release pipeline only. Customer launcher performs no build or mutable pull. */
export async function buildInstallationRelease(input) {
  const allowed = [
    'moduleBundleDirectory',
    'dmsImage',
    'postgresImage',
    'engineImage',
    'releaseTrustFile',
    'signingFile',
    'outputDirectory',
  ];
  assert.ok(
    input &&
      typeof input === 'object' &&
      Object.keys(input).every((k) => allowed.includes(k)) &&
      Object.keys(input).length === allowed.length,
  );
  const c = input,
    trust = await readProtectedTrust(c.releaseTrustFile);
  const module = JSON.parse(readFileSync(join(c.moduleBundleDirectory, 'delivery.json'), 'utf8'));
  const installed = await verifyInstalledModuleRelease(
    module.attestation,
    module.request,
    module.request.profile,
    trust,
    Math.floor(Date.now() / 1000),
  );
  const evidence = await verifyBundle(c.moduleBundleDirectory, module.request, {
    issuer: trust.issuer,
    keys: trust.keys.map((k) => ({ kid: k.kid, publicKey: k.pem })),
  });
  const images = [
    { role: 'engine', id: c.engineImage },
    { role: 'dms-api', id: c.dmsImage },
    { role: 'postgres', id: c.postgresImage },
    ...evidence.inventory.images.map((i) => ({ role: i.role, id: `sha256:${i.digest}` })),
  ];
  for (const i of images) {
    assert.match(i.id, /^sha256:[a-f0-9]{64}$/);
    assert.equal(run('docker', ['image', 'inspect', '--format', '{{.Id}}', i.id]), i.id);
  }
  const root = resolve(c.outputDirectory);
  assert.ok(!existsSync(root), 'Use a new protected release output');
  mkdirSync(root, { mode: 0o700 });
  const bundle = join(root, 'bundle');
  mkdirSync(bundle, { mode: 0o700 });
  cpSync(c.moduleBundleDirectory, join(bundle, 'modules'), { recursive: true });
  cpSync('deploy/installation/installer', join(bundle, 'installer'));
  cpSync('deploy/installation/COVERED_SOURCE_OFFER.txt', join(bundle, 'COVERED_SOURCE_OFFER.txt'));
  writeFileSync(
    join(bundle, 'NOTICES'),
    `${readFileSync('LICENSE', 'utf8')}\n${readFileSync('THIRD_PARTY_NOTICES', 'utf8')}\n${readFileSync(join(c.moduleBundleDirectory, 'NOTICES'), 'utf8')}`,
    { mode: 0o644 },
  );
  writeFileSync(
    join(bundle, 'README.md'),
    `Engine ${ENGINE_VERSION}. Module release ${installed.releaseId}.\n\n${readFileSync('docs/runbooks/installation-handover.md', 'utf8').replace(/\[architecture\.md\]\([^)]+\)/g, 'the reviewed release architecture supplied separately')}`,
    { mode: 0o644 },
  );
  run('docker', ['save', '--output', join(bundle, 'images.tar'), ...images.map((i) => i.id)]);
  const names = [
    'images.tar',
    'installer',
    'README.md',
    'NOTICES',
    'COVERED_SOURCE_OFFER.txt',
    ...[
      'delivery.json',
      'images.tar',
      'source-inventory.json',
      'artifact-inventory.json',
      'NOTICES',
      'README.md',
    ].map((n) => `modules/${n}`),
  ];
  const files = [];
  for (const name of names)
    files.push({
      name,
      digest: await fileHash(join(bundle, name)),
      size: statSync(join(bundle, name)).size,
    });
  const payload = customerRelease.parse({
    version: 1,
    engineVersion: ENGINE_VERSION,
    profile: 'module-poc',
    platform: 'linux/amd64',
    sourceDigest: installed.request.profile.sourceDigest,
    module: {
      releaseId: installed.releaseId,
      profileDigest: installed.request.profileDigest,
      catalogueDigest: installed.request.profile.catalogueDigest,
    },
    images,
    files,
  });
  const signer = JSON.parse(protectedFile(c.signingFile));
  assert.equal(signer.issuer, trust.issuer);
  const now = Math.floor(Date.now() / 1000),
    attestation = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', typ: RELEASE_TYPE, kid: signer.kid })
      .setIssuer(signer.issuer)
      .setAudience(RELEASE_AUDIENCE)
      .setIssuedAt(now)
      .setNotBefore(now)
      .setExpirationTime(now + 86400)
      .sign(await importPKCS8(signer.privateKey, 'RS256'));
  writeFileSync(join(bundle, 'installation.json'), JSON.stringify({ attestation }), {
    mode: 0o644,
  });
  await verifyArtifacts(bundle, c.releaseTrustFile);
  writeFileSync(join(root, 'RELEASE.json'), JSON.stringify(payload, null, 2), { mode: 0o600 });
  return { directory: bundle, release: payload };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.equal(process.argv.length, 3);
    await buildInstallationRelease(JSON.parse(protectedFile(process.argv[2])));
    console.log('Verified artifact-only module installation release assembled.');
  } catch {
    console.error(
      'Installation release stopped; inspect private pipeline inputs without publishing signing material.',
    );
    process.exitCode = 1;
  }
}
