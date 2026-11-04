import { randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { type PeoplePermission, scopedMoveImpactSchema } from '@thaarei/turnstile-contracts';
import type { PoolClient } from 'pg';
import type { ConfigurationActor } from '../../infrastructure/configuration-context.js';
import { StructureException } from '../../infrastructure/structure-http.js';
import {
  type AccessGrant,
  covers,
  coversGrants,
  descendant,
  type EffectiveAccess,
} from './access-evaluator.js';
import { commandDigest } from './access-transactions.js';
import {
  type InvitationStructureImpact,
  StructureInvitationPolicy,
} from './structure-invitations.js';

export interface StructureAccessContext {
  client: PoolClient;
  tenantId: string;
  actor: ConfigurationActor;
  access: EffectiveAccess;
  organizationRevision: number;
}
export interface StructureMoveImpact {
  members: string[];
  invitations: InvitationStructureImpact;
  changed: boolean;
  ceiling: boolean;
  digest: string;
}

@Injectable()
export class StructureAccessService {
  constructor(private readonly invitations: StructureInvitationPolicy) {}

  async referenced(tx: StructureAccessContext, unit: string) {
    const row = await tx.client.query<{ used: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM turnstile.access_scope_anchor WHERE tenant_id=$1 AND unit_id=$2) AS used`,
      [tx.tenantId, unit],
    );
    return row.rows[0]?.used || (await this.invitations.references(tx.client, tx.tenantId, unit));
  }

  async assess(
    tx: StructureAccessContext,
    source: string,
    parent: string,
  ): Promise<StructureMoveImpact> {
    const before = tx.access.units;
    const after = new Map(before);
    after.set(source, parent);
    const ancestors = (units: ReadonlyMap<string, string | null>, id: string) => {
      const result: string[] = [];
      let current = units.get(id);
      while (current && result.length < 8) {
        result.push(current);
        current = units.get(current);
      }
      return result;
    };
    const old = ancestors(before, source),
      next = ancestors(after, source);
    const changedAnchors = [...new Set([...old, ...next])].filter(
      (id) => old.includes(id) !== next.includes(id),
    );
    const rows = changedAnchors.length
      ? (
          await tx.client.query<{
            id: string;
            status: 'active' | 'suspended';
            grants: AccessGrant[];
          }>(
            `
      WITH candidates AS (SELECT DISTINCT m.id,m.status FROM turnstile.access_member m
        JOIN turnstile.access_assignment a ON a.tenant_id=m.tenant_id AND a.member_id=m.id
        JOIN turnstile.access_scope_anchor s ON s.tenant_id=a.tenant_id AND s.assignment_id=a.id
        WHERE m.tenant_id=$1 AND a.include_children AND s.unit_id=ANY($2::uuid[]) ORDER BY m.id LIMIT 1001)
      SELECT c.id,c.status,coalesce(jsonb_agg(g.grant ORDER BY g.source_id),'[]'::jsonb) AS grants
      FROM candidates c CROSS JOIN LATERAL (
        SELECT l.id AS source_id,jsonb_build_object('sourceId',l.id,'permissions',l.permissions,'scope',jsonb_build_object('kind','company')) AS grant
          FROM turnstile.access_legacy_source l WHERE l.tenant_id=$1 AND l.member_id=c.id AND NOT l.retired
        UNION ALL
        SELECT a.id,jsonb_build_object('sourceId',a.id,'permissions',
          (SELECT jsonb_agg(p.permission ORDER BY p.permission) FROM turnstile.access_role_permission p WHERE p.tenant_id=a.tenant_id AND p.role_id=a.role_id),
          'scope',CASE WHEN a.scope_kind='company' THEN jsonb_build_object('kind','company') ELSE
            jsonb_build_object('kind','units','includeChildren',a.include_children,'unitIds',
              (SELECT jsonb_agg(s.unit_id ORDER BY s.unit_id) FROM turnstile.access_scope_anchor s WHERE s.tenant_id=a.tenant_id AND s.assignment_id=a.id)) END)
          FROM turnstile.access_assignment a WHERE a.tenant_id=$1 AND a.member_id=c.id
      ) g GROUP BY c.id,c.status ORDER BY c.id`,
            [tx.tenantId, changedAnchors],
          )
        ).rows
      : [];
    if (rows.length > 1000) this.unavailable(tx, 'capacity');
    const moved = [...before.keys()].filter((id) => descendant(before, id, source));
    const members: string[] = [];
    let ceiling = true;
    const actions: PeoplePermission[] = ['turnstile:units:read', 'turnstile:units:manage'];
    for (const row of rows) {
      const effective = {
        ...tx.access,
        status: row.status,
        units: before,
        context: { ...tx.access.context, grants: row.grants },
      };
      const relocated = { ...effective, units: after };
      let changed = false;
      for (const action of actions)
        for (const id of moved) {
          const target = { kind: 'units' as const, unitIds: [id], includeChildren: false };
          if (covers(effective, action, target) === covers(relocated, action, target)) continue;
          changed = true;
          const subtree = { kind: 'units' as const, unitIds: [source], includeChildren: true };
          ceiling =
            ceiling &&
            covers(tx.access, action, subtree) &&
            covers({ ...tx.access, units: after }, action, subtree);
        }
      if (changed) members.push(row.id);
    }
    const invitations = await this.invitations.impact(tx.client, tx.tenantId, before, after);
    if (invitations.ids.length > 1000 || new Set(invitations.ids).size !== invitations.ids.length)
      this.unavailable(tx, 'capacity');
    ceiling =
      ceiling &&
      coversGrants(tx.access, invitations.grants) &&
      coversGrants({ ...tx.access, units: after }, invitations.grants);
    return {
      members,
      invitations,
      changed: members.length > 0 || invitations.ids.length > 0,
      ceiling,
      digest: commandDigest({
        source,
        parent,
        units: [...after],
        subjects: rows,
        invitations: { ids: invitations.ids, digest: invitations.digest },
      }),
    };
  }

  requirePeople(tx: StructureAccessContext, impact: StructureMoveImpact) {
    if (
      impact.changed &&
      (!covers(tx.access, 'turnstile:people:manage', { kind: 'company' }) ||
        !covers(tx.access, 'turnstile:units:manage', { kind: 'company' }) ||
        !impact.ceiling)
    )
      throw new StructureException({
        code: 'ACCESS_COVERAGE_DENIED',
        requestId: tx.actor.requestId,
      });
  }

  async preview(
    tx: StructureAccessContext,
    command: { id: string; parentId: string },
    impact: StructureMoveImpact,
  ) {
    this.requirePeople(tx, impact);
    const token = randomBytes(32).toString('base64url');
    const bound = commandDigest({ command, impact: impact.digest });
    const result = await tx.client
      .query<{ expires: Date }>(
        `SELECT turnstile.save_structure_impact($1,$2,$3,$4,$5,$6,$7,$8) AS expires`,
        [
          tx.tenantId,
          tx.actor.userId,
          randomUUID(),
          commandDigest(token),
          bound,
          tx.access.context.fingerprint,
          tx.access.context.accessRevision,
          tx.organizationRevision,
        ],
      )
      .catch((error: unknown) => {
        if (error && typeof error === 'object' && 'code' in error && error.code === '54000')
          this.unavailable(tx, 'capacity');
        throw error;
      });
    return scopedMoveImpactSchema.parse({
      actorId: tx.actor.userId,
      commandDigest: commandDigest(command),
      accessRevision: tx.access.context.accessRevision,
      organizationRevision: tx.organizationRevision,
      confirmation: token,
      expiresAt: result.rows[0]?.expires.toISOString(),
      sourceId: command.id,
      parentId: command.parentId,
      accessChanges: impact.changed,
      affectedMemberCount: impact.members.length,
      affectedInvitationCount: impact.invitations.ids.length,
    });
  }

  async confirm(
    tx: StructureAccessContext,
    command: unknown,
    impact: StructureMoveImpact,
    token: string | null,
  ) {
    this.requirePeople(tx, impact);
    if (!impact.changed) return;
    const proof = token
      ? await tx.client.query(
          `SELECT 1 FROM turnstile.access_impact_receipt
      WHERE tenant_id=$1 AND actor_id=$2 AND token_hash=$3 AND command_digest=$4 AND actor_fingerprint=$5
        AND access_revision=$6 AND organization_revision=$7 AND expires_at>statement_timestamp()`,
          [
            tx.tenantId,
            tx.actor.userId,
            commandDigest(token),
            commandDigest({ command, impact: impact.digest }),
            tx.access.context.fingerprint,
            tx.access.context.accessRevision,
            tx.organizationRevision,
          ],
        )
      : undefined;
    if (!proof?.rowCount)
      throw new StructureException({
        code: 'STRUCTURE_CONFLICT',
        requestId: tx.actor.requestId,
        reason: 'impact_stale',
      });
  }
  async invalidate(tx: StructureAccessContext, impact: StructureMoveImpact) {
    await this.invitations.invalidate(tx.client, tx.tenantId, impact.invitations);
  }
  unavailable(tx: StructureAccessContext, reason: 'capacity' | 'dependency' = 'dependency'): never {
    throw new StructureException({
      code: 'STRUCTURE_UNAVAILABLE',
      requestId: tx.actor.requestId,
      reason,
    });
  }
}
