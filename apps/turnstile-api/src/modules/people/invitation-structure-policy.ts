import { Global, Injectable, Module } from '@nestjs/common';
import { type ResolvedRoleAssignmentDto } from '@thaarei/turnstile-contracts';
import type { PoolClient } from 'pg';
import { descendant, impliedPermissions } from '../access/access-evaluator.js';
import {
  type InvitationStructureImpact,
  StructureInvitationPolicy,
  type UnitParents,
} from '../access/structure-invitations.js';
import { grants, hash } from './invitation-policy.js';
@Injectable()
export class OwningStructureInvitations extends StructureInvitationPolicy {
  async references(db: PoolClient, tenant: string, unit: string) {
    return (
      (
        await db.query(
          "SELECT 1 FROM turnstile.invitation_reference r JOIN turnstile.invitation i ON i.tenant_id=r.tenant_id AND i.id=r.invitation_id WHERE r.tenant_id=$1 AND r.unit_id=$2 AND i.state IN ('pending','needs_reapproval')",
          [tenant, unit],
        )
      ).rowCount !== 0
    );
  }
  async impact(
    db: PoolClient,
    tenant: string,
    before: UnitParents,
    after: UnitParents,
  ): Promise<InvitationStructureImpact> {
    const rows = (
      await db.query<{ id: string; generation: number; assignments: ResolvedRoleAssignmentDto[] }>(
        "SELECT id,generation,assignments FROM turnstile.invitation WHERE tenant_id=$1 AND state IN ('pending','needs_reapproval') AND expires_at>statement_timestamp() ORDER BY id LIMIT 1001",
        [tenant],
      )
    ).rows;
    if (rows.length > 1000) throw new Error('Invitation impact capacity');
    const actions = ['turnstile:units:read', 'turnstile:units:manage'] as const;
    const effective = (
      assignments: ResolvedRoleAssignmentDto[],
      units: UnitParents,
      id: string,
      action: (typeof actions)[number],
    ) =>
      assignments.some(
        (a) =>
          impliedPermissions(a.role.permissions).includes(action) &&
          (a.scope.kind === 'company' ||
            a.scope.unitIds.some(
              (anchor) =>
                a.scope.kind === 'units' &&
                (anchor === id || (a.scope.includeChildren && descendant(units, id, anchor))),
            )),
      );
    const impacted = rows.filter((row) =>
      actions.some((action) =>
        [...before.keys()].some(
          (id) =>
            effective(row.assignments, before, id, action) !==
            effective(row.assignments, after, id, action),
        ),
      ),
    );
    return {
      ids: impacted.map((r) => r.id),
      grants: impacted.flatMap((r) => grants(r.assignments)),
      digest: hash(impacted),
    };
  }
  async invalidate(db: PoolClient, tenant: string, impact: InvitationStructureImpact) {
    await db.query('SELECT turnstile.invalidate_invitations($1,$2)', [tenant, impact.ids]);
  }
}
// Composition-only global binding keeps Access independent of People modules and avoids a forwardRef cycle.
@Global()
@Module({
  providers: [{ provide: StructureInvitationPolicy, useClass: OwningStructureInvitations }],
  exports: [StructureInvitationPolicy],
})
export class InvitationPolicyBindingsModule {}
