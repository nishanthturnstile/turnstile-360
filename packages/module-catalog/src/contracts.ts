import {
  binding,
  decision as legacyDecision,
  origin,
  syncRequest,
  syncResponse,
} from '@thaarei/control-plane-contracts';
import { z } from 'zod';

export const moduleId = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
export const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const revision = z.number().int().positive().max(2147483647);
const exactVersion = z
  .string()
  .regex(/^[0-9]+\.[0-9]+\.[0-9]+$/)
  .max(32);
export const moduleIds = z
  .array(moduleId)
  .max(64)
  .refine((ids) => new Set(ids).size === ids.length, 'DUPLICATE_MODULE');
export const moduleDefinition = z
  .object({
    id: moduleId,
    label: z.string().trim().min(1).max(100),
    version: exactVersion,
    category: z.enum(['core', 'individual']),
    requires: moduleIds,
    optionalIntegrations: moduleIds,
  })
  .strict();
export const catalogue = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    sourceDigest: digest,
    platform: z.enum(['linux/amd64', 'linux/arm64']),
    contractVersion: revision,
    migrationVersion: revision,
    modules: z.array(moduleDefinition).min(1).max(64),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.modules.length > 64) return;
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    const definitions = new Map(value.modules.map((m) => [m.id, m]));
    if (definitions.size !== value.modules.length) fail('DUPLICATE_MODULE');
    if (!value.modules.some((m) => m.category === 'core')) fail('CORE_REQUIRED');
    if (definitions.get('foundation')?.category !== 'core') fail('FOUNDATION_REQUIRED');
    if (
      value.modules.reduce((n, m) => n + m.requires.length + m.optionalIntegrations.length, 0) > 512
    )
      fail('EDGE_LIMIT');
    for (const m of value.modules) {
      for (const id of [...m.requires, ...m.optionalIntegrations]) {
        if (!definitions.has(id)) fail('UNKNOWN_DEPENDENCY');
        if (id === m.id) fail('SELF_DEPENDENCY');
      }
      if (m.requires.some((id) => m.optionalIntegrations.includes(id))) fail('DUPLICATE_EDGE');
      if (
        m.category === 'core' &&
        m.requires.some((id) => definitions.get(id)?.category === 'individual')
      )
        fail('CORE_DEPENDS_ON_INDIVIDUAL');
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      for (const next of definitions.get(id)?.requires ?? []) if (visit(next)) return true;
      visiting.delete(id);
      visited.add(id);
      return false;
    };
    if (value.modules.some((m) => visit(m.id))) fail('DEPENDENCY_CYCLE');
  });
export type Catalogue = z.infer<typeof catalogue>;
export const selection = z.object({ requestedIndividualIds: moduleIds }).strict();
export const profile = z
  .object({
    version: z.literal(1),
    catalogueId: z.uuid(),
    catalogueDigest: digest,
    sourceDigest: digest,
    platform: z.enum(['linux/amd64', 'linux/arm64']),
    contractVersion: revision,
    migrationVersion: revision,
    modules: z
      .array(z.object({ id: moduleId, version: exactVersion }).strict())
      .min(1)
      .max(64),
  })
  .strict()
  .refine((p) => new Set(p.modules.map((m) => m.id)).size === p.modules.length, 'DUPLICATE_MODULE');
export type Profile = z.infer<typeof profile>;
export const activeContext = z
  .object({
    catalogueDigest: digest,
    profileDigest: digest,
    releaseId: digest,
    assignmentRevision: revision,
    policyRevision: revision,
  })
  .strict();
export const desiredContext = z
  .object({
    catalogueDigest: digest,
    profileDigest: digest,
    assignmentRevision: revision,
  })
  .strict();
export const assignmentCommand = z
  .object({
    version: z.literal(1),
    operationId: z.uuid(),
    expectedRevision: revision,
    binding,
    catalogueDigest: digest,
    requestedIndividualIds: moduleIds,
    confirmedResolvedIds: moduleIds,
    explicitlyRemovedIds: moduleIds,
    confirmedRemovalClosureIds: moduleIds,
    activeBasis: activeContext.nullable(),
    reason: z.string().trim().min(1).max(300),
  })
  .strict()
  .refine((v) => v.binding.product === 'turnstile', 'TURNSTILE_REQUIRED')
  .refine(
    (v) =>
      v.activeBasis !== null ||
      (v.explicitlyRemovedIds.length === 0 && v.confirmedRemovalClosureIds.length === 0),
    'ACTIVE_BASIS_REQUIRED',
  );

export const resolution = z
  .object({
    requestedIndividualIds: moduleIds,
    resolvedIds: moduleIds,
    additionalRequiredIds: moduleIds,
    optionalIntegrations: z.array(z.object({ from: moduleId, to: moduleId }).strict()).max(512),
  })
  .strict();
