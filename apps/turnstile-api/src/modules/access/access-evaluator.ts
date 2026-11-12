import { createHash } from 'node:crypto';
import {
  type AssignmentScopeDto,
  COMPANY_ONLY_PERMISSIONS,
  PEOPLE_CATALOG_VERSION,
  PEOPLE_PERMISSIONS,
  type PeoplePermission,
  type UserAccessContextDto,
} from '@thaarei/turnstile-contracts';
import type { PoolClient } from 'pg';

export type AccessGrant = UserAccessContextDto['grants'][number];
type Unit = { id: string; parentId: string | null };
export type EffectiveAccess = {
  memberId: string | null;
  status: 'active' | 'suspended' | null;
  memberVersion: number | null;
  workspaceComplete: boolean | null;
  protectedAdministrator: boolean;
  context: UserAccessContextDto;
  units: ReadonlyMap<string, string | null>;
};

export function impliedPermissions(permissions: readonly PeoplePermission[]) {
  const names = new Set(permissions);
  if (names.has('turnstile:configuration:manage')) names.add('turnstile:units:manage');
  if (names.has('turnstile:units:manage')) names.add('turnstile:units:read');
  return PEOPLE_PERMISSIONS.filter((p) => names.has(p));
}

export function descendant(units: ReadonlyMap<string, string | null>, id: string, anchor: string) {
  let current: string | null | undefined = id;
  const visited = new Set<string>();
  while (current && !visited.has(current) && visited.size < 8) {
    if (current === anchor) return true;
    visited.add(current);
    current = units.get(current);
  }
  return false;
}

export function scopeKey(scope: AssignmentScopeDto) {
  return scope.kind === 'company'
    ? 'company'
    : `units:${scope.includeChildren}:${[...scope.unitIds].sort().join(',')}`;
}

export function hasShell(access: EffectiveAccess) {
  return (
    access.status === 'active' &&
    access.context.grants.some((g) => g.permissions.includes('turnstile:access'))
  );
}

// Keep action and scope paired per source. A broad shell-only assignment cannot
// broaden an unrelated, narrowly scoped units:manage assignment.
export function covers(
  access: EffectiveAccess,
  action: string,
  target: AssignmentScopeDto,
): boolean {
  if (!PEOPLE_PERMISSIONS.includes(action as PeoplePermission) || !hasShell(access)) return false;
  if (action === 'turnstile:access') return true;
  if (COMPANY_ONLY_PERMISSIONS.includes(action as PeoplePermission) && target.kind !== 'company')
    return false;
  const scopes = access.context.grants
    .filter((g) => impliedPermissions(g.permissions).includes(action as PeoplePermission))
    .map((g) => g.scope);
  if (scopes.some((s) => s.kind === 'company')) return true;
  if (target.kind === 'company') return false;
  return target.unitIds.every(
    (id) =>
      access.units.has(id) &&
      scopes.some(
        (scope) =>
          scope.kind === 'units' &&
          (!target.includeChildren || scope.includeChildren) &&
          scope.unitIds.some((anchor) =>
            scope.includeChildren ? descendant(access.units, id, anchor) : id === anchor,
          ),
      ),
  );
}

export function coversGrants(access: EffectiveAccess, grants: readonly AccessGrant[]) {
  return (
    hasShell(access) &&
    grants.every((g) =>
      g.permissions.every((p) => p === 'turnstile:access' || covers(access, p, g.scope)),
    )
  );
}

