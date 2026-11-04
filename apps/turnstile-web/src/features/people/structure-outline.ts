import type { scopedUnitsResponseSchema } from '@thaarei/turnstile-contracts';

type Snapshot = ReturnType<typeof scopedUnitsResponseSchema.parse>;
export type OutlineNode = {
  id: string;
  name: string;
  type: 'organization' | 'site' | 'department';
  actionable: boolean;
  children: OutlineNode[];
};

/** Build only the returned page and its explicit path context. Never infer hidden siblings. */
export function structureOutline(snapshot: Snapshot): OutlineNode[] {
  const nodes = new Map<string, OutlineNode>();
  for (const row of [...snapshot.ancestors, ...snapshot.units])
    nodes.set(row.id, { ...row, actionable: !('actionable' in row), children: [] });
  const parents = new Map<string, string>();
  for (const unit of snapshot.units) {
    const chain = [...unit.ancestorIds, unit.id];
    chain.forEach((id, index) => {
      const parent = chain[index - 1];
      if (parent) parents.set(id, parent);
    });
  }
  const roots: OutlineNode[] = [];
  for (const node of nodes.values()) {
    const parentId = parents.get(node.id);
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (rows: OutlineNode[]) => {
    rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    for (const row of rows) sort(row.children);
  };
  sort(roots);
  return roots;
}
