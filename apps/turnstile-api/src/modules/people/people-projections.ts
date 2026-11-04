import {
  memberSchema,
  type ResolvedRoleAssignmentDto,
  roleDefinitionSchema,
} from '@thaarei/turnstile-contracts';
import type { PoolClient } from 'pg';
import { peopleFailure } from './people-store.service.js';
export async function roleRows(db: PoolClient, tenant: string) {
  const rows = await db.query(
    `SELECT r.*,ARRAY(SELECT permission FROM turnstile.access_role_permission p WHERE p.tenant_id=r.tenant_id AND p.role_id=r.id ORDER BY permission) AS permissions FROM turnstile.access_role r WHERE tenant_id=$1 ORDER BY r.name_key COLLATE "C",r.id`,
    [tenant],
  );
  return rows.rows.map((r) =>
    roleDefinitionSchema.parse({
      id: r.id,
      version: r.version,
      permissionVersion: r.permission_version,
      systemKey: r.system_key,
      name: r.name,
      description: r.description,
      permissions: r.permissions,
    }),
  );
}
export async function assignments(
  db: PoolClient,
  tenant: string,
  member: string,
): Promise<ResolvedRoleAssignmentDto[]> {
  const roles = await roleRows(db, tenant);
  const rows = await db.query(
    `SELECT a.*,ARRAY(SELECT unit_id FROM turnstile.access_scope_anchor s WHERE s.tenant_id=a.tenant_id AND s.assignment_id=a.id ORDER BY unit_id) AS anchors FROM turnstile.access_assignment a WHERE tenant_id=$1 AND member_id=$2 ORDER BY id`,
    [tenant, member],
  );
  return rows.rows.map((a) => {
    const role = roles.find((r) => r.id === a.role_id);
    if (!role) throw new Error('Missing role');
    return {
      id: a.id,
      role,
      scope:
        a.scope_kind === 'company'
          ? { kind: 'company' }
          : { kind: 'units', unitIds: a.anchors, includeChildren: a.include_children },
    };
  });
}
export async function memberRow(db: PoolClient, tenant: string, id: string) {
  const m = (
    await db.query(
      `SELECT m.*,d.state AS display_state,d.name,d.email,d.verified_at,d.checked_at,d.member_version AS display_version,
    l.version AS legacy_version,l.permissions AS legacy_permissions,l.retired FROM turnstile.access_member m
    LEFT JOIN turnstile.member_display d ON d.tenant_id=m.tenant_id AND d.member_id=m.id AND d.user_id=m.user_id
    LEFT JOIN turnstile.access_legacy_source l ON l.tenant_id=m.tenant_id AND l.member_id=m.id WHERE m.tenant_id=$1 AND m.id=$2`,
      [tenant, id],
    )
  ).rows[0];
  if (!m) return peopleFailure(404, 'PEOPLE_NOT_FOUND');
  const identity =
    m.display_state === 'deleted'
      ? { state: 'deleted', checkedAt: m.checked_at.toISOString() }
      : m.verified_at && m.name && m.email
        ? {
            state:
              m.checked_at.getTime() > Date.now() - 60000 && m.display_version === m.version
                ? 'fresh'
                : 'stale',
            name: m.name,
            email: m.email,
            verifiedAt: m.verified_at.toISOString(),
          }
        : { state: 'unavailable' };
  return memberSchema.parse({
    id: m.id,
    userId: m.user_id,
    version: m.version,
    status: m.status,
    identity,
    assignments: await assignments(db, tenant, id),
    legacySource: m.legacy_version
      ? {
          kind: 'legacy',
          version: m.legacy_version,
          permissions: m.legacy_permissions,
          retired: m.retired,
        }
      : null,
  });
}
