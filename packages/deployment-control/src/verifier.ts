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
import {
  type ModuleDecision,
  type VersionedDecision,
  validateDecisionContext,
  versionedDecision,
} from '@thaarei/module-catalog';
import { compactVerify, decodeProtectedHeader, importSPKI } from 'jose';
import { assertVerifiedModuleRelease, type VerifiedModuleRelease } from './module-release.js';
import { type TrustBundle, trustBundle } from './trust.js';

export { readProtectedTrust, type TrustBundle, trustBundle } from './trust.js';
export type Accepted = { token: string; digest: string; appliedAt: number };
export type DecisionState = {
  epoch: string;
  trustRevision: number;
  lastTime: number;
  quarantined: boolean;
  accepted: Accepted | null;
  activation: Accepted | null;
  // A durable floor survives missing runtime configuration and cannot be negotiated away.
  minimumVersion?: 2 | undefined;
  releaseTrustRevision?: number | undefined;
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
async function verifyEnvelope(
  token: string,
  expected: Binding,
  epoch: string,
  rawTrust: TrustBundle,
  now: number,
  cached = false,
): Promise<VersionedDecision> {
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
  const value = versionedDecision.parse(JSON.parse(new TextDecoder().decode(verified.payload)));
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

/** Legacy callers accept only the strict v1 product envelope. */
export async function verifyDecision(
  token: string,
  expected: Binding,
  epoch: string,
  trust: TrustBundle,
  now: number,
  cached = false,
): Promise<Decision> {
  return decision.parse(await verifyEnvelope(token, expected, epoch, trust, now, cached));
}
export async function verifyModuleDecision(
  token: string,
  expected: Binding,
  epoch: string,
  trust: TrustBundle,
  now: number,
  release: VerifiedModuleRelease,
  cached = false,
): Promise<ModuleDecision> {
  assertVerifiedModuleRelease(release);
  return validateDecisionContext(
    await verifyEnvelope(token, expected, epoch, trust, now, cached),
    release.request.catalogue,
    release.request.profile,
    release.releaseId,
  );
}
export async function verifyInstalledDecision(
  token: string,
  expected: Binding,
  epoch: string,
  trust: TrustBundle,
  now: number,
  release?: VerifiedModuleRelease,
  cached = false,
): Promise<VersionedDecision> {
  return release
    ? verifyModuleDecision(token, expected, epoch, trust, now, release, cached)
    : verifyDecision(token, expected, epoch, trust, now, cached);
}
// Renewal content is independent of object/ID ordering. Time, sequence and ID may renew;
// authority, active/desired context and the assignment that produced it may not.
function policyContent(value: VersionedDecision): string {
  if (value.version === 1 || value.state !== 'approved')
    return JSON.stringify({ version: value.version, state: value.state });
  const p = value.modulePolicy;
  return JSON.stringify({
    version: 2,
    state: value.state,
    active: [
      p.active.catalogueDigest,
      p.active.profileDigest,
      p.active.releaseId,
      p.active.assignmentRevision,
      p.active.policyRevision,
    ],
    change: p.changeAssignmentRevision,
    desired: [p.desired.catalogueDigest, p.desired.profileDigest, p.desired.assignmentRevision],
    allowed: [...p.allowedModuleIds].sort(),
  });
}

async function retained(
  proof: Accepted,
  expected: Binding,
  state: DecisionState,
  trust: TrustBundle,
  now: number,
) {
  if (proof.digest !== tokenDigest(proof.token)) throw new Error('Stored proof corrupt');
  const claims = await verifyEnvelope(proof.token, expected, state.epoch, trust, now, true);
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
  release?: VerifiedModuleRelease,
): Promise<DecisionState> {
  if (state.quarantined || now < state.lastTime || trust.revision < state.trustRevision)
    throw new Error('Deployment reconciliation required');
  if (state.minimumVersion === 2 && !release)
    throw new Error('Verified v2 release required; downgrade forbidden');
  if (release && release.trustRevision < (state.releaseTrustRevision ?? 0))
    throw new Error('Release trust downgrade requires reconciliation');
  const incoming = await verifyInstalledDecision(token, expected, state.epoch, trust, now, release);
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
    if (old.version > incoming.version) throw new Error('Decision downgrade forbidden');
    if (
      incoming.policyRevision === old.policyRevision &&
      policyContent(incoming) !== policyContent(old)
    )
      throw new Error('Policy content conflicts at equal revision');
    if (incoming.decisionSequence === old.decisionSequence) {
      if (tokenDigest(token) !== state.accepted.digest)
        throw new Error('Decision sequence conflict');
      return {
        ...state,
        ...(incoming.version === 2
          ? { minimumVersion: 2 as const, releaseTrustRevision: release?.trustRevision }
          : {}),
        lastTime: now,
        trustRevision: trust.revision,
      };
    }
  }
  const accepted = { token, digest: tokenDigest(token), appliedAt: now };
  return {
    ...state,
    ...(incoming.version === 2
      ? { minimumVersion: 2 as const, releaseTrustRevision: release?.trustRevision }
      : {}),
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
  release?: VerifiedModuleRelease,
): Promise<{ access: BusinessAccess; state: string }> {
  try {
    if (state.quarantined || now < state.lastTime || trust.revision < state.trustRevision)
      throw new Error('Recovery or clock quarantine');
    if (state.minimumVersion === 2 && !release) throw new Error('Verified v2 release missing');
    if (release && release.trustRevision < (state.releaseTrustRevision ?? 0))
      throw new Error('Release trust downgrade requires reconciliation');
    if (!state.accepted) return { access: 'closed', state: 'unapproved' };
    const current = await retained(state.accepted, expected, state, trust, now);
    // Context validation applies before any foundation read exception, including denial.
    await verifyInstalledDecision(
      state.accepted.token,
      expected,
      state.epoch,
      trust,
      now,
      release,
      true,
    );
    let activated = false;
    if (state.activation) {
      const activation = await retained(state.activation, expected, state, trust, now);
      // A historical v1 foundation activation is allowed; it never authorizes a module.
      if (activation.version === 2 && release)
        await validateDecisionContext(
          activation,
          release.request.catalogue,
          release.request.profile,
          release.releaseId,
        );
      activated = activation.state === 'approved';
    }
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

/** Business modules have no prior-activation read exception. Owning user/resource/local
 * enablement and product operation checks must still run after this deployment check. */
export async function evaluateModuleDecision(
  state: DecisionState,
  expected: Binding,
  trust: TrustBundle,
  now: number,
  release: VerifiedModuleRelease,
): Promise<{ allowedModuleIds: string[]; state: string }> {
  const product = await evaluateDecision(state, expected, trust, now, release);
  if (product.access !== 'full' || !state.accepted)
    return { allowedModuleIds: [], state: product.state };
  try {
    const current = await verifyModuleDecision(
      state.accepted.token,
      expected,
      state.epoch,
      trust,
      now,
      release,
    );
    return {
      allowedModuleIds: current.state === 'approved' ? current.modulePolicy.allowedModuleIds : [],
      state: current.state,
    };
  } catch {
    return { allowedModuleIds: [], state: 'reconciliation-required' };
  }
}