// One PostgreSQL statement snapshot. The caller may pass its locked transaction;
// never open another pool/transaction or cache positive authorization here.
export async function readAccess(
  client: PoolClient,
  tenantId: string,
  userId: string,
): Promise<EffectiveAccess> {
  const row = (
    await client.query<{
      revision: number;
      member_id: string | null;
      status: EffectiveAccess['status'];
      member_version: number | null;
      workspace_complete: boolean | null;
      protected_administrator: boolean;
      grants: AccessGrant[];
      units: Unit[];
    }>(
      `SELECT c.revision, m.id AS member_id, m.status, m.version AS member_version,
    (SELECT completed_at IS NOT NULL FROM turnstile.organization_configuration o
      WHERE o.tenant_id = c.tenant_id) AS workspace_complete,
    EXISTS (SELECT 1 FROM turnstile.access_assignment a JOIN turnstile.access_role r
      ON r.tenant_id = a.tenant_id AND r.id = a.role_id
      WHERE a.tenant_id = c.tenant_id AND a.member_id = m.id AND a.scope_kind = 'company'
        AND r.system_key = 'workspace_administrator') AS protected_administrator,
    coalesce((SELECT jsonb_agg(g.grant ORDER BY g.source_id) FROM (
      SELECT l.id AS source_id, jsonb_build_object('sourceId',l.id,'permissions',l.permissions,'scope',jsonb_build_object('kind','company')) AS grant
        FROM turnstile.access_legacy_source l WHERE l.tenant_id = c.tenant_id AND l.member_id = m.id AND NOT l.retired
      UNION ALL
      SELECT a.id, jsonb_build_object('sourceId',a.id,'permissions',
        (SELECT jsonb_agg(p.permission ORDER BY p.permission COLLATE "C") FROM turnstile.access_role_permission p
          WHERE p.tenant_id = a.tenant_id AND p.role_id = a.role_id),
        'scope', CASE WHEN a.scope_kind = 'company' THEN jsonb_build_object('kind','company') ELSE
          jsonb_build_object('kind','units','includeChildren',a.include_children,'unitIds',
            (SELECT jsonb_agg(s.unit_id ORDER BY s.unit_id) FROM turnstile.access_scope_anchor s
              WHERE s.tenant_id = a.tenant_id AND s.assignment_id = a.id)) END)
        FROM turnstile.access_assignment a WHERE a.tenant_id = c.tenant_id AND a.member_id = m.id
    ) g),'[]'::jsonb) AS grants,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'parentId',u.parent_id) ORDER BY u.id)
      FROM turnstile.organization_unit u WHERE u.tenant_id = c.tenant_id),'[]'::jsonb) AS units
    FROM turnstile.access_context c LEFT JOIN turnstile.access_member m
      ON m.tenant_id = c.tenant_id AND m.user_id = $2 WHERE c.tenant_id = $1`,
      [tenantId, userId],
    )
  ).rows[0];
  if (!row) throw new Error('Access import required');
  const units = new Map(row.units.map((u) => [u.id, u.parentId]));
  const grants = row.grants.map((grant) => ({
    ...grant,
    permissions: PEOPLE_PERMISSIONS.filter((p) => grant.permissions.includes(p)),
  }));
  // Bind to this actor's actual sources and live hierarchy only. Other members,
  // global revision increments and role display edits do not rotate the context.
  const fingerprintGrants = grants.map((g) => {
    const scope = g.scope;
    return {
      ...g,
      hierarchy:
        scope.kind === 'company'
          ? []
          : [...units.keys()]
              .filter(
                (id) =>
                  scope.kind === 'units' &&
                  scope.unitIds.some(
                    (anchor) =>
                      id === anchor || (scope.includeChildren && descendant(units, id, anchor)),
                  ),
              )
              .sort()
              .map((id) => {
                const path: string[] = [];
                let current: string | null | undefined = id;
                while (current && path.length < 8) {
                  path.push(current);
                  current = units.get(current);
                }
                return path;
              }),
    };
  });
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ tenantId, userId, status: row.status, grants: fingerprintGrants }))
    .digest('hex');
  return {
    memberId: row.member_id,
    memberVersion: row.member_version,
    workspaceComplete: row.workspace_complete,
    status: row.status,
    protectedAdministrator: row.status === 'active' && row.protected_administrator,
    context: {
      catalogVersion: PEOPLE_CATALOG_VERSION,
      accessRevision: row.revision,
      fingerprint,
      grants,
    },
    units,
  };
}

// Local DISTINCT subjects, never assignments or pending invitations. The fixed
// installation/configuration/access locks serialize all private mutations.
const localSubjects = `WITH sources AS (
    SELECT m.id,m.user_id, l.permissions, 'company'::text AS scope_kind, false AS protected
      FROM turnstile.access_member m JOIN turnstile.access_legacy_source l
      ON l.tenant_id = m.tenant_id AND l.member_id = m.id
      WHERE m.tenant_id = $1 AND m.status = 'active' AND NOT l.retired
    UNION ALL
    SELECT m.id,m.user_id,array_agg(p.permission),a.scope_kind,r.system_key = 'workspace_administrator'
      FROM turnstile.access_member m JOIN turnstile.access_assignment a ON a.tenant_id = m.tenant_id AND a.member_id = m.id
      JOIN turnstile.access_role r ON r.tenant_id = a.tenant_id AND r.id = a.role_id
      JOIN turnstile.access_role_permission p ON p.tenant_id = r.tenant_id AND p.role_id = r.id
      WHERE m.tenant_id = $1 AND m.status = 'active' GROUP BY m.id,m.user_id,a.id,a.scope_kind,r.system_key
  ), subjects AS (SELECT user_id,bool_or('turnstile:access' = ANY(permissions)) AS shell,
    bool_or(scope_kind = 'company' AND 'turnstile:configuration:manage' = ANY(permissions)) AS manager,
    bool_or(scope_kind = 'company' AND protected) AS administrator FROM sources GROUP BY user_id)`;

export async function accessCounts(client: PoolClient, tenantId: string) {
  const counts = (
    await client.query<{ administrators: number; managers: number }>(
      `${localSubjects} SELECT count(*) FILTER (WHERE shell AND administrator)::int AS administrators,
      count(*) FILTER (WHERE shell AND manager)::int AS managers FROM subjects`,
      [tenantId],
    )
  ).rows[0];
  if (!counts) throw new Error('Access counts unavailable');
  return counts;
}

export async function configurationManagerIds(client: PoolClient, tenantId: string) {
  return (
    await client.query<{ user_id: string }>(
      `${localSubjects} SELECT user_id FROM subjects
    WHERE shell AND manager ORDER BY user_id COLLATE "C" LIMIT 100`,
      [tenantId],
    )
  ).rows.map((row) => row.user_id);
}
