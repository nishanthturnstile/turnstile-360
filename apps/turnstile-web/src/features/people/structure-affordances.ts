import { CONFIGURATION_LIMITS, type UserSessionDto } from '@thaarei/turnstile-contracts';
import { createMoveValidator } from '../configuration/structure-model.ts';
import { canManageUnit, company } from './client.ts';
import type { HierarchyNode } from './structure-hierarchy.ts';

export const canManageRoot = (session: UserSessionDto) =>
  company(session, 'turnstile:configuration:manage') || company(session, 'turnstile:units:manage');

/** Child creation needs descendant coverage; exact-unit management is insufficient. */
export function canManageChildren(session: UserSessionDto, node: HierarchyNode) {
  if (node.context && node.type !== 'organization') return false;
  if (canManageRoot(session)) return true;
  if (node.context) return false;
  return session.access.grants.some(
    (g) =>
      g.permissions.includes('turnstile:units:manage') &&
      g.scope.kind === 'units' &&
      g.scope.includeChildren &&
      g.scope.unitIds.some(
        (id) => id === node.id || node.ancestorIds.some((ancestor) => ancestor === id),
      ),
  );
}
export function canAddBelow(session: UserSessionDto, node: HierarchyNode, visibleNodes = 0) {
  return (
    node.ancestorIds.length + 1 < CONFIGURATION_LIMITS.depth &&
    visibleNodes < CONFIGURATION_LIMITS.units &&
    canManageChildren(session, node)
  );
}
export function canEditUnit(session: UserSessionDto, node: HierarchyNode) {
  return !node.context && canManageUnit(session, node.id, node.ancestorIds);
}
export function createDestinationValidator(
  session: UserSessionDto,
  nodes: readonly HierarchyNode[],
  sourceId: string,
) {
  const validate = createMoveValidator(nodes);
  const source = nodes.find((n) => n.id === sourceId);
  const oldParent = nodes.find((n) => n.id === source?.parentId);
  const companyManager = canManageRoot(session);
  const branchManaged = !nodes.some(
    (n) => n.ancestorIds.some((ancestor) => ancestor === sourceId) && !canEditUnit(session, n),
  );
  return (target: HierarchyNode) => {
    if (!source) return 'This unit is no longer available.';
    const restriction = validate(sourceId, target.id);
    if (restriction) return restriction;
    if (target.type === 'organization') {
      if (!companyManager) return 'Managing the organization is required for this destination.';
    } else if (!canEditUnit(session, target)) return 'You do not manage this destination.';
    if (!canEditUnit(session, source)) return 'You do not manage this unit.';
    if (
      !oldParent ||
      (oldParent.type === 'organization' ? !companyManager : !canEditUnit(session, oldParent))
    )
      return 'Managing the current parent is required to move this unit.';
    if (!branchManaged) return 'Managing the entire visible branch is required.';
    if (
      !companyManager &&
      !session.access.grants.some(
        (g) =>
          g.permissions.includes('turnstile:units:manage') &&
          g.scope.kind === 'units' &&
          g.scope.includeChildren &&
          g.scope.unitIds.some(
            (id) =>
              (id === oldParent.id || oldParent.ancestorIds.some((ancestor) => ancestor === id)) &&
              (id === target.id || target.ancestorIds.some((ancestor) => ancestor === id)),
          ),
      )
    )
      return 'The current and new parent must share managed descendant coverage.';
    return undefined;
  };
}
export function knownDeleteRestriction(nodes: readonly HierarchyNode[], id: string) {
  if (nodes.some((n) => n.parentId === id))
    return 'This unit has visible child units. Move or remove its children first.';
  return undefined;
}
