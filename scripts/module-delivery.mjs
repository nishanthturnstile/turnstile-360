import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeJwt, importPKCS8, importSPKI, jwtVerify, SignJWT } from 'jose';
import {
  createProfile,
  DELIVERY_AUDIENCE,
  DELIVERY_TYPE,
  deliveryReleaseId,
  deliveryRequestDigest,
  profileDigest,
  validateDeliveryEvidence,
  validateDeliveryRequest,
} from '../packages/module-catalog/dist/index.js';
import { docker, inspectImage, run } from './module-artifacts.mjs';
import {
  assertCodeCatalogue,
  hash,
  sourceCatalogue,
  sourceInventory,
} from './module-build-source.mjs';

export async function fileHash(path) {
  const digest = createHash('sha256');
  for await (const data of createReadStream(path)) digest.update(data);
  return digest.digest('hex');
}
export function readJson(path, max = 262144) {
  const s = lstatSync(path);
  assert.ok(s.isFile() && !s.isSymbolicLink() && s.size <= max, 'Bounded regular input required');
  return JSON.parse(readFileSync(path, 'utf8'));
}
export async function verifyToken(token, request, trust, historical = false) {
  const originalIat = historical ? decodeJwt(token).iat : undefined;
  if (historical)
    assert.ok(
      Number.isInteger(originalIat) &&
        originalIat > 0 &&
        originalIat <= Math.floor(Date.now() / 1000),
      'Invalid original signing time',
    );
  assert.ok(
    token.length <= 32768 && trust.keys.length > 0 && trust.keys.length <= 8,
    'Invalid release trust',
  );
  assert.ok(
    new URL(trust.issuer).origin === trust.issuer && new URL(trust.issuer).protocol === 'https:',
    'HTTPS release issuer required',
  );
  const verified = await jwtVerify(
    token,
    async (header) => {
      assert.ok(
        !header.jku && !header.jwk && !header.x5u && !header.x5c,
        'External signing key forbidden',
      );
      const entry = trust.keys.find((k) => k.kid === header.kid);
      assert.ok(entry, 'Unknown release key');
      return importSPKI(entry.publicKey, 'RS256');
    },
    {
      issuer: trust.issuer,
      audience: DELIVERY_AUDIENCE,
      typ: DELIVERY_TYPE,
      algorithms: ['RS256'],
      requiredClaims: ['iat', 'nbf', 'exp'],
      maxTokenAge: '24h',
      ...(historical ? { currentDate: new Date(originalIat * 1000) } : {}),
    },
  );
  const { iss: _iss, aud: _aud, iat, nbf, exp, ...payload } = verified.payload;
  assert.ok(
    Number.isInteger(iat) &&
      Number.isInteger(nbf) &&
      Number.isInteger(exp) &&
      exp > nbf &&
      nbf >= iat &&
      exp - iat <= 86400,
    'Invalid validity',
  );
  return validateDeliveryEvidence(request, payload);
}
const expectedFiles = (v) => ({
  'images.tar': v.inventory.archiveDigest,
  'source-inventory.json': v.inventory.sourceInventoryDigest,
  'artifact-inventory.json': v.artifactInventoryDigest,
  NOTICES: v.inventory.noticesDigest,
  'README.md': v.documentationDigest,
});
export async function verifyBundle(
  dir,
  request,
  trust,
  { images = true, historical = false } = {},
) {
  const descriptor = readJson(join(dir, 'delivery.json'));
  assert.deepEqual(Object.keys(descriptor).sort(), ['attestation', 'request']);
  assert.equal(
    await deliveryRequestDigest(descriptor.request),
    await deliveryRequestDigest(request),
    'Different cached profile request',
  );
  const v = await verifyToken(descriptor.attestation, request, trust, historical);
  assert.deepEqual(
    readdirSync(dir).sort(),
    ['delivery.json', ...Object.keys(expectedFiles(v))].sort(),
    'Unowned bundle content',
  );
  for (const [name, digest] of Object.entries(expectedFiles(v))) {
    const p = join(dir, name);
    assert.ok(
      lstatSync(p).isFile() && !lstatSync(p).isSymbolicLink(),
      'Regular bundle file required',
    );
    assert.equal(await fileHash(p), digest, `Substituted artifact ${name}`);
  }
  const source = readJson(join(dir, 'source-inventory.json'), 16 * 1024 * 1024);
  assert.equal(hash(JSON.stringify(source)), request.profile.sourceDigest);
  // Inspect archive image identities without extraction or trusting local Docker tags.
  const archiveRead = (name) => {
    const result = spawnSync('tar', ['-xOf', join(dir, 'images.tar'), name], {
      maxBuffer: 1048576,
    });
    assert.equal(result.status, 0, 'Missing archive metadata');
    return result.stdout;
  };
  const archivePaths = run('tar', ['-tf', join(dir, 'images.tar')]).split('\n');
  let archiveImages;
  if (archivePaths.includes('index.json')) {
    const index = JSON.parse(archiveRead('index.json'));
    archiveImages = index.manifests.map((entry) => {
      assert.match(entry.digest, /^sha256:[a-f0-9]{64}$/);
      const digest = entry.digest.slice(7);
      assert.equal(
        hash(archiveRead(`blobs/sha256/${digest}`)),
        digest,
        'Substituted OCI descriptor',
      );
      return digest;
    });
  } else {
    archiveImages = JSON.parse(archiveRead('manifest.json')).map((entry) => {
      assert.match(entry.Config, /^(?:blobs\/sha256\/)?[a-f0-9]{64}(?:\.json)?$/);
      return hash(archiveRead(entry.Config));
    });
  }
  assert.deepEqual(
    archiveImages.sort(),
    v.inventory.images.map((i) => i.digest).sort(),
    'Missing or substituted archive image',
  );
  if (images) {
    const artifact = readJson(join(dir, 'artifact-inventory.json'), 32 * 1024 * 1024);
    for (const kind of ['api', 'web']) {
      const ref = v.inventory.images.find((i) => i.role === `turnstile-${kind}`);
      assert.ok(ref, 'Missing required image');
      const inspected = inspectImage(`sha256:${ref.digest}`, kind, request);
      assert.deepEqual(inspected, artifact[kind], 'Installed image differs from signed inventory');
    }
  }
  return v;
}
async function signingConfiguration(path) {
  assert.ok(isAbsolute(path), 'Absolute private signing file required');
  const s = lstatSync(path);
  assert.equal(s.mode & 0o077, 0, 'Release signing key must be private');
  const c = readJson(path, 8192);
  assert.deepEqual(Object.keys(c).sort(), ['issuer', 'kid', 'privateKey']);
  assert.match(c.kid, /^[A-Za-z0-9_-]{1,80}$/);
  assert.ok(new URL(c.issuer).origin === c.issuer && new URL(c.issuer).protocol === 'https:');
  return { ...c, key: await importPKCS8(c.privateKey, 'RS256') };
}
export async function buildBundle(raw, store, signingFile, trust) {
  const request = await validateDeliveryRequest(raw),
    source = sourceInventory();
  assert.equal(
    request.profile.sourceDigest,
    hash(JSON.stringify(source)),
    'Source changed; obtain a matching reviewed catalogue',
  );
  assertCodeCatalogue(request.catalogue);
  assert.ok(isAbsolute(store), 'Configured absolute private bundle directory required');
  mkdirSync(store, { recursive: true, mode: 0o700 });
  const destination = join(store, request.profileDigest);
  if (existsSync(destination)) {
    await verifyBundle(destination, request, trust);
    return { path: destination, reused: true };
  }
  run('pnpm', ['check:boundaries']);
  const signing = await signingConfiguration(signingFile),
    staging = join(store, `.building-${randomUUID()}`);
  mkdirSync(staging, { mode: 0o700 });
  try {
    const artifacts = {};
    for (const kind of ['api', 'web']) {
      const tag = `thaarei-turnstile-${kind}:profile-${request.profileDigest}`;
      docker([
        'build',
        '--platform',
        request.profile.platform,
        '--build-arg',
        `TURNSTILE_MODULE_REQUEST=${Buffer.from(JSON.stringify(request)).toString('base64')}`,
        '-f',
        `apps/turnstile-${kind}/Dockerfile`,
        '-t',
        tag,
        '.',
      ]);
      artifacts[kind] = inspectImage(tag, kind, request);
    }
    // Actual production commands, non-root/read-only/no network/credentials, liveness and closed business access.
    run(process.execPath, [
      'scripts/test-onboarding-images.mjs',
      `sha256:${artifacts.api.image}`,
      `sha256:${artifacts.web.image}`,
    ]);
    docker([
      'save',
      '--output',
      join(staging, 'images.tar'),
      `sha256:${artifacts.api.image}`,
      `sha256:${artifacts.web.image}`,
    ]);
    writeFileSync(join(staging, 'source-inventory.json'), JSON.stringify(source), { mode: 0o600 });
    writeFileSync(join(staging, 'artifact-inventory.json'), JSON.stringify(artifacts), {
      mode: 0o600,
    });
    writeFileSync(
      join(staging, 'NOTICES'),
      readFileSync('LICENSE', 'utf8') +
        '\n' +
        readFileSync('THIRD_PARTY_NOTICES', 'utf8') +
        '\n' +
        readFileSync('apps/turnstile-web/public/third-party-notices.txt', 'utf8'),
      { mode: 0o600 },
    );
    writeFileSync(
      join(staging, 'README.md'),
      `Turnstile selected release\nProfile: ${request.profileDigest}\nPlatform: ${request.profile.platform}\nModules: ${request.profile.modules.map((m) => m.id).join(', ')}\nPrivate tools: foundation database, authentication, deployment and configuration operators are retained.\nVerify the signed local bundle before loading images. Pairing, independent DMS approval, module activation and user permissions remain required.\n`,
      { mode: 0o600 },
    );
    const inventory = {
      version: 1,
      catalogueDigest: request.profile.catalogueDigest,
      profileDigest: request.profileDigest,
      sourceDigest: request.profile.sourceDigest,
      releaseId: '0'.repeat(64),
      platform: request.profile.platform,
      images: ['api', 'web'].map((kind) => ({
        role: `turnstile-${kind}`,
        digest: artifacts[kind].image,
      })),
      archiveDigest: await fileHash(join(staging, 'images.tar')),
      noticesDigest: await fileHash(join(staging, 'NOTICES')),
      sourceInventoryDigest: await fileHash(join(staging, 'source-inventory.json')),
    };
    const evidence = {
      version: 1,
      kind: 'delivery',
      requestDigest: await deliveryRequestDigest(request),
      inventory,
      artifactInventoryDigest: await fileHash(join(staging, 'artifact-inventory.json')),
      documentationDigest: await fileHash(join(staging, 'README.md')),
    };
    inventory.releaseId = await deliveryReleaseId(evidence);
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT(evidence)
      .setProtectedHeader({ alg: 'RS256', typ: DELIVERY_TYPE, kid: signing.kid })
      .setIssuer(signing.issuer)
      .setAudience(DELIVERY_AUDIENCE)
      .setIssuedAt(now)
      .setNotBefore(now)
      .setExpirationTime(now + 86400)
      .sign(signing.key);
    writeFileSync(join(staging, 'delivery.json'), JSON.stringify({ request, attestation: token }), {
      mode: 0o600,
    });
    await verifyBundle(staging, request, trust);
    renameSync(staging, destination);
    return { path: destination, reused: false };
  } finally {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  }
}
async function main() {
  const [command, input, output] = process.argv.slice(2);
  if (command === 'code') {
    const inventory = sourceInventory();
    writeFileSync(
      input,
      JSON.stringify(
        sourceCatalogue(
          hash(JSON.stringify(inventory)),
          process.arch === 'arm64' ? 'linux/arm64' : 'linux/amd64',
        ),
        null,
        2,
      ),
      { flag: 'wx', mode: 0o600 },
    );
  } else if (command === 'request') {
    const c = readJson(input),
      ids = output ? output.split(',').filter(Boolean) : [];
    const p = await createProfile(
      c,
      { requestedIndividualIds: ids },
      c.modules.filter((m) => m.category === 'core' || ids.includes(m.id)).map((m) => m.id),
    );
    const request = { version: 1, catalogue: c, profile: p, profileDigest: await profileDigest(p) };
    writeFileSync(process.argv[5], JSON.stringify(request), { flag: 'wx', mode: 0o600 });
  } else if (command === 'renew') {
    assert.ok(process.env.MODULE_BUNDLE_STORE, 'Configure a private local bundle store');
    const request = readJson(input),
      trust = readJson(process.env.MODULE_RELEASE_TRUST_FILE, 32768);
    assert.equal(
      request.profile.sourceDigest,
      hash(JSON.stringify(sourceInventory())),
      'Restore the pinned source before renewing',
    );
    const dir = join(resolve(process.env.MODULE_BUNDLE_STORE), request.profileDigest);
    const evidence = await verifyBundle(dir, request, trust, { historical: true });
    const signing = await signingConfiguration(process.env.MODULE_RELEASE_SIGNING_KEY_FILE),
      now = Math.floor(Date.now() / 1000);
    const attestation = await new SignJWT(evidence)
      .setProtectedHeader({ alg: 'RS256', typ: DELIVERY_TYPE, kid: signing.kid })
      .setIssuer(signing.issuer)
      .setAudience(DELIVERY_AUDIENCE)
      .setIssuedAt(now)
      .setNotBefore(now)
      .setExpirationTime(now + 86400)
      .sign(signing.key);
    await verifyToken(attestation, request, trust);
    const temporary = join(dir, `.renew-${randomUUID()}`);
    writeFileSync(temporary, JSON.stringify({ request, attestation }), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, join(dir, 'delivery.json'));
    console.log(
      'Exact artifacts reverified and evidence renewed. Replace the matching provisioned reference explicitly.',
    );
  } else if (command === 'publish') {
    assert.ok(
      process.env.MODULE_BUNDLE_STORE && process.env.MODULE_REFERENCE_STORE,
      'Configure private bundle and reference directories',
    );
    const request = readJson(input),
      trust = readJson(process.env.MODULE_RELEASE_TRUST_FILE, 32768);
    const dir = join(resolve(process.env.MODULE_BUNDLE_STORE), request.profileDigest);
    const evidence = await verifyBundle(dir, request, trust);
    const references = resolve(process.env.MODULE_REFERENCE_STORE);
    mkdirSync(references, { recursive: true, mode: 0o755 });
    const target = join(references, `${request.profileDigest}.json`),
      data = readFileSync(join(dir, 'delivery.json'));
    if (existsSync(target)) {
      const old = readJson(target);
      assert.equal(await deliveryRequestDigest(old.request), await deliveryRequestDigest(request));
      assert.deepEqual(
        await verifyToken(old.attestation, request, trust, true),
        evidence,
        'Existing immutable artifacts differ; reconcile explicitly',
      );
      const temporary = join(references, `.publish-${randomUUID()}`);
      writeFileSync(temporary, data, { mode: 0o644, flag: 'wx' });
      renameSync(temporary, target);
    } else {
      const temporary = join(references, `.publish-${randomUUID()}`);
      writeFileSync(temporary, data, { mode: 0o644, flag: 'wx' });
      try {
        linkSync(temporary, target);
      } finally {
        rmSync(temporary);
      }
    }
    console.log('Verified reference published; customer authority is unchanged.');
  } else if (command === 'build') {
    assert.ok(process.env.MODULE_BUNDLE_STORE, 'Configure a private local bundle store');
    const trust = readJson(process.env.MODULE_RELEASE_TRUST_FILE, 32768);
    const result = await buildBundle(
      readJson(input),
      resolve(process.env.MODULE_BUNDLE_STORE || ''),
      process.env.MODULE_RELEASE_SIGNING_KEY_FILE,
      trust,
    );
    console.log(
      result.reused
        ? 'Exact verified profile reused.'
        : 'Selected profile built, started, inspected and signed.',
    );
  } else if (command === 'load') {
    assert.ok(process.env.MODULE_BUNDLE_STORE, 'Configure a private local bundle store');
    const request = readJson(input),
      trust = readJson(process.env.MODULE_RELEASE_TRUST_FILE, 32768);
    const dir = join(resolve(process.env.MODULE_BUNDLE_STORE), request.profileDigest);
    await verifyBundle(dir, request, trust, { images: false });
    docker(['load', '--input', join(dir, 'images.tar')]);
    await verifyBundle(dir, request, trust);
    console.log('Verified archive loaded and exact image inventories checked.');
  } else if (command === 'verify') {
    const request = readJson(input),
      trust = readJson(process.env.MODULE_RELEASE_TRUST_FILE, 32768);
    assert.ok(process.env.MODULE_BUNDLE_STORE, 'Configure a private local bundle store');
    await verifyBundle(
      join(resolve(process.env.MODULE_BUNDLE_STORE), request.profileDigest),
      request,
      trust,
    );
    console.log('Signed local bundle and installed image inventories verified.');
  } else throw new Error('Unknown delivery command');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      'Module delivery rejected the request or artifact verification. No secrets emitted.',
    );
    process.exitCode = 1;
  });
