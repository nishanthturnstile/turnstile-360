import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import {
  decodeJwt,
  decodeProtectedHeader,
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  importPKCS8,
  SignJWT,
} from 'jose';
import { applyDecision } from '../../packages/deployment-control/dist/index.js';

// Real central signing-file rollover; malicious state is installed only through the fixture owner.
// Customer status must execute the unchanged packaged HTTP handler and verifier.
export async function verifyProductKeyRecovery({
  signerFile,
  trust,
  trustFile,
  loadState,
  saveState,
  status,
  sync,
  rebind,
  centralUnavailable,
}) {
  const installKey = async () => {
    const pair = await generateKeyPair('RS256', { extractable: true });
    const kid = `qualification-${randomUUID()}`;
    trust.revision++;
    trust.keys.push({
      kid,
      pem: await exportSPKI(pair.publicKey),
      status: 'active',
      lastIssuedAt: null,
    });
    await writeFile(trustFile, JSON.stringify(trust), { mode: 0o600 });
    await writeFile(
      signerFile,
      JSON.stringify({ kid, privateKey: await exportPKCS8(pair.privateKey) }),
      { mode: 0o600 },
    );
    return kid;
  };
  const previous = JSON.parse(await readFile(signerFile, 'utf8')).kid;
  const kid = await installKey();
  await sync();
  let { state, binding } = await loadState();
  assert.equal(
    decodeProtectedHeader(state.accepted.token).kid,
    kid,
    'Actual central sync must switch to the staged signer',
  );
  assert.equal((await status()).access, 'full');
  trust.revision++;
  Object.assign(
    trust.keys.find((key) => key.kid === previous),
    { status: 'retired', lastIssuedAt: Math.floor(Date.now() / 1000) },
  );
  await writeFile(trustFile, JSON.stringify(trust), { mode: 0o600 });
  assert.equal((await status()).access, 'full', 'Normal retirement preserves the new approval');
  await centralUnavailable(async () => {
    const signer = JSON.parse(await readFile(signerFile, 'utf8'));
    const now = Math.floor(Date.now() / 1000);
    const claims = decodeJwt(state.accepted.token);
    const forged = await new SignJWT({
      ...claims,
      iat: now,
      nbf: now,
      exp: now + 604800,
      policyRevision: claims.policyRevision + 100,
      decisionSequence: claims.decisionSequence + 100,
      decisionId: randomUUID(),
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'thaarei-deployment+jwt', kid })
      .sign(await importPKCS8(signer.privateKey, 'RS256'));
    state = await applyDecision(state, forged, binding, trust, now);
    await saveState(state);
    assert.equal(
      (await status()).access,
      'full',
      'A compromised still-trusted signer can forge fresh approvals',
    );
    trust.revision++;
    trust.keys.find((key) => key.kid === kid).status = 'revoked';
    await writeFile(trustFile, JSON.stringify(trust), { mode: 0o600 });
    assert.equal(
      (await status()).access,
      'closed',
      'Independent offline trust delivery must close actual product HTTP',
    );
  });
  await installKey();
  await rebind('Isolated compromised signing-key recovery');
  assert.equal(
    (await status()).access,
    'full',
    'Fresh epoch and explicit approval recover the packaged product',
  );
  console.log(
    'Packaged product HTTP: real central key rollover/retirement, offline forged renewal, independent revocation, fresh-key rebind and explicit reapproval passed.',
  );
}
