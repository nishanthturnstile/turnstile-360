import assert from 'node:assert/strict';
import test from 'node:test';
import { exportSPKI, generateKeyPair, SignJWT } from 'jose';
import {
  customerRelease,
  installerInput,
  RELEASE_AUDIENCE,
  RELEASE_TYPE,
  verifyReleaseToken,
} from '../dist/index.js';

const digest = 'a'.repeat(64);
const payload = {
  version: 1,
  engineVersion: '0.1.0',
  profile: 'module-poc',
  platform: 'linux/amd64',
  sourceDigest: digest,
  module: { catalogueDigest: digest, profileDigest: digest, releaseId: digest },
  images: ['engine', 'dms-api', 'postgres', 'turnstile-api', 'turnstile-web'].map((role) => ({
    role,
    id: `sha256:${digest}`,
  })),
  files: [
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
  ].map((name) => ({ name, digest, size: 1 })),
};
test('release metadata rejects duplicate roles, unknown paths and future incompatible profiles', () => {
  assert.ok(customerRelease.safeParse(payload).success);
  assert.ok(
    !customerRelease.safeParse({ ...payload, images: payload.images.map(() => payload.images[0]) })
      .success,
  );
  assert.ok(
    !customerRelease.safeParse({
      ...payload,
      files: payload.files.map((f, i) => (i ? f : { ...f, name: '../secret' })),
    }).success,
  );
  assert.ok(!customerRelease.safeParse({ ...payload, profile: 'complete-production' }).success);
});
test('release verification preserves independent key policy and historical inspection supplies no fresh authority', async () => {
  const pair = await generateKeyPair('RS256'),
    now = Math.floor(Date.now() / 1000);
  const trust = {
    version: 1,
    revision: 4,
    issuer: 'https://releases.fixture.test',
    keys: [
      {
        kid: 'release',
        pem: await exportSPKI(pair.publicKey),
        status: 'active',
        lastIssuedAt: null,
      },
    ],
  };
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', typ: RELEASE_TYPE, kid: 'release' })
    .setIssuer(trust.issuer)
    .setAudience(RELEASE_AUDIENCE)
    .setIssuedAt(now - 100)
    .setNotBefore(now - 100)
    .setExpirationTime(now - 50)
    .sign(pair.privateKey);
  await assert.rejects(verifyReleaseToken(token, trust));
  assert.deepEqual(await verifyReleaseToken(token, trust, true), payload);
  for (const status of ['revoked', 'retired'])
    await assert.rejects(
      verifyReleaseToken(
        token,
        { ...trust, keys: [{ ...trust.keys[0], status, lastIssuedAt: now - 200 }] },
        true,
      ),
    );
});

test('combined preflight rejects partial relay credentials and overlapping public endpoints', () => {
  const input = {
    version: 1,
    directory: '/private/state',
    bundleDirectory: '/release/bundle',
    intentFile: '/private/inputs/intent.json',
    centralTrustFile: '/private/inputs/central.json',
    releaseTrustFile: '/private/inputs/release.json',
    ingressNetwork: 'ingress',
    authorityOrigin: 'https://turnstile.test',
    resourceOrigin: 'https://dms.test',
    transferOrigin: 'https://files.test',
    smtp: { host: 'mailpit', port: 1025, mode: 'starttls', from: 'setup@customer.test' },
    turnstileSmtp: { host: 'mailpit', port: 1025, mode: 'starttls', from: 'setup@customer.test' },
    operatorId: 'operator',
  };
  assert.ok(installerInput.safeParse(input).success);
  assert.ok(
    !installerInput.safeParse({ ...input, smtp: { ...input.smtp, user: 'relay-user' } }).success,
  );
  assert.ok(!installerInput.safeParse({ ...input, resourceOrigin: input.authorityOrigin }).success);
});
