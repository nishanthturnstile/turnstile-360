import {
  CONFIGURATION_LIMITS,
  organizationUnitSchema,
  type scopedUnitsResponseSchema,
} from '@thaarei/turnstile-contracts';
import type { StructureUnit } from '../configuration/structure-model.ts';
import { PeopleError } from './client.ts';

export type ScopedStructurePage = ReturnType<typeof scopedUnitsResponseSchema.parse>;
export type HierarchySnapshot = Omit<ScopedStructurePage, 'nextCursor'>;
export type HierarchyNode = StructureUnit & { context: boolean };

/** One cache entry is published only after all authorized pages agree on both revisions. */
export async function loadScopedHierarchy(
  read: (cursor: string | null, signal: AbortSignal) => Promise<ScopedStructurePage>,
  signal: AbortSignal,
  progress?: (value: { loaded: number; total: number }) => void,
): Promise<HierarchySnapshot> {
  const units = new Map<string, ScopedStructurePage['units'][number]>();
  const contexts = new Map<string, ScopedStructurePage['ancestors'][number]>();
  const cursors = new Set<string>();
  let first: ScopedStructurePage | undefined;
  let cursor: string | null = null;
  let pages = 0;
  do {
    signal.throwIfAborted();
    if (++pages > Math.ceil(CONFIGURATION_LIMITS.units / 100))
      throw new PeopleError(503, 'PEOPLE_RESPONSE_INVALID');
    const page = await read(cursor, signal);
    signal.throwIfAborted();
    if (
      first &&
      (page.revision !== first.revision ||
        page.accessRevision !== first.accessRevision ||
        page.total !== first.total)
    )
      throw new PeopleError(409, 'STRUCTURE_CONFLICT', 'revision');
    first ??= page;
    for (const row of [...page.ancestors, ...page.units]) {
      const previous = contexts.get(row.id) ?? units.get(row.id);
      if (previous && (previous.type !== row.type || previous.name !== row.name))
        throw new PeopleError(503, 'PEOPLE_RESPONSE_INVALID');
    }
    for (const row of page.units) {
      if (units.has(row.id)) throw new PeopleError(503, 'PEOPLE_RESPONSE_INVALID');
      units.set(row.id, row);
    }
    for (const row of page.ancestors) contexts.set(row.id, row);
    if (units.size > page.total || units.size > CONFIGURATION_LIMITS.units)
      throw new PeopleError(503, 'PEOPLE_RESPONSE_INVALID');
    progress?.({ loaded: units.size, total: page.total });
    cursor = page.nextCursor;
    if (cursor) {
      if (!page.units.length || cursors.has(cursor))
        throw new PeopleError(503, 'PEOPLE_RESPONSE_INVALID');
      cursors.add(cursor);
    }
  } while (cursor);
  if (!first || units.size !== first.total) throw new PeopleError(503, 'PEOPLE_RESPONSE_INVALID');
  const result = {
    revision: first.revision,
    accessRevision: first.accessRevision,
    total: first.total,
    units: [...units.values()],
    ancestors: [...contexts.values()].filter((row) => !units.has(row.id)),
  };
  // Validate shared path context as well as individual API pages before publishing the batch.
  hierarchyNodes(result);
  return result;
}

/** Explicit ancestry may supply geometry, never a mutation capability or an inferred sibling. */
export function hierarchyNodes(snapshot: HierarchySnapshot): HierarchyNode[] {
  const paths = new Map<string, string[]>();
  for (const unit of snapshot.units) {
    const chain = [...unit.ancestorIds, unit.id];
    for (let index = 0; index < chain.length; index++) {
      const id = chain[index];
      if (!id) continue;
      const ancestors = chain.slice(0, index);
      const previous = paths.get(id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(ancestors))
        throw new PeopleError(503, 'PEOPLE_RESPONSE_INVALID');
      paths.set(id, ancestors);
    }
  }
  const nodes: HierarchyNode[] = [...snapshot.ancestors, ...snapshot.units].map((row) => {
    const ancestors = paths.get(row.id);
    if (!ancestors) throw new PeopleError(503, 'PEOPLE_RESPONSE_INVALID');
    const canonical = organizationUnitSchema.safeParse({
      id: row.id,
      name: row.name,
      type: row.type,
      parentId: ancestors.at(-1) ?? null,
      ancestorIds: ancestors,
    });
    if (!canonical.success) throw new PeopleError(503, 'PEOPLE_RESPONSE_INVALID');
    return { ...canonical.data, context: 'actionable' in row };
  });
  if (
    nodes.length > CONFIGURATION_LIMITS.units ||
    new Set(nodes.map((n) => n.id)).size !== nodes.length
  )
    throw new PeopleError(503, 'PEOPLE_RESPONSE_INVALID');
  return nodes.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function visibleHierarchy(
  nodes: readonly HierarchyNode[],
  search: string,
  focusId: string | undefined,
  collapsed: ReadonlySet<string>,
  selectedId?: string,
) {
  const query = search.trim().toLocaleLowerCase();
  const included = new Set<string>();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    if (
      focusId &&
      node.id !== focusId &&
      !node.ancestorIds.some((ancestor) => ancestor === focusId)
    )
      continue;
    // Context is navigational; it must not become an invented search result.
    if (query && (node.context || !node.name.toLocaleLowerCase().includes(query))) continue;
    included.add(node.id);
    for (const id of node.ancestorIds) included.add(id);
  }
  const selected = byId.get(selectedId ?? '');
  return nodes.filter((node) => {
    if (!included.has(node.id)) return false;
    if (
      focusId &&
      node.id !== focusId &&
      !node.ancestorIds.some((ancestor) => ancestor === focusId)
    )
      return false;
    return (
      !!query ||
      !node.ancestorIds.some(
        (id) => collapsed.has(id) && !selected?.ancestorIds.some((ancestor) => ancestor === id),
      )
    );
  });
}
