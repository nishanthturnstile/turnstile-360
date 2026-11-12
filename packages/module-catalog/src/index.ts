import {
  activeContext,
  type Catalogue,
  catalogue,
  digest,
  type ErrorCode,
  type ModuleDecision,
  moduleDecision,
  moduleIds,
  type Profile,
  profile,
  resolution,
  selection,
} from './contracts.js';
import { deliveryEvidence, deliveryRequest } from './delivery.js';

export * from './contracts.js';

export class ModuleCatalogueError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = 'ModuleCatalogueError';
  }
}
function parseCatalogue(input: unknown): Catalogue {
  const parsed = catalogue.safeParse(input);
  if (!parsed.success) throw new ModuleCatalogueError('CATALOGUE_INVALID');
  return parsed.data;
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (ids: Iterable<string>) => [...ids].sort(compare);
export function canonicalCatalogue(input: unknown): string {
  const c = parseCatalogue(input);
  return JSON.stringify({
    version: c.version,
    id: c.id,
    sourceDigest: c.sourceDigest,
    platform: c.platform,
    contractVersion: c.contractVersion,
    migrationVersion: c.migrationVersion,
    modules: [...c.modules]
      .sort((a, b) => compare(a.id, b.id))
      .map((m) => ({
        id: m.id,
        label: m.label,
        version: m.version,
        category: m.category,
        requires: sorted(m.requires),
        optionalIntegrations: sorted(m.optionalIntegrations),
      })),
  });
}
async function sha256(value: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const catalogueDigest = (input: unknown) => sha256(canonicalCatalogue(input));
export function canonicalProfile(input: unknown): string {
  const p = profile.parse(input);
  return JSON.stringify({
    version: p.version,
    catalogueId: p.catalogueId,
    catalogueDigest: p.catalogueDigest,
    sourceDigest: p.sourceDigest,
    platform: p.platform,
    contractVersion: p.contractVersion,
    migrationVersion: p.migrationVersion,
    modules: [...p.modules]
      .sort((a, b) => compare(a.id, b.id))
      .map((m) => ({ id: m.id, version: m.version })),
  });
}
export const profileDigest = (input: unknown) => sha256(canonicalProfile(input));

/** Proposal only: dependencies are never silently approved. */
export function resolveSelection(input: unknown, request: unknown) {
  const c = parseCatalogue(input);
  const parsed = selection.safeParse(request);
  if (!parsed.success) throw new ModuleCatalogueError('SELECTION_INVALID');
  const definitions = new Map(c.modules.map((m) => [m.id, m]));
  const requested = new Set(parsed.data.requestedIndividualIds);
  if ([...requested].some((id) => definitions.get(id)?.category !== 'individual'))
    throw new ModuleCatalogueError('SELECTION_INVALID');
  const resolved = new Set(c.modules.filter((m) => m.category === 'core').map((m) => m.id));
  const add = (id: string) => {
    if (resolved.has(id)) return;
    resolved.add(id);
    for (const next of definitions.get(id)?.requires ?? []) add(next);
  };
  for (const id of requested) add(id);
  const ids = sorted(resolved);
  return resolution.parse({
    requestedIndividualIds: sorted(requested),
    resolvedIds: ids,
    additionalRequiredIds: ids.filter(
      (id) => definitions.get(id)?.category === 'individual' && !requested.has(id),
    ),
    optionalIntegrations: c.modules
      .filter((m) => resolved.has(m.id))
      .flatMap((m) =>
        m.optionalIntegrations
          .filter((id) => resolved.has(id))
          .map((id) => ({ from: m.id, to: id })),
      )
      .sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to)),
  });
}

