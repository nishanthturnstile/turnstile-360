import {
  CONFIGURATION_LIMITS,
  type ConfigurationSnapshotDto,
  configurationNameKey,
} from '@thaarei/turnstile-contracts';

export type StructureUnit = ConfigurationSnapshotDto['units'][number];
export function unitPath(units: readonly StructureUnit[], id: string) {
  const unit = units.find((item) => item.id === id);
  return unit
    ? [...unit.ancestorIds, id]
        .map((key) => units.find((item) => item.id === key)?.name ?? 'Unavailable')
        .join(' / ')
    : 'No longer available';
}
export function moveRestriction(
  units: readonly StructureUnit[],
  id: string,
  parentId: string,
  protectFirstUnit = false,
) {
  return createMoveValidator(units, protectFirstUnit)(id, parentId);
}

/** Index one canonical structure once; destination checks do not scan the full tree. */
export function createMoveValidator(units: readonly StructureUnit[], protectFirstUnit = false) {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const heights = new Map<string, number>();
  const nameKeys = new Map<string, string>();
  const siblings = new Map<string | null, Map<string, string>>();
  const root = units.find((unit) => unit.type === 'organization');
  let firstUnits = 0;
  for (const unit of units) {
    const key = configurationNameKey(unit.name);
    nameKeys.set(unit.id, key);
    const group = siblings.get(unit.parentId) ?? new Map<string, string>();
    group.set(key, unit.id);
    siblings.set(unit.parentId, group);
    if (unit.parentId === root?.id) firstUnits++;
    for (const [index, ancestor] of unit.ancestorIds.entries())
      heights.set(
        ancestor,
        Math.max(heights.get(ancestor) ?? 1, unit.ancestorIds.length - index + 1),
      );
  }
  return (id: string, parentId: string) => {
    const source = byId.get(id);
    const parent = byId.get(parentId);
    if (!source || !parent) return 'This unit is no longer available.';
    if (source.type === 'organization') return 'The organization cannot be moved.';
    if (id === parentId || parent.ancestorIds.some((ancestor) => ancestor === id))
      return 'A unit cannot move into itself or its descendants.';
    if (source.type === 'site' && parent.type !== 'organization')
      return 'A Site / Plant must stay directly under the organization.';
    if (source.parentId === parentId) return 'This is already the saved parent.';
    const height = heights.get(id) ?? 1;
    if (parent.ancestorIds.length + 1 + height > CONFIGURATION_LIMITS.depth)
      return 'The entire subtree must stay within eight levels.';
    const duplicate = siblings.get(parentId)?.get(nameKeys.get(id) as string);
    if (duplicate && duplicate !== id)
      return 'A unit with this name already exists at that destination.';
    if (
      protectFirstUnit &&
      source.parentId === root?.id &&
      parentId !== root?.id &&
      firstUnits === 1
    )
      return 'Keep at least one Site / Plant or Department directly under the organization.';
    return undefined;
  };
}
export function removalRestriction(
  units: readonly StructureUnit[],
  id: string,
  protectFirstUnit = false,
) {
  const unit = units.find((item) => item.id === id);
  if (!unit) return 'This unit is no longer available.';
  if (unit.type === 'organization') return 'The organization cannot be removed.';
  if (units.some((child) => child.parentId === id)) return 'Remove child units first.';
  const root = units.find((item) => item.type === 'organization');
  if (
    protectFirstUnit &&
    unit.parentId === root?.id &&
    !units.some((item) => item.id !== id && item.parentId === root?.id)
  )
    return 'Keep at least one Site / Plant or Department directly under the organization.';
  return undefined;
}
