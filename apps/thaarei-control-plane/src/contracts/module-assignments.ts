import { binding } from '@thaarei/control-plane-contracts';
import {
  assignmentCommand,
  catalogue,
  deliveryInventory,
  digest,
  profile,
  revision,
} from '@thaarei/module-catalog';
import { z } from 'zod';
import { effectiveModuleAuthority, moduleObservation } from './module-transitions.ts';
import { policyState } from './registry.ts';

export const assignmentMutation = z
  .object({
    type: z.enum(['assignment.draft', 'assignment.approve']),
    command: assignmentCommand,
  })
  .strict();
export type AssignmentMutation = z.infer<typeof assignmentMutation>;
export const assignmentDocument = z
  .object({ command: assignmentCommand, profile, profileDigest: digest })
  .strict();
export const assignmentEntry = z
  .object({
    id: z.uuid(),
    kind: z.enum(['draft', 'approved']),
    revision,
    document: assignmentDocument,
    actorId: z.string(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const acknowledgedModules = z
  .object({
    epoch: z.uuid(),
    decisionId: z.uuid(),
    policyRevision: revision,
    decisionSequence: revision,
    appliedAt: z.iso.datetime(),
    receivedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    catalogueDigest: digest,
    profileDigest: digest,
    assignmentRevision: revision,
    allowedIds: z.array(z.string()).max(64),
  })
  .strict();
export const productHandover = z
  .object({
    product: z.enum(['dms', 'turnstile']),
    productId: z.uuid(),
    policyState,
    revision,
    paired: z.boolean(),
    acknowledged: z.boolean(),
    lastContactAt: z.iso.datetime().nullable(),
    reportReceivedAt: z.iso.datetime().nullable(),
    reportFreshness: z.enum(['never', 'current', 'stale']),
  })
  .strict();
export const assignmentStatus = z.enum([
  'unassigned',
  'awaiting-package',
  'ready-for-setup',
  'awaiting-activation',
  'awaiting-acknowledgement',
  'active',
  'restricted',
  'upgrade-required',
  'inventory-mismatch',
]);
export const assignmentView = z
  .object({
    binding,
    productRevision: revision,
    policyState,
    archived: z.boolean(),
    legacy: z.boolean(),
    minimumDecisionVersion: z.union([z.literal(1), z.literal(2)]),
    draft: assignmentEntry.nullable(),
    desired: assignmentEntry.nullable(),
    delivery: z
      .object({ adapter: z.literal('local-bundle'), key: digest, inventory: deliveryInventory })
      .strict()
      .nullable(),
    // These are independent reported/central facts; no projection grants runtime access.
    activeCatalogue: catalogue.nullable().default(null),
    authority: effectiveModuleAuthority.nullable().default(null),
    inventory: moduleObservation.nullable().default(null),
    observed: moduleObservation.nullable(),
    effective: acknowledgedModules.nullable(),
    handover: z
      .object({ authorityReady: z.boolean(), products: z.array(productHandover).max(2) })
      .strict(),
    statuses: z.array(assignmentStatus).max(8),
  })
  .strict();
export type AssignmentView = z.infer<typeof assignmentView>;
export type AssignmentEntry = z.infer<typeof assignmentEntry>;
export const assignmentCatalogueQuery = z.object({ after: z.uuid().optional() }).strict();
export const assignmentCatalogueList = z
  .object({
    catalogues: z
      .array(
        z
          .object({
            id: z.uuid(),
            digest,
            platform: z.string(),
            moduleCount: z.number().int().min(1).max(64),
          })
          .strict(),
      )
      .max(50),
    nextCursor: z.uuid().nullable(),
  })
  .strict();
export type AssignmentCatalogueList = z.infer<typeof assignmentCatalogueList>;

/** Read-model facts supplied by owning verified adapters, never by a staff command. */
export type AssignmentFacts = {
  desired: {
    catalogueDigest: string;
    profileDigest: string;
    revision: number;
    resolvedIds: string[];
  } | null;
  packageProfileDigest: string | null;
  observed: { catalogueDigest: string; profileDigest: string } | null;
  effective: {
    catalogueDigest: string;
    profileDigest: string;
    assignmentRevision: number;
    allowedIds: string[];
    expiresAt: number;
  } | null;
  legacy: boolean;
  policyState: z.infer<typeof policyState>;
  awaitingAcknowledgement?: boolean;
  restricted?: boolean;
};
/** Status describes delivery/access facts. It never grants or signs authority. */
export function deriveAssignmentStatuses(facts: AssignmentFacts, now: number) {
  const { desired, effective, observed } = facts;
  const result = new Set<z.infer<typeof assignmentStatus>>();
  if (!desired) return ['unassigned'] as const;
  const current =
    effective !== null && effective.expiresAt > now && facts.policyState === 'approved';
  const matches = (p: { catalogueDigest: string; profileDigest: string }) =>
    p.catalogueDigest === desired.catalogueDigest && p.profileDigest === desired.profileDigest;
  if (
    facts.restricted ||
    facts.policyState === 'suspended' ||
    facts.policyState === 'rejected' ||
    (effective && !current)
  )
    result.add('restricted');
  if (facts.packageProfileDigest !== desired.profileDigest) result.add('awaiting-package');
  if (facts.legacy || (observed && !matches(observed))) result.add('upgrade-required');
  if (
    observed &&
    !matches(observed) &&
    (!effective ||
      observed.catalogueDigest !== effective.catalogueDigest ||
      observed.profileDigest !== effective.profileDigest)
  )
    result.add('inventory-mismatch');
  if (!observed && !facts.legacy && facts.packageProfileDigest === desired.profileDigest)
    result.add('ready-for-setup');
  const complete =
    effective &&
    matches(effective) &&
    effective.assignmentRevision === desired.revision &&
    desired.resolvedIds.length === effective.allowedIds.length &&
    desired.resolvedIds.every((id) => effective.allowedIds.includes(id));
  if (effective && current && matches(effective) && !complete) result.add('restricted');
  if (observed && matches(observed) && !(current && complete))
    result.add(facts.awaitingAcknowledgement ? 'awaiting-acknowledgement' : 'awaiting-activation');
  if (observed && matches(observed) && current && complete) result.add('active');
  return [...result];
}