export async function createProfile(
  input: unknown,
  request: unknown,
  confirmedIds: unknown,
): Promise<Profile> {
  const c = parseCatalogue(input);
  const result = resolveSelection(c, request);
  const confirmed = moduleIds.safeParse(confirmedIds);
  if (
    !confirmed.success ||
    JSON.stringify(sorted(confirmed.data)) !== JSON.stringify(result.resolvedIds)
  )
    throw new ModuleCatalogueError('DEPENDENCY_REVIEW_REQUIRED');
  return profile.parse({
    version: 1,
    catalogueId: c.id,
    catalogueDigest: await catalogueDigest(c),
    sourceDigest: c.sourceDigest,
    platform: c.platform,
    contractVersion: c.contractVersion,
    migrationVersion: c.migrationVersion,
    modules: c.modules
      .filter((m) => result.resolvedIds.includes(m.id))
      .sort((a, b) => compare(a.id, b.id))
      .map((m) => ({ id: m.id, version: m.version })),
  });
}

/** Uses active, not desired, dependencies. Caller must confirm this closure before committing. */
export function removalClosure(input: unknown, allowedIds: unknown, removedIds: unknown): string[] {
  const c = parseCatalogue(input);
  const allowed = moduleIds.parse(allowedIds),
    removed = moduleIds.parse(removedIds);
  const definitions = new Map(c.modules.map((m) => [m.id, m]));
  if (
    allowed.some((id) => !definitions.has(id)) ||
    c.modules.some((m) => m.category === 'core' && !allowed.includes(m.id)) ||
    removed.some((id) => !allowed.includes(id))
  )
    throw new ModuleCatalogueError('MODULE_SET_INVALID');
  if (allowed.some((id) => definitions.get(id)?.requires.some((dep) => !allowed.includes(dep))))
    throw new ModuleCatalogueError('MODULE_SET_INVALID');
  const closure = new Set(removed);
  for (let changed = true; changed; ) {
    changed = false;
    for (const m of c.modules)
      if (
        allowed.includes(m.id) &&
        !closure.has(m.id) &&
        m.requires.some((id) => closure.has(id))
      ) {
        closure.add(m.id);
        changed = true;
      }
  }
  if ([...closure].some((id) => definitions.get(id)?.category === 'core'))
    throw new ModuleCatalogueError('MODULE_SET_INVALID');
  return sorted(closure);
}

/** Structural/context validation only; never signature, time-now, epoch or revision authorization. */
export async function validateDecisionContext(
  raw: unknown,
  input: unknown,
  installed: unknown,
  expectedReleaseId: unknown,
): Promise<ModuleDecision> {
  const d = moduleDecision.parse(raw),
    c = parseCatalogue(input),
    p = profile.parse(installed);
  const modules = new Map(c.modules.map((m) => [m.id, m]));
  if (
    p.catalogueDigest !== (await catalogueDigest(c)) ||
    p.catalogueId !== c.id ||
    p.sourceDigest !== c.sourceDigest ||
    p.platform !== c.platform ||
    p.contractVersion !== c.contractVersion ||
    p.migrationVersion !== c.migrationVersion ||
    p.modules.some((m) => modules.get(m.id)?.version !== m.version) ||
    c.modules.some((m) => m.category === 'core' && !p.modules.some((v) => v.id === m.id)) ||
    p.modules.some((m) =>
      modules.get(m.id)?.requires.some((id) => !p.modules.some((v) => v.id === id)),
    )
  )
    throw new ModuleCatalogueError('CONTEXT_MISMATCH');
  if (d.state === 'approved') {
    const policy = d.modulePolicy;
    if (
      policy.active.releaseId !== digest.parse(expectedReleaseId) ||
      policy.active.catalogueDigest !== p.catalogueDigest ||
      policy.active.profileDigest !== (await profileDigest(p)) ||
      policy.allowedModuleIds.some((id) => !p.modules.some((m) => m.id === id)) ||
      c.modules.some((m) => m.category === 'core' && !policy.allowedModuleIds.includes(m.id)) ||
      policy.allowedModuleIds.some((id) =>
        modules.get(id)?.requires.some((dep) => !policy.allowedModuleIds.includes(dep)),
      )
    )
      throw new ModuleCatalogueError('CONTEXT_MISMATCH');
  }
  return d;
}

export * from './delivery.js';

