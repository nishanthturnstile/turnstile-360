import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportSPKI, generateKeyPair, SignJWT } from 'jose';
import { verifyInstallationIntent } from './installation-intent.mjs';

const keys = await generateKeyPair('RS256'),
  now = Math.floor(Date.now() / 1000),
  id = '11111111-1111-4111-8111-111111111111',
  dms = '22222222-2222-4222-8222-222222222222';
const trust = {
  version: 1,
  revision: 1,
  issuer: 'https://central.fixture.test',
  keys: [
    { kid: 'test', pem: await exportSPKI(keys.publicKey), status: 'active', lastIssuedAt: null },
  ],
};
const payload = {
  version: 1,
  iss: trust.issuer,
  aud: 'urn:thaarei:installer',
  intentId: id,
  intentRevision: 3,
  mode: 'fresh',
  binding: {
    clientId: id,
    installationId: id,
    productId: id,
    localInstallationId: id,
    tenantId: id,
    product: 'turnstile',
    applicationId: id,
  },
  dmsProductId: dms,
  desired: {
    catalogueDigest: 'a'.repeat(64),
    profileDigest: 'b'.repeat(64),
    assignmentRevision: 2,
  },
  releaseId: 'c'.repeat(64),
  environment: 'test',
  customerKey: 'fixture',
  iat: now,
  nbf: now,
  exp: now + 3600,
};
const expected = {
  intentRevision: payload.intentRevision,
  assignmentRevision: payload.desired.assignmentRevision,
  binding: payload.binding,
  dmsProductId: dms,
  profileDigest: payload.desired.profileDigest,
  releaseId: payload.releaseId,
};
const sign = (p = payload, header = {}) =>
  new SignJWT(p)
    .setProtectedHeader({
      alg: 'RS256',
      typ: 'thaarei-installation-intent+jwt',
      kid: 'test',
      ...header,
    })
    .sign(keys.privateKey);
test('private verifier accepts exact fresh identities and rejects expired, wrong-package and wrong-installation metadata', async () => {
  const token = await sign();
  assert.equal((await verifyInstallationIntent(token, trust, expected, now)).binding.tenantId, id);
  for (const change of [
    { profileDigest: 'd'.repeat(64) },
    { intentRevision: 4 },
    { assignmentRevision: 3 },
    { releaseId: 'd'.repeat(64) },
    { dmsProductId: id },
    { binding: { ...payload.binding, tenantId: dms } },
  ])
    await assert.rejects(verifyInstallationIntent(token, trust, { ...expected, ...change }, now));
  await assert.rejects(verifyInstallationIntent(token, trust, expected, now + 3600));
  await assert.rejects(
    verifyInstallationIntent(
      await sign({ ...payload, iat: now + 1, nbf: now + 1 }),
      trust,
      expected,
      now,
    ),
  );
});
test('private verifier rejects forged, wrong-purpose, remote-key, revoked and late retired-key evidence', async () => {
  const token = await sign();
  for (const header of [
    { typ: 'thaarei-deployment+jwt' },
    { jku: 'https://attacker.test/key' },
    { kid: 'unknown' },
  ])
    await assert.rejects(
      verifyInstallationIntent(await sign(payload, header), trust, expected, now),
    );
  await assert.rejects(
    verifyInstallationIntent(`${token.slice(0, -8)}AAAAAAAA`, trust, expected, now),
  );
  for (const key of [{ status: 'revoked' }, { status: 'retired', lastIssuedAt: now - 1 }])
    await assert.rejects(
      verifyInstallationIntent(
        token,
        { ...trust, keys: [{ ...trust.keys[0], ...key }] },
        expected,
        now,
      ),
    );
});
