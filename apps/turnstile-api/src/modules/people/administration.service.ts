import { Injectable } from '@nestjs/common';
import {
  COMPANY_ONLY_PERMISSIONS,
  eligibleRolesResponseSchema,
  invitationListQuerySchema,
  invitationListResponseSchema,
  memberListQuerySchema,
  memberListResponseSchema,
  PEOPLE_CATALOG_VERSION,
  PEOPLE_PERMISSIONS,
  peopleIdSchema,
  peopleListQuerySchema,
  permissionCatalogSchema,
  roleListQuerySchema,
  roleListResponseSchema,
} from '@thaarei/turnstile-contracts';
import { z } from 'zod';
import type { ConfigurationActor } from '../../infrastructure/configuration-context.js';
import { IdentityClientService } from '../../integrations/identity/identity-client.service.js';
import { covers, coversGrants } from '../access/access-evaluator.js';
import { InvitationService } from './invitation.service.js';
import { hash } from './invitation-policy.js';
import { memberRow, roleRows } from './people-projections.js';
import {
  PeopleStoreService,
  type PeopleTransaction,
  peopleFailure,
} from './people-store.service.js';
export function peopleParse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    return peopleFailure(400, 'PEOPLE_INVALID', {
      fieldErrors: [{ field: 'body', reason: 'invalid' }],
    });
  return parsed.data;
}
const literal = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
@Injectable()
export class AdministrationService {
  constructor(
    private readonly store: PeopleStoreService,
    private readonly identity: IdentityClientService,
    private readonly invitations: InvitationService,
  ) {}
  async refresh(actor: ConfigurationActor, requested?: string[]) {
    const links = await this.store.run(
      actor,
      'people',
      async (tx) =>
        (
          await tx.db.query<{ id: string; user_id: string; version: number }>(
            `SELECT m.id,m.user_id,m.version FROM turnstile.access_member m LEFT JOIN turnstile.member_display d ON d.tenant_id=m.tenant_id AND d.member_id=m.id
       WHERE m.tenant_id=$1 AND ($2::uuid[] IS NULL OR m.id=ANY($2)) ORDER BY (d.member_id IS NULL) DESC,d.checked_at NULLS FIRST,m.id LIMIT 100`,
            [tx.tenant, requested ?? null],
          )
        ).rows,
    );
    if (!links.length) return;
    let response: Awaited<ReturnType<IdentityClientService['projectMembers']>>;
    try {
      response = await this.identity.projectMembers(
        actor,
        links.map((m) => m.id),
      );
    } catch (error) {
      if (error instanceof Error && 'getStatus' in error) throw error;
      return; // Cached verified displays explicitly become stale; absence stays unavailable.
    }
    await this.store.run(actor, 'people', async (tx) => {
      for (const projection of response.subjects) {
        const link = links.find((m) => m.user_id === projection.userId);
        if (!link) throw new Error('Projection binding');
        await tx.db.query(
          `INSERT INTO turnstile.member_display(tenant_id,member_id,member_version,user_id,state,name,email,verified_at,checked_at)
          SELECT $1,m.id,m.version,m.user_id,$5,$6,$7,$8,$9 FROM turnstile.access_member m WHERE m.tenant_id=$1 AND m.id=$2 AND m.user_id=$3 AND m.version=$4
          ON CONFLICT(tenant_id,member_id) DO UPDATE SET member_version=EXCLUDED.member_version,state=EXCLUDED.state,
            name=CASE WHEN EXCLUDED.state='deleted' THEN member_display.name ELSE EXCLUDED.name END,
            email=CASE WHEN EXCLUDED.state='deleted' THEN member_display.email ELSE EXCLUDED.email END,
            verified_at=CASE WHEN EXCLUDED.state='deleted' THEN member_display.verified_at ELSE EXCLUDED.verified_at END,checked_at=EXCLUDED.checked_at
          WHERE member_display.checked_at<=EXCLUDED.checked_at`,
          [
            tx.tenant,
            link.id,
            link.user_id,
            link.version,
            projection.state,
            projection.state === 'present' ? projection.name : null,
            projection.state === 'present' ? projection.email : null,
            projection.state === 'present' && projection.emailVerified
              ? projection.checkedAt
              : null,
            projection.checkedAt,
          ],
        );
      }
    });
  }
  async catalog(actor: ConfigurationActor, imports = false) {
    return this.store.run(actor, 'either', async (tx) =>
      permissionCatalogSchema.parse({
        catalogVersion: PEOPLE_CATALOG_VERSION,
        memberAssignmentFilters: true,
        usersInsights: 1,
        ...(imports ? { durableImports: 1 } : {}),
        organizationRevision: tx.organizationRevision,
        grantableCompanyPermissions: PEOPLE_PERMISSIONS.filter((id) =>
          covers(tx.access, id, { kind: 'company' }),
        ),
        permissions: PEOPLE_PERMISSIONS.map((id) => ({
          id,
          applicability:
            id === 'turnstile:access'
              ? 'scope_neutral'
              : COMPANY_ONLY_PERMISSIONS.includes(id)
                ? 'company_only'
                : 'scope_aware',
          implies:
            id === 'turnstile:configuration:manage'
              ? ['turnstile:units:read', 'turnstile:units:manage']
              : id === 'turnstile:units:manage'
                ? ['turnstile:units:read']
                : [],
        })),
        starters: (await roleRows(tx.db, tx.tenant)).filter((r) => r.systemKey),
      }),
    );
  }
  private cursor(tx: PeopleTransaction, query: { cursor?: string | undefined }, binding: unknown) {
    if (!query.cursor) return undefined;
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
        after: peopleIdSchema,
        binding: z.string(),
        sortValue: z.string().max(500).optional(),
      }),
      decoded,
    );
    if (cursor.binding !== hash(binding))
      return peopleFailure(409, 'PEOPLE_CONFLICT', {
        reason: 'revision',
        accessRevision: tx.access.context.accessRevision,
      });
    return cursor;
  }
  private binding(tx: PeopleTransaction, query: { cursor?: string | undefined }, domain: string) {
    return {
      domain,
      query: { ...query, cursor: undefined },
      revision: tx.access.context.accessRevision,
      fingerprint: tx.access.context.fingerprint,
    };
  }
  private page<T extends { id: string; sortValue?: string }>(
    tx: PeopleTransaction,
    rows: T[],
    total: number,
    limit: number,
    binding: unknown,
  ) {
    return {
      items: rows.slice(0, limit),
      total,
      accessRevision: tx.access.context.accessRevision,
      nextCursor:
        rows.length > limit
          ? Buffer.from(
              JSON.stringify({
                after: rows[limit - 1]?.id,
                sortValue: rows[limit - 1]?.sortValue,
                binding: hash(binding),
              }),
            ).toString('base64url')
          : null,
    };
  }
  async members(actor: ConfigurationActor, input: unknown) {
    const query = peopleParse(memberListQuerySchema, input);
    await this.refresh(actor);
    const selected = await this.store.run(actor, 'people', async (tx) => {
      if (
        query.search &&
        (
          await tx.db.query(
            `SELECT 1 FROM turnstile.access_member m LEFT JOIN turnstile.member_display d ON d.tenant_id=m.tenant_id AND d.member_id=m.id WHERE m.tenant_id=$1 AND d.member_id IS NULL LIMIT 1`,
            [tx.tenant],
          )
        ).rowCount
      )
        return peopleFailure(503, 'PEOPLE_UNAVAILABLE', { reason: 'capacity' });
      const ancestors: string[] = [];
      if (query.unitId) {
        if (
          !tx.access.units.has(query.unitId) ||
          !covers(tx.access, 'turnstile:units:read', {
            kind: 'units',
            unitIds: [query.unitId],
            includeChildren: false,
          })
        )
          return peopleFailure(403, 'PERMISSION_DENIED');
        let parent: string | null | undefined = query.unitId;
        while (parent) {
          ancestors.push(parent);
          parent = tx.access.units.get(parent);
        }
      }
      const binding = this.binding(tx, query, 'members'),
        after = this.cursor(tx, query, binding);
      // Role and coverage filters match the same saved assignment, never unrelated grants.
      const where = `m.tenant_id=$1 AND ($2::text IS NULL OR m.status=$2) AND ($3::text IS NULL OR m.user_id ILIKE $3 ESCAPE '\\' OR d.name ILIKE $3 ESCAPE '\\' OR d.email ILIKE $3 ESCAPE '\\')
        AND (($4::uuid IS NULL AND $5::uuid IS NULL) OR EXISTS (
          SELECT 1 FROM turnstile.access_assignment a WHERE a.tenant_id=m.tenant_id AND a.member_id=m.id
          AND ($4::uuid IS NULL OR a.role_id=$4)
          AND ($5::uuid IS NULL OR a.scope_kind='company' OR EXISTS (
            SELECT 1 FROM turnstile.access_scope_anchor s WHERE s.tenant_id=a.tenant_id AND s.assignment_id=a.id
            AND (s.unit_id=$5 OR (a.include_children AND s.unit_id=ANY($6::uuid[])))
          ))
        ))`;
      const params = [
        tx.tenant,
        query.status ?? null,
        query.search ? literal(query.search) : null,
        query.roleId ?? null,
        query.unitId ?? null,
        ancestors,
      ];
      const descending = query.sort === 'name_desc';
      const sortKey =
        query.sort && query.sort !== 'id'
          ? 'lower(coalesce(d.name,m.user_id)) COLLATE "C"'
          : 'm.id::text COLLATE "C"';
      const direction = descending ? 'DESC' : 'ASC';
      const total = (
        await tx.db.query(
          `SELECT count(*)::int AS n FROM turnstile.access_member m LEFT JOIN turnstile.member_display d ON d.tenant_id=m.tenant_id AND d.member_id=m.id WHERE ${where}`,
          params,
        )
      ).rows[0].n;
      const rows = (
        await tx.db.query<{ id: string; sortValue: string }>(
          `SELECT m.id,${sortKey} AS "sortValue" FROM turnstile.access_member m LEFT JOIN turnstile.member_display d ON d.tenant_id=m.tenant_id AND d.member_id=m.id WHERE ${where}
          AND ($7::uuid IS NULL OR (${sortKey},m.id) ${descending ? '<' : '>'} ($8::text COLLATE "C",$7::uuid)) ORDER BY ${sortKey} ${direction},m.id ${direction} LIMIT $9`,
          [
            ...params,
            after?.after ?? null,
            after?.sortValue ?? after?.after ?? null,
            query.limit + 1,
          ],
        )
      ).rows;
      return {
        page: this.page(tx, rows, total, query.limit, binding),
        ids: rows.slice(0, query.limit).map((r) => r.id),
      };
    });
    await this.refresh(actor, selected.ids);
    return this.store.run(actor, 'people', async (tx) => {
      if (tx.access.context.accessRevision !== selected.page.accessRevision)
        return peopleFailure(409, 'PEOPLE_CONFLICT', { reason: 'revision' });
      const items = [];
      for (const id of selected.ids) items.push(await memberRow(tx.db, tx.tenant, id));
      return memberListResponseSchema.parse({
        ...selected.page,
        items,
      });
    });
  }
  async member(actor: ConfigurationActor, idInput: string) {
    const id = peopleParse(peopleIdSchema, idInput);
    await this.store.run(actor, 'people', (tx) => memberRow(tx.db, tx.tenant, id));
    await this.refresh(actor, [id]);
    return this.store.run(actor, 'people', (tx) => memberRow(tx.db, tx.tenant, id));
  }
  async roles(actor: ConfigurationActor, input: unknown, eligible = false) {
    const query = peopleParse(eligible ? peopleListQuerySchema : roleListQuerySchema, input);
    return this.store.run(actor, eligible ? 'people' : 'roles', async (tx) => {
      const all = (await roleRows(tx.db, tx.tenant)).filter(
        (r) =>
          (!query.search || r.name.toLowerCase().includes(query.search.toLowerCase())) &&
          (!('kind' in query) ||
            !query.kind ||
            (query.kind === 'system') === (r.systemKey !== null)),
      );
      const choices = all
        .map((role) => {
          if (role.systemKey === 'workspace_administrator' && !tx.access.protectedAdministrator)
            return { role, allowedScopes: [] };
          const allowedScopes: string[] = [];
          if (
            coversGrants(tx.access, [
              { sourceId: role.id, permissions: role.permissions, scope: { kind: 'company' } },
            ])
          )
            allowedScopes.push('company');
          if (
            !role.permissions.some((p) => COMPANY_ONLY_PERMISSIONS.includes(p)) &&
            [...tx.access.units.entries()].some(
              ([id, parent]) =>
                parent !== null &&
                coversGrants(tx.access, [
                  {
                    sourceId: role.id,
                    permissions: role.permissions,
                    scope: { kind: 'units', unitIds: [id], includeChildren: false },
                  },
                ]),
            )
          )
            allowedScopes.push('units');
          return { role, allowedScopes };
        })
        .filter((row) => row.allowedScopes.length);
      const unsorted = eligible ? choices.map((c) => c.role) : all,
        source = 'sort' in query && query.sort === 'name_desc' ? [...unsorted].reverse() : unsorted,
        binding = this.binding(tx, query, eligible ? 'eligible' : 'roles'),
        after = this.cursor(tx, query, binding)?.after;
      const offset = after ? source.findIndex((r) => r.id === after) + 1 : 0;
      if (after && !offset) return peopleFailure(409, 'PEOPLE_CONFLICT', { reason: 'revision' });
      const page = this.page(
        tx,
        source.slice(offset, offset + query.limit + 1),
        source.length,
        query.limit,
        binding,
      );
      const usage =
        !eligible && covers(tx.access, 'turnstile:people:manage', { kind: 'company' })
          ? (
              await tx.db.query(
                `WITH selected_roles AS (
                  SELECT id FROM turnstile.access_role WHERE tenant_id=$1 AND id=ANY($2::uuid[])
                ), member_usage AS (
                  SELECT a.role_id,count(DISTINCT a.member_id)::int AS n
                  FROM turnstile.access_assignment a JOIN selected_roles r ON r.id=a.role_id
                  WHERE a.tenant_id=$1 GROUP BY a.role_id
                ), invitation_usage AS (
                  SELECT r.id AS role_id,count(DISTINCT i.id)::int AS n
                  FROM turnstile.invitation i CROSS JOIN LATERAL jsonb_array_elements(i.assignments) a
                  JOIN selected_roles r ON r.id::text=a->'role'->>'id'
                  WHERE i.tenant_id=$1 AND i.state IN ('pending','needs_reapproval')
                    AND i.expires_at>statement_timestamp() GROUP BY r.id
                ) SELECT r.id AS "roleId",coalesce(m.n,0) AS "memberCount",coalesce(i.n,0) AS "invitationCount"
                FROM selected_roles r LEFT JOIN member_usage m ON m.role_id=r.id
                  LEFT JOIN invitation_usage i ON i.role_id=r.id`,
                [tx.tenant, page.items.map((r) => r.id)],
              )
            ).rows
          : undefined;
      return eligible
        ? eligibleRolesResponseSchema.parse({
            ...page,
            items: page.items.map((role) => choices.find((c) => c.role.id === role.id)),
          })
        : roleListResponseSchema.parse({ ...page, ...(usage ? { usage } : {}) });
    });
  }
  async role(actor: ConfigurationActor, idInput: string) {
    const id = peopleParse(peopleIdSchema, idInput);
    return this.store.run(actor, 'roles', async (tx) => {
      const row = (await roleRows(tx.db, tx.tenant)).find((r) => r.id === id);
      return row ?? peopleFailure(404, 'PEOPLE_NOT_FOUND');
    });
  }
  async invitation(actor: ConfigurationActor, id: string) {
    return this.invitations.read(actor, peopleParse(peopleIdSchema, id));
  }
  async invitationList(actor: ConfigurationActor, input: unknown) {
    const query = peopleParse(invitationListQuerySchema, input);
    const selected = await this.store.run(actor, 'people', async (tx) => {
      const binding = this.binding(tx, query, 'invitations'),
        after = this.cursor(tx, query, binding);
      const condition = `i.tenant_id=$1 AND ($2::text IS NULL OR (CASE WHEN i.state IN ('pending','needs_reapproval') AND i.expires_at<=statement_timestamp() THEN 'expired' ELSE i.state END)=$2)
        AND ($3::text IS NULL OR i.email ILIKE $3 ESCAPE '\\')
        AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(i.assignments) a WHERE a->'role'->>'id'=$4::text))
        AND ($5::boolean=false OR (i.state IN ('pending','needs_reapproval') AND i.expires_at>statement_timestamp()))
        AND ($6::text IS NULL OR coalesce((SELECT CASE WHEN i.state IN ('pending','needs_reapproval') AND i.expires_at<=statement_timestamp() AND d.state IN ('queued','sending') THEN 'failed' ELSE d.state END FROM turnstile.invitation_delivery d WHERE d.tenant_id=i.tenant_id AND d.invitation_id=i.id AND d.generation=i.generation),'unavailable')=$6)`;
      const params = [
        tx.tenant,
        query.state ?? null,
        query.search ? literal(query.search) : null,
        query.roleId ?? null,
        query.actionable === 'true',
        query.delivery ?? null,
      ];
      const sortKey =
        query.sort === 'created_desc'
          ? 'i.created_at'
          : query.sort === 'expires_asc'
            ? 'i.expires_at'
            : 'i.id';
      const descending = query.sort === 'created_desc';
      const sortValue =
        sortKey === 'i.id'
          ? 'i.id::text'
          : `to_char(${sortKey} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
      const positionType = sortKey === 'i.id' ? 'uuid' : 'timestamptz';
      const total = (
        await tx.db.query(
          `SELECT count(*)::int AS n FROM turnstile.invitation i WHERE ${condition}`,
          params,
        )
      ).rows[0].n;
      const rows = (
        await tx.db.query<{ id: string; sortValue: string }>(
          `SELECT i.id,${sortValue} AS "sortValue" FROM turnstile.invitation i WHERE ${condition}
          AND ($7::uuid IS NULL OR (${sortKey},i.id) ${descending ? '<' : '>'} ($8::${positionType},$7::uuid))
          ORDER BY ${sortKey} ${descending ? 'DESC' : 'ASC'},i.id ${descending ? 'DESC' : 'ASC'} LIMIT $9`,
          [
            ...params,
            after?.after ?? null,
            after?.sortValue ?? after?.after ?? null,
            query.limit + 1,
          ],
        )
      ).rows;
      return this.page(tx, rows, total, query.limit, binding);
    });
    return this.store.run(actor, 'people', async (tx) => {
      if (tx.access.context.accessRevision !== selected.accessRevision)
        return peopleFailure(409, 'PEOPLE_CONFLICT', { reason: 'revision' });
      const items = [];
      for (const row of selected.items)
        items.push(await this.invitations.readInTransaction(tx.db, tx.tenant, row.id));
      return invitationListResponseSchema.parse({ ...selected, items });
    });
  }
  async recycledAddress(actor: ConfigurationActor, email: string) {
    await this.refresh(actor);
    return this.store.run(actor, 'people', async (tx) => {
      const unsafe = await tx.db.query(
        `SELECT 1 FROM turnstile.access_member m JOIN turnstile.member_display d ON d.tenant_id=m.tenant_id AND d.member_id=m.id AND d.user_id=m.user_id WHERE m.tenant_id=$1 AND m.status='active' AND d.state='deleted' AND (d.email=$2 OR d.email IS NULL) LIMIT 1`,
        [tx.tenant, email],
      );
      if (unsafe.rowCount)
        return peopleFailure(409, 'PEOPLE_CONFLICT', { reason: 'membership_exists' });
    });
  }
}
