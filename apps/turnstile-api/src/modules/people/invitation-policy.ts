import { createHash, randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import {
  type PeoplePermission,
  type ResolvedRoleAssignmentDto,
  type RoleAssignmentRequestDto,
  resolvedRoleAssignmentsSchema,
} from '@thaarei/turnstile-contracts';
import type { PoolClient } from 'pg';
import {
  type AccessGrant,
  covers,
  coversGrants,
  type EffectiveAccess,
} from '../access/access-evaluator.js';

export const hash = (value: unknown) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
export function unavailable(): never {
  throw new HttpException({ code: 'PEOPLE_UNAVAILABLE', reason: 'dependency' }, 503);
}
export function conflict(reason = 'state'): never {
  throw new HttpException({ code: 'PEOPLE_CONFLICT', reason }, 409);
}
export const denied = (): never => {
  throw new HttpException({ code: 'ACCESS_COVERAGE_DENIED' }, 403);
};
export const grants = (assignments: ResolvedRoleAssignmentDto[]): AccessGrant[] =>
  assignments.map((a) => ({ sourceId: a.id, permissions: a.role.permissions, scope: a.scope }));
export function ceiling(access: EffectiveAccess, assignments: ResolvedRoleAssignmentDto[]) {
  if (
    !covers(access, 'turnstile:people:manage', { kind: 'company' }) ||
    !coversGrants(access, grants(assignments))
  )
    denied();
  // Protected administrator assignment requires a current protected administrator.
  if (
    assignments.some((a) => a.role.systemKey === 'workspace_administrator') &&
    !access.protectedAdministrator
  )
    denied();
}
export async function resolveAssignments(
  db: PoolClient,
  tenant: string,
  input: RoleAssignmentRequestDto[],
  access: EffectiveAccess,
  enforceCeiling = true,
) {
  const assignments = [];
  for (const request of input) {
    const role = (
      await db.query<{
        id: string;
        version: number;
        permission_version: number;
        system_key: string | null;
        name: string;
        description: string | null;
        permissions: PeoplePermission[];
      }>(
        `SELECT r.*,ARRAY(SELECT permission FROM turnstile.access_role_permission p WHERE p.tenant_id=r.tenant_id AND p.role_id=r.id ORDER BY permission) AS permissions FROM turnstile.access_role r WHERE r.tenant_id=$1 AND r.id=$2`,
        [tenant, request.roleId],
      )
    ).rows[0];
    if (!role || role.version !== request.expectedRoleVersion) conflict('version');
    if (request.scope.kind === 'units') {
      const units = await db.query<{ id: string }>(
        "SELECT id FROM turnstile.organization_unit WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND type<>'organization'",
        [tenant, request.scope.unitIds],
      );
      if (units.rows.length !== request.scope.unitIds.length) conflict('reference_in_use');
    }
    assignments.push({
      id: randomUUID(),
      role: {
        id: role.id,
        version: role.version,
        permissionVersion: role.permission_version,
        systemKey: role.system_key,
        name: role.name,
        description: role.description,
        permissions: role.permissions,
      },
      scope: request.scope,
    });
  }
  const parsed = resolvedRoleAssignmentsSchema.safeParse(assignments);
  if (!parsed.success || !parsed.data.length) conflict('state');
  if (enforceCeiling) ceiling(access, parsed.data);
  return parsed.data;
}
export function digests(
  assignments: ResolvedRoleAssignmentDto[],
  authorityEpoch: string,
  recoveryEpoch: string,
) {
  return {
    permissionDigest: hash({
      authorityEpoch,
      recoveryEpoch,
      roles: assignments.map((a) => ({
        role: a.role.id,
        permissionVersion: a.role.permissionVersion,
        permissions: [...a.role.permissions].sort(),
      })),
    }),
    scopeDigest: hash(
      assignments.map((a) => ({
        role: a.role.id,
        scope:
          a.scope.kind === 'company'
            ? a.scope
            : { ...a.scope, unitIds: [...a.scope.unitIds].sort() },
      })),
    ),
  };
}
export async function invitationAudit(
  db: PoolClient,
  tenant: string,
  id: string,
  generation: number,
  action: string,
  actor?: string,
) {
  await db.query(
    'INSERT INTO turnstile.invitation_audit (tenant_id,id,invitation_id,generation,actor_kind,actor_id,action) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [tenant, randomUUID(), id, generation, actor ? 'user' : 'system', actor ?? null, action],
  );
}
