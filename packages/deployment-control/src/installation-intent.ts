import assert from 'node:assert/strict';
import { type Binding, sameBinding } from '@thaarei/control-plane-contracts';
import { INTENT_AUDIENCE, INTENT_TYPE, installationIntent } from '@thaarei/module-catalog';
import { compactVerify, decodeProtectedHeader, importSPKI } from 'jose';
import { trustBundle } from './trust.js';

/** Private installer verifier. Public intent metadata never supplies pairing or artifact pull authority. */
export async function verifyInstallationIntent(
  token: string,
  rawTrust: unknown,
  expected: {
    binding: Binding;
    dmsProductId: string;
    profileDigest: string;
    assignmentRevision: number;
    intentRevision: number;
    releaseId: string;
  },
  now = Math.floor(Date.now() / 1000),
) {
  assert.ok(typeof token === 'string' && token.length <= 16384, 'Bounded signed intent required');
  const trust = trustBundle.parse(rawTrust),
    header = decodeProtectedHeader(token);
  assert.ok(
    new URL(trust.issuer).protocol === 'https:' && new URL(trust.issuer).origin === trust.issuer,
    'Canonical HTTPS issuer required',
  );
  assert.ok(
    header.alg === 'RS256' &&
      header.typ === INTENT_TYPE &&
      Object.keys(header).every((k) => ['alg', 'typ', 'kid'].includes(k)),
    'Invalid intent signing header',
  );
  const keys = trust.keys.filter((k) => k.kid === header.kid);
  const key = keys[0];
  assert.ok(keys.length === 1 && key && key.status !== 'revoked', 'Unknown or revoked intent key');
  const proof = await compactVerify(token, await importSPKI(key.pem, 'RS256'), {
    algorithms: ['RS256'],
  });
  const value = installationIntent.parse(JSON.parse(new TextDecoder().decode(proof.payload)));
  assert.ok(
    Number.isInteger(now) &&
      value.iss === trust.issuer &&
      value.aud === INTENT_AUDIENCE &&
      value.iat <= now &&
      value.nbf <= now &&
      value.exp > now,
    'Expired or invalid intent authority',
  );
  assert.ok(
    key.status !== 'retired' || (key.lastIssuedAt !== null && value.iat <= key.lastIssuedAt),
    'Intent issued after key retirement',
  );
  assert.ok(
    sameBinding(value.binding, expected.binding) &&
      value.dmsProductId === expected.dmsProductId &&
      value.desired.profileDigest === expected.profileDigest &&
      value.desired.assignmentRevision === expected.assignmentRevision &&
      value.intentRevision === expected.intentRevision &&
      value.releaseId === expected.releaseId,
    'Intent installation or package mismatch',
  );
  return value;
}
