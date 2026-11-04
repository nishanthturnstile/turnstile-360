import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { AccessGrant } from './access-evaluator.js';

export type UnitParents = ReadonlyMap<string, string | null>;
export interface InvitationStructureImpact {
  ids: string[];
  grants: AccessGrant[];
  digest: string;
}

// UM-I07 implements this owning policy against its actionable approvals. All
// methods share the caller's locked transaction; no HTTP or delivery is allowed.
export abstract class StructureInvitationPolicy {
  abstract references(client: PoolClient, tenant: string, unit: string): Promise<boolean>;
  abstract impact(
    client: PoolClient,
    tenant: string,
    before: UnitParents,
    after: UnitParents,
  ): Promise<InvitationStructureImpact>;
  abstract invalidate(
    client: PoolClient,
    tenant: string,
    impact: InvitationStructureImpact,
  ): Promise<void>;
}

@Injectable()
export class ClosedStructureInvitations extends StructureInvitationPolicy {
  private async absent(client: PoolClient, tenant: string) {
    const result = await client.query<{ safe: boolean }>(
      `SELECT NOT public_writes_enabled
      AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'turnstile' AND c.relkind IN ('r','p') AND c.relname ILIKE '%invitation%') AS safe
      FROM turnstile.access_context WHERE tenant_id = $1`,
      [tenant],
    );
    if (!result.rows[0]?.safe) throw new Error('Invitation structure policy integration required');
  }
  async references(client: PoolClient, tenant: string, _unit: string) {
    await this.absent(client, tenant);
    return false;
  }
  async impact(
    client: PoolClient,
    tenant: string,
    _before: UnitParents,
    _after: UnitParents,
  ): Promise<InvitationStructureImpact> {
    await this.absent(client, tenant);
    return { ids: [], grants: [], digest: 'closed-no-invitations' };
  }
  async invalidate(client: PoolClient, tenant: string, impact: InvitationStructureImpact) {
    await this.absent(client, tenant);
    if (impact.ids.length) throw new Error('Invitation structure policy integration required');
  }
}
