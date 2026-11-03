import type { StructureUnit } from './structure-model.ts';

export const CHART_CARD = { width: 224, height: 112 } as const;

/** Automatic presentation coordinates only. Canonical parentage and sibling order are unchanged. */
export function layoutStructure(units: readonly StructureUnit[]) {
  const columns = new Map<string, number>();
  const children = new Map<string | null, StructureUnit[]>();
  const ids = new Set(units.map((unit) => unit.id));
  for (const unit of units) {
    const parent = unit.parentId && ids.has(unit.parentId) ? unit.parentId : null;
    const group = children.get(parent) ?? [];
    group.push(unit);
    children.set(parent, group);
  }
  function measure(unit: StructureUnit): number {
    const width = Math.max(
      1,
      (children.get(unit.id) ?? []).reduce((sum, child) => sum + measure(child), 0),
    );
    columns.set(unit.id, width);
    return width;
  }
  const roots = children.get(null) ?? [];
  const width = roots.reduce((sum, root) => sum + measure(root), 0) * 256 + 32;
  const positions = new Map<string, { x: number; y: number }>();
  let depth = 0;
  function place(unit: StructureUnit, start: number, level: number) {
    const span = columns.get(unit.id) ?? 1;
    positions.set(unit.id, { x: (start + span / 2) * 256 - 96, y: level * 176 + 32 });
    depth = Math.max(depth, level);
    let next = start;
    for (const child of children.get(unit.id) ?? []) {
      place(child, next, level + 1);
      next += columns.get(child.id) ?? 1;
    }
  }
  let next = 0;
  for (const root of roots) {
    place(root, next, 0);
    next += columns.get(root.id) ?? 1;
  }
  return { positions, width: Math.max(288, width), height: depth * 176 + 176 };
}
