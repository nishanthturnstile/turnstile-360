import { Injectable } from '@nestjs/common';
import {
  accessInspectionQuerySchema,
  accessInspectionSchema,
  COMPANY_ONLY_PERMISSIONS,
  PEOPLE_LIMITS,
  peopleAuditQuerySchema,
  peopleAuditResponseSchema,
  peopleIdSchema,
} from '@thaarei/turnstile-contracts';
import { z } from 'zod';
import type { ConfigurationActor } from '../../infrastructure/configuration-context.js';
import { covers, hasShell, readAccess } from '../access/access-evaluator.js';
import { peopleParse } from './administration.service.js';
import { hash } from './invitation-policy.js';
import { memberRow } from './people-projections.js';
import { PeopleStoreService, peopleFailure } from './people-store.service.js';

@Injectable()
export class PeopleInsightsService {
  constructor(private readonly store: PeopleStoreService) {}

  async audit(actor: ConfigurationActor, input: unknown) {
    const query = peopleParse(peopleAuditQuerySchema, input);
    return this.store.run(actor, 'people', async (tx) => {
      const binding = hash({
        query: { ...query, cursor: undefined },
        fingerprint: tx.access.context.fingerprint,
      });
      let after: { at: string; id: string; source: string } | undefined;
      if (query.cursor) {
        let decoded: unknown;
        try {
          decoded = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
        } catch {
          return peopleFailure(400, 'PEOPLE_INVALID', {
            fieldErrors: [{ field: 'cursor', reason: 'invalid' }],
          });
        }
        const cursor = peopleParse(
          z.strictObject({
            at: z.iso.datetime(),
            id: peopleIdSchema,
            source: z.enum(['access', 'invitations']),
            binding: z.string(),
          }),
          decoded,
        );
        if (cursor.binding !== binding)
          return peopleFailure(409, 'PEOPLE_CONFLICT', { reason: 'revision' });
        after = cursor;
      }
      const rows = (
        await tx.db.query<{
          id: string;
          source: string;
          action: string;
          occurred_at: Date;
          cursor_at: string;
          actor_kind: string;
          actor_id: string | null;
          subject_id: string | null;
          revision_before: number | null;
          revision_after: number | null;
          generation: number | null;
        }>(
          `SELECT *, to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
          FROM turnstile.read_people_audit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            tx.tenant,
            actor.userId,
            query.source ?? null,
            query.action ?? null,
            query.subjectId ?? null,
            query.from ?? null,
            query.to ?? null,
            after?.at ?? null,
            after?.id ?? null,
            after?.source ?? null,
            query.limit + 1,
          ],
        )
      ).rows;
      const last = rows[query.limit - 1];
      const visible = rows.slice(0, query.limit);
      // Resolve only linked product records, never a shared identity directory.
      const names = (
        await tx.db.query<{ user_id: string; name: string }>(
          `SELECT d.user_id,d.name FROM turnstile.member_display d JOIN turnstile.access_member m
        ON m.tenant_id=d.tenant_id AND m.id=d.member_id AND m.user_id=d.user_id
        WHERE d.tenant_id=$1 AND d.state='present' AND d.verified_at IS NOT NULL AND d.name IS NOT NULL AND d.user_id=ANY($2::text[])`,
          [tx.tenant, visible.map((r) => r.actor_id).filter(Boolean)],
        )
      ).rows;
      const subjects = (
        await tx.db.query<{ id: string; label: string; kind: 'member' | 'role' | 'invitation' }>(
          `SELECT m.id,d.name AS label,'member'::text AS kind FROM turnstile.access_member m
        JOIN turnstile.member_display d ON d.tenant_id=m.tenant_id AND d.member_id=m.id AND d.user_id=m.user_id
        WHERE m.tenant_id=$1 AND m.id=ANY($2::uuid[]) AND d.state='present' AND d.verified_at IS NOT NULL AND d.name IS NOT NULL
        UNION ALL SELECT r.id,r.name,'role' FROM turnstile.access_role r WHERE r.tenant_id=$1 AND r.id=ANY($2::uuid[]) AND $3::boolean
        UNION ALL SELECT i.id,i.email,'invitation' FROM turnstile.invitation i WHERE i.tenant_id=$1 AND i.id=ANY($2::uuid[])`,
          [
            tx.tenant,
            visible.map((r) => r.subject_id).filter(Boolean),
            covers(tx.access, 'turnstile:roles:manage', { kind: 'company' }),
          ],
        )
      ).rows;
      return peopleAuditResponseSchema.parse({
        items: visible.map((r) => {
          const actorName = names.find((n) => n.user_id === r.actor_id)?.name;
          const kind =
            r.source === 'invitations'
              ? 'invitation'
              : r.action.startsWith('role_')
                ? 'role'
                : /^(member_|legacy_)/u.test(r.action)
                  ? 'member'
                  : undefined;
          const matches = subjects.filter(
            (s) => s.id === r.subject_id && (!kind || s.kind === kind),
          );
          const subject = matches.length === 1 ? matches[0] : undefined;
          return {
            id: r.id,
            source: r.source,
            action: r.action,
            occurredAt: r.occurred_at.toISOString(),
            actorKind: r.actor_kind,
            actorId: r.actor_id,
            ...(actorName ? { actorName } : {}),
            subjectId: r.subject_id,
            ...(subject ? { subjectLabel: subject.label, subjectKind: subject.kind } : {}),
            revisionBefore: r.revision_before,
            revisionAfter: r.revision_after,
            generation: r.generation,
          };
        }),
        nextCursor:
          rows.length > query.limit && last
            ? Buffer.from(
                JSON.stringify({
                  at: last.cursor_at,
                  id: last.id,
                  source: last.source,
                  binding,
                }),
              ).toString('base64url')
            : null,
        retentionDays: PEOPLE_LIMITS.auditRetentionDays,
        accessRevision: tx.access.context.accessRevision,
      });
    });
  }

  async inspect(actor: ConfigurationActor, idInput: string, input: unknown) {
    const id = peopleParse(peopleIdSchema, idInput);
    const query = peopleParse(accessInspectionQuerySchema, input);
    return this.store.run(actor, 'people', async (tx) => {
      const member = await memberRow(tx.db, tx.tenant, id);
      const target = query.unitId
        ? { kind: 'units' as const, unitIds: [query.unitId], includeChildren: false }
        : { kind: 'company' as const };
      if (
        query.unitId &&
        (!tx.access.units.has(query.unitId) || !covers(tx.access, 'turnstile:units:read', target))
      )
        return peopleFailure(403, 'PERMISSION_DENIED');
      const subject = await readAccess(tx.db, tx.tenant, member.userId);
      const allowed = covers(subject, query.permission, target);
      const sources = hasShell(subject)
        ? subject.context.grants
            .filter(
              (g) =>
                query.permission !== 'turnstile:access' ||
                g.permissions.includes('turnstile:access'),
            )
            .filter((g) =>
              covers(
                {
                  ...subject,
                  context: {
                    ...subject.context,
                    grants: [
                      {
                        ...g,
                        permissions: [...new Set([...g.permissions, 'turnstile:access' as const])],
                      },
                    ],
                  },
                },
                query.permission,
                target,
              ),
            )
            .map((g) => ({
              id: g.sourceId,
              name:
                member.assignments.find((a) => a.id === g.sourceId)?.role.name ??
                'Retained imported access',
              scope: g.scope,
            }))
        : [];
      return accessInspectionSchema.parse({
        memberId: id,
        permission: query.permission,
        unitId: query.unitId ?? null,
        memberStatus: member.status,
        allowed,
        sources,
        reason:
          member.status === 'suspended'
            ? 'suspended'
            : !hasShell(subject)
              ? 'no_workspace_entry'
              : target.kind === 'units' && COMPANY_ONLY_PERMISSIONS.includes(query.permission)
                ? 'company_only'
                : allowed
                  ? 'granted'
                  : 'no_matching_grant',
        accessRevision: tx.access.context.accessRevision,
      });
    });
  }
}
