import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  audience,
  binding,
  DECISION_TYPE,
  MAX_DECISION_SECONDS,
  syncResponse,
} from '@thaarei/control-plane-contracts';
import { exportSPKI, generateKeyPair, SignJWT } from 'jose';
import {
  applyDecision,
  evaluateDecision,
  initialDecisionState,
  verifyDecision,
} from '../dist/index.js';

const { publicKey, privateKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
const now = Math.floor(Date.now() / 1000);
const epoch = randomUUID();
const expected = binding.parse({
  clientId: randomUUID(),
  installationId: randomUUID(),
  productId: randomUUID(),
  localInstallationId: randomUUID(),
  tenantId: randomUUID(),
  product: 'dms',
  applicationId: null,
});
const trust = {
  version: 1,
  revision: 1,
  issuer: 'https://central.example',
  keys: [
    { kid: 'key-one', pem: await exportSPKI(publicKey), status: 'active', lastIssuedAt: null },
  ],
};
const claims = (changes = {}) => ({
  version: 1,
  iss: trust.issuer,
  aud: audience(expected),
  binding: expected,
  epoch,
  policyRevision: 1,
  decisionSequence: 1,
  decisionId: randomUUID(),
  iat: now,
  nbf: now,
  exp: now + MAX_DECISION_SECONDS,
  state: 'approved',
  entitlement: 'product-business',
  ...changes,
});
const sign = (changes = {}, header = {}) =>
  new SignJWT(claims(changes))
    .setProtectedHeader({ alg: 'RS256', typ: DECISION_TYPE, kid: 'key-one', ...header })
    .sign(privateKey);
const denial = (state, changes = {}) => {
  const result = claims({ state, ...changes });
  delete result.entitlement;
  return new SignJWT(result)
    .setProtectedHeader({ alg: 'RS256', typ: DECISION_TYPE, kid: 'key-one' })
    .sign(privateKey);
};
const verify = (token) => verifyDecision(token, expected, epoch, trust, now);

test('production JOSE verifier pins algorithm/type/key/issuer/audience/full binding/epoch/time and discriminant', async () => {
  assert.equal((await verify(await sign())).state, 'approved');
  for (const changed of [
    { aud: 'customer-api' },
    { iss: 'https://customer.example' },
    { binding: { ...expected, tenantId: randomUUID() } },
    { binding: { ...expected, clientId: randomUUID() } },
    { binding: { ...expected, installationId: randomUUID() } },
    { binding: { ...expected, productId: randomUUID() } },
    { binding: { ...expected, localInstallationId: randomUUID() } },
    { binding: { ...expected, product: 'turnstile', applicationId: randomUUID() } },
    { epoch: randomUUID() },
    { exp: now },
    { exp: now + MAX_DECISION_SECONDS + 1 },
    { iat: now + 1, nbf: now + 1 },
    { nbf: now - 1 },
    { state: 'pending' },
  ])
    await assert.rejects(verify(await sign(changed)));
  for (const header of [
    { typ: 'JWT' },
    { kid: 'unknown' },
    { jku: 'https://attacker.example/key' },
    { alg: 'PS256' },
  ]) {
    if (header.alg) {
      const token = await new SignJWT(claims())
        .setProtectedHeader({ alg: 'PS256', typ: DECISION_TYPE, kid: 'key-one' })
        .sign((await generateKeyPair('PS256')).privateKey);
      await assert.rejects(verify(token));
    } else await assert.rejects(verify(await sign({}, header)));
  }
  const hmac = await new SignJWT(claims())
    .setProtectedHeader({ alg: 'HS256', typ: DECISION_TYPE, kid: 'key-one' })
    .sign(new TextEncoder().encode('x'.repeat(64)));
  await assert.rejects(verify(hmac));
  const other = await generateKeyPair('RS256');
  await assert.rejects(
    verify(
      await new SignJWT(claims())
        .setProtectedHeader({ alg: 'RS256', typ: DECISION_TYPE, kid: 'key-one' })
        .sign(other.privateKey),
    ),
  );
  assert.throws(() =>
    syncResponse.parse({
      version: 1,
      receiptId: randomUUID(),
      binding: expected,
      epoch,
      generation: 1,
      operationId: randomUUID(),
      decision: awaitPlaceholder(),
      state: 'approved',
    }),
  );
  function awaitPlaceholder() {
    return 'x'.repeat(100);
  }
});

test('monotonic decision persistence retains denial beyond expiry and rejects delayed approvals', async () => {
  let state = initialDecisionState(epoch);
  const token = await sign();
  state = await applyDecision(state, token, expected, trust, now);
  assert.equal((await evaluateDecision(state, expected, trust, now)).access, 'full');
  assert.equal(
    (await evaluateDecision(state, expected, trust, now + MAX_DECISION_SECONDS)).access,
    'existing-reads',
  );
  const renewed = await sign({ decisionSequence: 2 });
  state = await applyDecision(state, renewed, expected, trust, now);
  await assert.rejects(applyDecision(state, token, expected, trust, now), /Stale/);
  await assert.rejects(
    applyDecision(state, await denial('suspended', { decisionSequence: 3 }), expected, trust, now),
    /equal revision/,
  );
  await assert.rejects(
    applyDecision(state, await sign({ decisionSequence: 2 }), expected, trust, now),
    /sequence conflict/,
  );
  const suspended = await denial('suspended', {
    policyRevision: 2,
    decisionSequence: 3,
    exp: now + 10,
  });
  state = await applyDecision(state, suspended, expected, trust, now);
  assert.equal((await evaluateDecision(state, expected, trust, now + 11)).state, 'suspended');
  assert.equal((await evaluateDecision(state, expected, trust, now + 11)).access, 'existing-reads');
  await assert.rejects(applyDecision(state, renewed, expected, trust, now), /Stale/);
  await assert.rejects(
    applyDecision(
      state,
      await sign({ policyRevision: 2, decisionSequence: 4 }),
      expected,
      trust,
      now,
    ),
    /equal revision/,
  );
  state = await applyDecision(
    state,
    await sign({ policyRevision: 3, decisionSequence: 4 }),
    expected,
    trust,
    now,
  );
  assert.equal((await evaluateDecision(state, expected, trust, now)).access, 'full');
  const noHistory = await applyDecision(
    initialDecisionState(epoch),
    await denial('suspended', { exp: now + 10 }),
    expected,
    trust,
    now,
  );
  assert.equal((await evaluateDecision(noHistory, expected, trust, now + 11)).access, 'closed');
  const rejected = await applyDecision(
    initialDecisionState(epoch),
    await denial('rejected', { exp: now + 10 }),
    expected,
    trust,
    now,
  );
  assert.equal((await evaluateDecision(rejected, expected, trust, now + 11)).access, 'closed');
  await assert.rejects(
    applyDecision(
      initialDecisionState(epoch),
      await denial('pending', { exp: now + 10 }),
      expected,
      trust,
      now + 11,
    ),
  );
});

test('invalid incoming proof preserves usable retained state; corrupt storage, revoked trust and rollback close access', async () => {
  const token = await sign();
  const state = await applyDecision(initialDecisionState(epoch), token, expected, trust, now);
  await assert.rejects(
    applyDecision(state, await sign({}, { kid: 'missing' }), expected, trust, now),
  );
  assert.equal((await evaluateDecision(state, expected, trust, now)).access, 'full');
  const corrupt = structuredClone(state);
  corrupt.accepted.token += 'invalid';
  assert.equal((await evaluateDecision(corrupt, expected, trust, now)).access, 'closed');
  const revoked = {
    ...trust,
    revision: 2,
    keys: trust.keys.map((k) => ({ ...k, status: 'revoked' })),
  };
  assert.equal((await evaluateDecision(state, expected, revoked, now)).access, 'closed');
  const retired = {
    ...trust,
    keys: trust.keys.map((k) => ({ ...k, status: 'retired', lastIssuedAt: now })),
  };
  assert.equal((await evaluateDecision(state, expected, retired, now)).access, 'full');
  retired.keys[0].lastIssuedAt = now - 1;
  assert.equal((await evaluateDecision(state, expected, retired, now)).access, 'closed');
  assert.equal((await evaluateDecision(state, expected, trust, now - 1)).access, 'closed');
  assert.equal(
    (await evaluateDecision({ ...state, trustRevision: 2 }, expected, trust, now)).access,
    'closed',
  );
  assert.equal(
    (await evaluateDecision({ ...state, quarantined: true }, expected, trust, now)).access,
    'closed',
  );
  await assert.rejects(
    applyDecision(
      state,
      await sign({ policyRevision: 2, decisionSequence: 1 }),
      expected,
      trust,
      now,
    ),
    /regressed/,
  );
});

test('offline expiry is bounded but a compromised trusted key needs independent revocation', async () => {
  const original = await applyDecision(
    initialDecisionState(epoch),
    await sign(),
    expected,
    trust,
    now,
  );
  const later = now + MAX_DECISION_SECONDS + 10;
  assert.equal((await evaluateDecision(original, expected, trust, later)).access, 'existing-reads');
  // An attacker with the still-trusted private key can issue a fresh seven-day grant.
  // This test deliberately demonstrates the limit, rather than claiming expiry solves compromise.
  const forged = await sign({
    iat: later,
    nbf: later,
    exp: later + MAX_DECISION_SECONDS,
    policyRevision: 2,
    decisionSequence: 2,
  });
  const accepted = await applyDecision(original, forged, expected, trust, later);
  assert.equal((await evaluateDecision(accepted, expected, trust, later)).access, 'full');
  const independentTrust = {
    ...trust,
    revision: 2,
    keys: trust.keys.map((key) => ({ ...key, status: 'revoked' })),
  };
  const revoked = await evaluateDecision(accepted, expected, independentTrust, later);
  assert.equal(revoked.access, 'closed');
  assert.equal(revoked.state, 'reconciliation-required');
  assert.equal(
    (await evaluateDecision({ ...accepted, trustRevision: 2 }, expected, trust, later)).access,
    'closed',
    'An old trust bundle cannot reverse independent revocation',
  );
});

test('contractual expiry closes retained reads and only a newer licence can reopen', async () => {
  const token = await sign({ exp: now + 60, licenceExpiresAt: now + 60 });
  const state = await applyDecision(initialDecisionState(epoch), token, expected, trust, now);
  await assert.rejects(
    applyDecision(
      state,
      await denial('suspended', { policyRevision: 2, decisionSequence: 2 }),
      expected,
      trust,
      now,
    ),
    /Licence policy downgrade/,
  );
  assert.equal((await evaluateDecision(state, expected, trust, now + 59)).access, 'full');
  assert.deepEqual(await evaluateDecision(state, expected, trust, now + 60), {
    access: 'closed',
    state: 'licence-expired',
  });
  assert.equal((await evaluateDecision(state, expected, trust, now + 86400)).access, 'closed');
  await assert.rejects(
    verifyDecision(
      await sign({ exp: now + 61, licenceExpiresAt: now + 60 }),
      expected,
      epoch,
      trust,
      now,
    ),
  );
  await assert.rejects(
    applyDecision(
      state,
      await sign({ decisionSequence: 2, licenceExpiresAt: now + 120, exp: now + 120 }),
      expected,
      trust,
      now + 61,
    ),
  );
  const renewed = await applyDecision(
    state,
    await sign({
      policyRevision: 2,
      decisionSequence: 2,
      licenceExpiresAt: now + 120,
      exp: now + 120,
    }),
    expected,
    trust,
    now + 61,
  );
  assert.equal((await evaluateDecision(renewed, expected, trust, now + 61)).access, 'full');
  await assert.rejects(applyDecision(renewed, token, expected, trust, now + 61));
});