/** Validate the exact shared resolver output, including Core promotion/dependency closure. */
export async function validateDeliveryRequest(raw: unknown) {
  const r = deliveryRequest.parse(raw);
  const individualIds = r.profile.modules
    .filter((m) => r.catalogue.modules.some((d) => d.id === m.id && d.category === 'individual'))
    .map((m) => m.id);
  const expected = await createProfile(
    r.catalogue,
    { requestedIndividualIds: individualIds },
    r.profile.modules.map((m) => m.id),
  );
  if (
    canonicalProfile(expected) !== canonicalProfile(r.profile) ||
    (await profileDigest(expected)) !== r.profileDigest
  )
    throw new ModuleCatalogueError('CONTEXT_MISMATCH');
  return r;
}
export async function deliveryRequestDigest(raw: unknown) {
  const r = await validateDeliveryRequest(raw);
  return sha256(
    JSON.stringify({
      version: 1,
      catalogue: JSON.parse(canonicalCatalogue(r.catalogue)),
      profile: JSON.parse(canonicalProfile(r.profile)),
      profileDigest: r.profileDigest,
    }),
  );
}
export async function deliveryReleaseId(raw: unknown) {
  const v = deliveryEvidence.parse(raw);
  return sha256(
    JSON.stringify({
      requestDigest: v.requestDigest,
      inventory: {
        ...v.inventory,
        releaseId: undefined,
        images: [...v.inventory.images].sort((a, b) => compare(a.role, b.role)),
      },
      artifactInventoryDigest: v.artifactInventoryDigest,
      documentationDigest: v.documentationDigest,
    }),
  );
}
/** Structural/context checks only; callers must independently verify signature and validity. */
export async function validateDeliveryEvidence(request: unknown, raw: unknown) {
  const r = await validateDeliveryRequest(request),
    v = deliveryEvidence.parse(raw),
    i = v.inventory;
  if (
    v.requestDigest !== (await deliveryRequestDigest(r)) ||
    i.catalogueDigest !== r.profile.catalogueDigest ||
    i.profileDigest !== r.profileDigest ||
    i.sourceDigest !== r.profile.sourceDigest ||
    i.platform !== r.profile.platform ||
    JSON.stringify(i.images.map((x) => x.role).sort()) !==
      JSON.stringify(['turnstile-api', 'turnstile-web']) ||
    i.releaseId !== (await deliveryReleaseId(v))
  )
    throw new ModuleCatalogueError('CONTEXT_MISMATCH');
  return v;
}

/** Review current authority, never target metadata, when narrowing an installed profile. */
export function reviewedRestriction(input: {
  catalogue: Catalogue;
  allowedIds: string[];
  targetIds: string[];
  explicitlyRemovedIds: string[];
  confirmedRemovalClosureIds: string[];
}) {
  const explicit = moduleIds.parse(input.explicitlyRemovedIds);
  const definitions = new Map(input.catalogue.modules.map((m) => [m.id, m]));
  if (explicit.some((id) => definitions.get(id)?.category !== 'individual'))
    throw new ModuleCatalogueError('MODULE_SET_INVALID');
  const omitted = input.allowedIds.filter(
    (id) => definitions.get(id)?.category === 'individual' && !input.targetIds.includes(id),
  );
  const closure = removalClosure(
    input.catalogue,
    input.allowedIds,
    explicit.filter((id) => input.allowedIds.includes(id)),
  );
  if (
    omitted.some((id) => !closure.includes(id)) ||
    JSON.stringify([...closure].sort()) !==
      JSON.stringify([...moduleIds.parse(input.confirmedRemovalClosureIds)].sort())
  )
    throw new ModuleCatalogueError('DEPENDENCY_REVIEW_REQUIRED');
  return input.allowedIds.filter((id) => !closure.includes(id)).sort();
}
export function sameActiveBasis(left: unknown, right: unknown) {
  return JSON.stringify(activeContext.parse(left)) === JSON.stringify(activeContext.parse(right));
}