export const deliveryInventory = z
  .object({
    version: z.literal(1),
    catalogueDigest: digest,
    profileDigest: digest,
    sourceDigest: digest,
    releaseId: digest,
    platform: z.enum(['linux/amd64', 'linux/arm64']),
    images: z
      .array(z.object({ role: moduleId, digest }).strict())
      .min(2)
      .max(64),
    archiveDigest: digest,
    noticesDigest: digest,
    sourceInventoryDigest: digest,
  })
  .strict()
  .refine(
    (v) => new Set(v.images.map((i) => i.role)).size === v.images.length,
    'DUPLICATE_IMAGE_ROLE',
  );

const v2Base = legacyDecision.options[0].omit({ version: true, state: true, entitlement: true });
export const modulePolicy = z
  .object({
    active: activeContext,
    changeAssignmentRevision: revision,
    desired: desiredContext,
    allowedModuleIds: moduleIds,
  })
  .strict();
export const moduleDecision = z
  .discriminatedUnion('state', [
    v2Base
      .extend({
        version: z.literal(2),
        state: z.literal('approved'),
        entitlement: z.literal('product-business'),
        modulePolicy,
      })
      .strict(),
    v2Base.extend({ version: z.literal(2), state: z.literal('pending') }).strict(),
    v2Base.extend({ version: z.literal(2), state: z.literal('rejected') }).strict(),
    v2Base.extend({ version: z.literal(2), state: z.literal('suspended') }).strict(),
  ])
  .refine((v) => v.binding.product === 'turnstile', 'TURNSTILE_REQUIRED')
  .refine((v) => v.exp > v.nbf && v.nbf >= v.iat && v.exp - v.iat <= 7 * 86400, 'INVALID_VALIDITY')
  .refine(
    (v) => v.state !== 'approved' || v.modulePolicy.active.policyRevision === v.policyRevision,
    'POLICY_REVISION_MISMATCH',
  );
export type ModuleDecision = z.infer<typeof moduleDecision>;
export const INTENT_TYPE = 'thaarei-installation-intent+jwt';
export const INTENT_AUDIENCE = 'urn:thaarei:installer';
export const installationIntent = z
  .object({
    version: z.literal(1),
    iss: origin,
    aud: z.literal(INTENT_AUDIENCE),
    intentId: z.uuid(),
    intentRevision: revision,
    mode: z.enum(['fresh', 'adoption']),
    binding,
    dmsProductId: z.uuid(),
    desired: desiredContext,
    releaseId: digest,
    environment: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/),
    customerKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/),
    iat: z.number().int().nonnegative(),
    nbf: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
  })
  .strict()
  .refine(
    (v) => v.binding.product === 'turnstile' && v.dmsProductId !== v.binding.productId,
    'PRODUCT_BINDING_MISMATCH',
  )
  .refine((v) => v.exp > v.nbf && v.nbf >= v.iat && v.exp - v.iat <= 86400, 'INVALID_VALIDITY');

export const errorCode = z.enum([
  'CATALOGUE_INVALID',
  'SELECTION_INVALID',
  'DEPENDENCY_REVIEW_REQUIRED',
  'CONTEXT_MISMATCH',
  'MODULE_SET_INVALID',
]);
export type ErrorCode = z.infer<typeof errorCode>;
export const failure = z.object({ ok: z.literal(false), code: errorCode }).strict();

/** Inventory is product-reported context, never an authority or release attestation. */
export const installedModuleIdentity = z
  .object({ catalogueDigest: digest, profileDigest: digest, releaseId: digest })
  .strict();
export const moduleSyncRequest = z
  .object({ ...syncRequest.shape, version: z.literal(2), installed: installedModuleIdentity })
  .strict()
  .refine((v) => v.binding.product === 'turnstile', 'TURNSTILE_REQUIRED')
  .refine(
    ({ installed: _installed, ...v }) => syncRequest.safeParse({ ...v, version: 1 }).success,
    'INVALID_SYNC_CONTEXT',
  );
export const moduleSyncResponse = syncResponse
  .extend({ version: z.literal(2) })
  .refine((v) => v.binding.product === 'turnstile', 'TURNSTILE_REQUIRED');
export const versionedSyncRequest = z.union([syncRequest, moduleSyncRequest]);
export const versionedSyncResponse = z.union([syncResponse, moduleSyncResponse]);
export const versionedDecision = z.union([legacyDecision, moduleDecision]);
export type VersionedDecision = z.infer<typeof versionedDecision>;
export type VersionedSyncResponse = z.infer<typeof versionedSyncResponse>;
