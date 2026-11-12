import {
  canonicalProfile,
  DELIVERY_AUDIENCE,
  DELIVERY_TYPE,
  type DeliveryRequest,
  validateDeliveryEvidence,
  validateDeliveryRequest,
} from '@thaarei/module-catalog';
import { compactVerify, decodeProtectedHeader, importSPKI } from 'jose';
import { type TrustBundle, trustBundle } from './trust.js';

const verifiedRelease = Symbol('verified-module-release');
const verifiedContexts = new WeakSet<object>();
/** Constructed only by signature verification against independently provisioned release trust. */
export type VerifiedModuleRelease = Readonly<{
  [verifiedRelease]: true;
  minimumDecisionVersion: 2;
  request: DeliveryRequest;
  releaseId: string;
  trustRevision: number;
}>;

/**
 * Release evidence is an immutable build proof, not a renewable business grant. Its original
 * bounded issuance window is checked; an installed release may outlive that window. Independent
 * key revocation still applies on every load. The installed profile comes from the trusted image,
 * never a sync response, status report, customer selection or an environment version switch.
 */
export async function verifyInstalledModuleRelease(
  token: string,
  rawRequest: unknown,
  installedProfile: unknown,
  rawTrust: TrustBundle,
  now: number,
): Promise<VerifiedModuleRelease> {
  if (token.length > 32768) throw new Error('Release evidence too large');
  const trust = trustBundle.parse(rawTrust);
  const header = decodeProtectedHeader(token);
  if (
    header.alg !== 'RS256' ||
    header.typ !== DELIVERY_TYPE ||
    Object.keys(header).some((k) => !['alg', 'typ', 'kid'].includes(k))
  )
    throw new Error('Invalid release header');
  const keys = trust.keys.filter((k) => k.kid === header.kid);
  const key = keys[0];
  if (keys.length !== 1 || !key || key.status === 'revoked')
    throw new Error('Untrusted release key');
  const verified = await compactVerify(token, await importSPKI(key.pem, 'RS256'), {
    algorithms: ['RS256'],
  });
  const { iss, aud, iat, nbf, exp, ...payload } = JSON.parse(
    new TextDecoder().decode(verified.payload),
  );
  if (
    iss !== trust.issuer ||
    aud !== DELIVERY_AUDIENCE ||
    !Number.isSafeInteger(iat) ||
    !Number.isSafeInteger(nbf) ||
    !Number.isSafeInteger(exp) ||
    iat <= 0 ||
    nbf < iat ||
    exp <= nbf ||
    exp - iat > 86400 ||
    nbf > now ||
    (key.status === 'retired' && (key.lastIssuedAt === null || iat > key.lastIssuedAt))
  )
    throw new Error('Invalid release evidence context');
  const request = await validateDeliveryRequest(rawRequest);
  if (canonicalProfile(request.profile) !== canonicalProfile(installedProfile))
    throw new Error('Installed profile differs from verified release');
  const evidence = await validateDeliveryEvidence(request, payload);
  // No caller may mutate a verified catalogue/profile into a different unsigned context.
  const freeze = <T>(value: T): T => {
    if (value && typeof value === 'object') {
      for (const entry of Object.values(value)) freeze(entry);
      Object.freeze(value);
    }
    return value;
  };
  const result: VerifiedModuleRelease = freeze({
    [verifiedRelease]: true as const,
    minimumDecisionVersion: 2 as const,
    request,
    releaseId: evidence.inventory.releaseId,
    trustRevision: trust.revision,
  });
  verifiedContexts.add(result);
  return result;
}
export function assertVerifiedModuleRelease(value: VerifiedModuleRelease) {
  if (!verifiedContexts.has(value)) throw new Error('Verified installed release required');
}
