import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeJwt, importPKCS8, SignJWT } from 'jose';

export async function verifyOfflineImage({
  image,
  run,
  temporary,
  signerFile,
  state,
  binding,
  trust,
}) {
  if (!image) return;
  const folder = join(temporary, 'offline-verifier');
  await mkdir(folder, { mode: 0o700 });
  const claims = decodeJwt(state.accepted.token),
    later = claims.exp + 10;
  const signer = JSON.parse(await readFile(signerFile, 'utf8'));
  // The key remains on the central fixture host. Only public proofs/trust enter the customer image.
  const forged = await new SignJWT({
    ...claims,
    iat: later,
    nbf: later,
    exp: later + 604800,
    policyRevision: claims.policyRevision + 100,
    decisionSequence: claims.decisionSequence + 100,
    decisionId: randomUUID(),
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'thaarei-deployment+jwt', kid: signer.kid })
    .sign(await importPKCS8(signer.privateKey, 'RS256'));
  const proofFile = join(folder, 'proof.json'),
    trustFile = join(folder, 'trust.json');
  await writeFile(proofFile, JSON.stringify({ state, binding, later, forged }), { mode: 0o600 });
  await writeFile(trustFile, JSON.stringify(trust), { mode: 0o600 });
  const execute = async (mode) =>
    JSON.parse(
      await run('docker', [
        'run',
        '--rm',
        '--network',
        'none',
        '--read-only',
        '--tmpfs',
        '/tmp',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges:true',
        '--mount',
        `type=bind,source=${folder},target=/run/offline,readonly`,
        '--entrypoint',
        'node',
        image,
        '--input-type=module',
        '-e',
        `import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import{readProtectedTrust,evaluateDecision,applyDecision}from'@thaarei/deployment-control';const proof=JSON.parse(await readFile('/run/offline/proof.json','utf8')),trust=await readProtectedTrust('/run/offline/trust.json');if(process.argv[1]==='initial'){const original=await evaluateDecision(proof.state,proof.binding,trust,proof.later);assert.equal(original.access,'existing-reads');const state=await applyDecision(proof.state,proof.forged,proof.binding,trust,proof.later);assert.equal((await evaluateDecision(state,proof.binding,trust,proof.later)).access,'full');console.log(JSON.stringify({state}));}else{assert.equal((await evaluateDecision(proof.state,proof.binding,trust,proof.later)).access,'closed');console.log(JSON.stringify({closed:true}));}`,
        mode,
      ]),
    );
  const accepted = await execute('initial');
  await writeFile(proofFile, JSON.stringify({ state: accepted.state, binding, later }), {
    mode: 0o600,
  });
  // Independent protected operator delivery, followed by container recreation, never token-selected trust.
  await writeFile(
    trustFile,
    JSON.stringify({
      ...trust,
      revision: trust.revision + 1,
      keys: trust.keys.map((key) => ({ ...key, status: 'revoked' })),
    }),
    { mode: 0o600 },
  );
  assert.equal((await execute('revoked')).closed, true);
  console.log(
    'Offline customer image verifier: controlled-clock expiry, forged renewal by a compromised trusted key, protected independent trust-file revocation and container recreation passed (library path, not product HTTP).',
  );
}
