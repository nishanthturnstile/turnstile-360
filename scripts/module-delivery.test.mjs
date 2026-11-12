import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportSPKI, generateKeyPair, SignJWT } from 'jose';
import {
  createProfile,
  deliveryReleaseId,
  deliveryRequestDigest,
  profileDigest,
  validateDeliveryEvidence,
} from '../packages/module-catalog/dist/index.js';
import { sourceCatalogue } from './module-build-source.mjs';
import { verifyToken } from './module-delivery.mjs';

const c = sourceCatalogue('a'.repeat(64)),
  p = await createProfile(c, { requestedIndividualIds: ['incident-management'] }, [
    'foundation',
    'incident-management',
  ]);
const request = { version: 1, catalogue: c, profile: p, profileDigest: await profileDigest(p) };
const inventory = {
  version: 1,
  catalogueDigest: p.catalogueDigest,
  profileDigest: request.profileDigest,
  sourceDigest: p.sourceDigest,
  releaseId: '0'.repeat(64),
  platform: p.platform,
  images: [
    { role: 'turnstile-api', digest: 'b'.repeat(64) },
    { role: 'turnstile-web', digest: 'c'.repeat(64) },
  ],
  archiveDigest: 'd'.repeat(64),
  noticesDigest: 'e'.repeat(64),
  sourceInventoryDigest: 'f'.repeat(64),
};
const proof = {
  version: 1,
  kind: 'delivery',
  requestDigest: await deliveryRequestDigest(request),
  inventory,
  artifactInventoryDigest: '1'.repeat(64),
  documentationDigest: '2'.repeat(64),
};
inventory.releaseId = await deliveryReleaseId(proof);
const keys = await generateKeyPair('RS256');
const trust = {
  issuer: 'https://releases.fixture.test',
  keys: [{ kid: 'release', publicKey: await exportSPKI(keys.publicKey) }],
};
const sign = (payload, options = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(payload)
    .setProtectedHeader({
      alg: 'RS256',
      kid: 'release',
      typ: options.typ || 'thaarei-module-delivery+jwt',
      ...options.header,
    })
    .setIssuer(trust.issuer)
    .setAudience(options.aud || 'urn:thaarei:module-delivery')
    .setIssuedAt(options.iat ?? now)
    .setNotBefore(options.nbf ?? now)
    .setExpirationTime(options.exp ?? now + 600)
    .sign(keys.privateKey);
};
test('delivery identity is deterministic and contains no customer identity or arbitrary build inputs', async () => {
  assert.equal(
    (await validateDeliveryEvidence(request, proof)).inventory.releaseId,
    inventory.releaseId,
  );
  assert.equal(
    await deliveryRequestDigest(request),
    await deliveryRequestDigest({
      ...request,
      profile: { ...p, modules: [...p.modules].reverse() },
    }),
  );
  for (const extra of [
    { customerId: 'secret' },
    { command: 'curl' },
    { sourceUrl: 'https://arbitrary.test' },
    { url: 'https://artifacts.test' },
  ])
    await assert.rejects(deliveryRequestDigest({ ...request, ...extra }));
});
test('signed results are pinned to source/catalogue/profile/platform and both required images', async () => {
  for (const patch of [
    { profileDigest: '9'.repeat(64) },
    { sourceDigest: '9'.repeat(64) },
    { catalogueDigest: '9'.repeat(64) },
    { platform: 'linux/arm64' },
    { images: [inventory.images[0]] },
  ]) {
    const changed = { ...proof, inventory: { ...inventory, ...patch } };
    if (patch.images === undefined) changed.inventory.releaseId = await deliveryReleaseId(changed);
    await assert.rejects(validateDeliveryEvidence(request, changed));
  }
});
test('release verifier rejects forged, expired, wrong-purpose and excessive-validity results', async () => {
  const token = await sign(proof);
  assert.equal(
    (await verifyToken(token, request, trust)).inventory.profileDigest,
    request.profileDigest,
  );
  const now = Math.floor(Date.now() / 1000);
  for (const options of [
    { exp: now - 1, iat: now - 600, nbf: now - 600 },
    { exp: now + 86401 },
    { typ: 'thaarei-module-catalogue+jwt' },
    { aud: 'urn:thaarei:module-catalogue' },
    { header: { jku: 'https://attacker.test/key' } },
  ])
    await assert.rejects(verifyToken(await sign(proof, options), request, trust));
  await assert.rejects(verifyToken(`${token.slice(0, -8)}AAAAAAAA`, request, trust));
  const other = await generateKeyPair('RS256');
  await assert.rejects(
    verifyToken(token, request, {
      ...trust,
      keys: [{ kid: 'release', publicKey: await exportSPKI(other.publicKey) }],
    }),
  );
});

test('only explicit pipeline historical verification can renew expired identical evidence', async () => {
  const now = Math.floor(Date.now() / 1000);
  const expired = await sign(proof, { iat: now - 1200, nbf: now - 1200, exp: now - 600 });
  await assert.rejects(verifyToken(expired, request, trust));
  assert.equal(
    (await verifyToken(expired, request, trust, true)).inventory.releaseId,
    inventory.releaseId,
  );
  await assert.rejects(verifyToken(`${expired.slice(0, -8)}AAAAAAAA`, request, trust, true));
  await assert.rejects(
    verifyToken(
      await sign(proof, { iat: now + 10, nbf: now + 10, exp: now + 600 }),
      request,
      trust,
      true,
    ),
  );
});
