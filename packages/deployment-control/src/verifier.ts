import { createHash } from 'node:crypto';
import {
  audience,
  type Binding,
  DECISION_TYPE,
  type Decision,
  decision,
  MAX_DECISION_SECONDS,
  sameBinding,
} from '@thaarei/control-plane-contracts';
import { compactVerify, decodeProtectedHeader, importSPKI } from 'jose';
import { z } from 'zod';
export const trustBundle = z
  .object({
    version: z.literal(1),
    revision: z.number().int().positive(),
    issuer: z.string().url(),
    keys: z
      .array(
        z
          .object({
            kid: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
            pem: z.string().min(100).max(8192),
            status: z.enum(['active', 'retired', 'revoked']),
            lastIssuedAt: z.number().int().positive().nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export type TrustBundle = z.infer<typeof trustBundle>;
export type Accepted = { token: string; digest: string; appliedAt: number };
export type DecisionState = {
  epoch: string;
  trustRevision: number;
  lastTime: number;
  quarantined: boolean;
  accepted: Accepted | null;
  activation: Accepted | null;
};
export function initialDecisionState(epoch: string): DecisionState {
  return {
    epoch,
    trustRevision: 0,
    lastTime: 0,
    quarantined: false,
    accepted: null,
    activation: null,
  };
}
export function tokenDigest(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
export async function verifyDecision(
  token: string,
  expected: Binding,
  epoch: string,
  rawTrust: TrustBundle,
  now: number,
  cached = false,
): Promise<Decision> {
  if (token.length > 8192) throw new Error('Decision too large');
  const trust = trustBundle.parse(rawTrust);
  const header = decodeProtectedHeader(token);
  if (
    header.alg !== 'RS256' ||
    header.typ !== DECISION_TYPE ||
    typeof header.kid !== 'string' ||
    Object.keys(header).some((k) => !['alg', 'typ', 'kid'].includes(k))
  )
    throw new Error('Invalid deployment header');
  const keys = trust.keys.filter((k) => k.kid === header.kid);
  const trusted = keys[0];
  if (keys.length !== 1 || !trusted || trusted.status === 'revoked')
    throw new Error('Untrusted deployment key');
  const key = await importSPKI(trusted.pem, 'RS256');
  const verified = await compactVerify(token, key, { algorithms: ['RS256'] });
  const value = decision.parse(JSON.parse(new TextDecoder().decode(verified.payload)));
  if (
    value.iss !== trust.issuer ||
    value.aud !== audience(expected) ||
    !sameBinding(value.binding, expected) ||
    value.epoch !== epoch
  )
    throw new Error('Deployment binding mismatch');
  if (
    value.nbf !== value.iat ||
    value.exp <= value.iat ||
    value.exp - value.iat > MAX_DECISION_SECONDS ||
    value.iat > now ||
    (!cached && value.exp <= now)
  )
    throw new Error('Deployment time invalid');
  if (
    trusted.status === 'retired' &&
    (trusted.lastIssuedAt === null || value.iat > trusted.lastIssuedAt)
  )
    throw new Error('Retired signing key');
  return value;
}
async function retained(
  proof: Accepted,
  expected: Binding,
  state: DecisionState,
  trust: TrustBundle,
  now: number,
) {
  if (proof.digest !== tokenDigest(proof.token)) throw new Error('Stored proof corrupt');
  const claims = await verifyDecision(proof.token, expected, state.epoch, trust, now, true);
  if (proof.appliedAt < claims.nbf || proof.appliedAt >= claims.exp || proof.appliedAt > now)
    throw new Error('Invalid application evidence');
  return claims;
}
export async function applyDecision(
  state: DecisionState,
  token: string,
  expected: Binding,
  trust: TrustBundle,
  now: number,
): Promise<DecisionState> {
  if (state.quarantined || now < state.lastTime || trust.revision < state.trustRevision)
    throw new Error('Deployment reconciliation required');
  const incoming = await verifyDecision(token, expected, state.epoch, trust, now);
  if (state.accepted) {
    const old = await retained(state.accepted, expected, state, trust, now);
    if (
      incoming.policyRevision < old.policyRevision ||
      (incoming.policyRevision === old.policyRevision &&
        incoming.decisionSequence < old.decisionSequence)
    )
      throw new Error('Stale deployment decision');
    if (
      incoming.decisionSequence <= old.decisionSequence &&
      incoming.policyRevision > old.policyRevision
    )
      throw new Error('Decision sequence regressed');
    if (incoming.policyRevision === old.policyRevision && incoming.state !== old.state)
      throw new Error('Policy state conflicts at equal revision');
    if (incoming.decisionSequence === old.decisionSequence) {
      if (tokenDigest(token) !== state.accepted.digest)
        throw new Error('Decision sequence conflict');
      return { ...state, lastTime: now, trustRevision: trust.revision };
    }
  }
  const accepted = { token, digest: tokenDigest(token), appliedAt: now };
  return {
    ...state,
    accepted,
    activation: incoming.state === 'approved' ? accepted : state.activation,
    lastTime: now,
    trustRevision: trust.revision,
  };
}
export type BusinessAccess = 'full' | 'existing-reads' | 'closed';
export async function evaluateDecision(
  state: DecisionState,
  expected: Binding,
  trust: TrustBundle,
  now: number,
): Promise<{ access: BusinessAccess; state: string }> {
  try {
    if (state.quarantined || now < state.lastTime || trust.revision < state.trustRevision)
      throw new Error('Recovery or clock quarantine');
    if (!state.accepted) return { access: 'closed', state: 'unapproved' };
    const current = await retained(state.accepted, expected, state, trust, now);
    let activated = false;
    if (state.activation)
      activated =
        (await retained(state.activation, expected, state, trust, now)).state === 'approved';
    if (current.state === 'approved' && current.exp > now)
      return { access: 'full', state: 'approved' };
    const expired = current.state === 'approved';
    return {
      access: activated && (expired || current.state === 'suspended') ? 'existing-reads' : 'closed',
      state: expired ? 'expired' : current.state,
    };
  } catch {
    return { access: 'closed', state: 'reconciliation-required' };
  }
}

// Trust is delivered by an independent operator/release channel; tokens cannot edit it.
export async function readProtectedTrust(path: string): Promise<TrustBundle> {
  const { lstat, readFile } = await import('node:fs/promises');
  const { isAbsolute } = await import('node:path');
  const file = await lstat(path);
  if (
    !isAbsolute(path) ||
    !file.isFile() ||
    file.mode & 0o022 ||
    file.size > 200000 ||
    ![0, process.getuid?.()].includes(file.uid)
  )
    throw new Error('Protected operator trust file required');
  return trustBundle.parse(JSON.parse(await readFile(path, 'utf8')));
}
