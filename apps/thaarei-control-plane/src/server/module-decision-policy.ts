import type { Binding, Decision } from '@thaarei/control-plane-contracts';
import {
  deliveryRequest,
  installedModuleIdentity,
  modulePolicy,
  type VersionedDecision,
  validateDecisionContext,
  validateDeliveryRequest,
} from '@thaarei/module-catalog';
import { z } from 'zod';

export const moduleAuthorityDocument = z
  .object({
    version: z.literal(1),
    epoch: z.uuid(),
    request: deliveryRequest,
    policy: modulePolicy,
  })
  .strict();
/** Validates persisted authority, never promotes desired assignment or reported inventory. */
export async function moduleDecisionPolicy(
  base: { binding: Binding; epoch: string; policyRevision: number },
  state: Decision['state'],
  rawAuthority: unknown,
  reported: unknown,
): Promise<
  Pick<VersionedDecision, 'state'> & {
    modulePolicy?: z.infer<typeof modulePolicy>;
    entitlement?: 'product-business';
  }
> {
  if (state !== 'approved') return { state };
  if (rawAuthority === null) return { state: 'pending' };
  const authority = moduleAuthorityDocument.parse(rawAuthority);
  if (authority.epoch !== base.epoch) return { state: 'pending' };
  const installed = installedModuleIdentity.parse(reported);
  const p = modulePolicy.parse({
    ...authority.policy,
    active: { ...authority.policy.active, policyRevision: base.policyRevision },
  });
  if (
    installed.releaseId !== p.active.releaseId ||
    installed.profileDigest !== p.active.profileDigest ||
    installed.catalogueDigest !== p.active.catalogueDigest
  )
    throw new Error('Reported installed release differs from active authority');
  const request = await validateDeliveryRequest(authority.request);
  // This is the same strict context validator used by the installed verifier. Signature
  // issuance supplies the remaining envelope fields after this persisted policy check.
  await validateDecisionContext(
    {
      ...base,
      version: 2,
      iss: 'https://context.invalid',
      aud: 'context',
      decisionSequence: 1,
      decisionId: '00000000-0000-4000-8000-000000000001',
      iat: 1,
      nbf: 1,
      exp: 2,
      state: 'approved',
      entitlement: 'product-business',
      modulePolicy: p,
    },
    request.catalogue,
    request.profile,
    installed.releaseId,
  );
  return { state: 'approved', entitlement: 'product-business', modulePolicy: p };
}
