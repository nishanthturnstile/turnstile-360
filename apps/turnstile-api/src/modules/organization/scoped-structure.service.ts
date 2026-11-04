import { Injectable } from '@nestjs/common';
import {
  configurationNameKey,
  type OrganizationUnitDto,
  peopleIdSchema,
  peopleListQuerySchema,
  scopedUnitDetailSchema,
  scopedUnitsResponseSchema,
} from '@thaarei/turnstile-contracts';
import { z } from 'zod';
import type { ConfigurationActor } from '../../infrastructure/configuration-context.js';
import { StructureException } from '../../infrastructure/structure-http.js';
import { covers } from '../access/access-evaluator.js';
import {
  type ConfigurationTransaction,
  compareCodePoints,
  OrganizationRepository,
} from './persistence/organization.repository.js';

@Injectable()
export class ScopedStructureService {
  constructor(private readonly repository: OrganizationRepository) {}
  emptyQuery(actor: ConfigurationActor, input: unknown) {
    if (!z.strictObject({}).safeParse(input).success) this.invalid(actor);
  }

  private invalid(actor: ConfigurationActor, field: 'body' | 'id' | 'cursor' = 'body'): never {
    throw new StructureException({
      code: 'STRUCTURE_INVALID',
      requestId: actor.requestId,
      fieldErrors: [{ field, reason: 'invalid' }],
    });
  }

  private ready(tx: ConfigurationTransaction) {
    if (!tx.record.completed_at)
      throw new StructureException({ code: 'SETUP_REQUIRED', requestId: tx.actor.requestId });
  }

  private readable(tx: ConfigurationTransaction, unit: OrganizationUnitDto) {
    return (
      unit.type !== 'organization' &&
      covers(tx.access, 'turnstile:units:read', {
        kind: 'units',
        unitIds: [unit.id],
        includeChildren: false,
      })
    );
  }

  private ancestors(units: OrganizationUnitDto[], selected: OrganizationUnitDto[]) {
    const selectedIds = new Set(selected.map((unit) => unit.id));
    const ancestors = new Set(selected.flatMap((unit) => unit.ancestorIds));
    return units
      .filter((unit) => ancestors.has(unit.id) && !selectedIds.has(unit.id))
      .map(({ id, type, name }) => ({ id, type, name, actionable: false as const }));
  }

  async list(actor: ConfigurationActor, input: unknown) {
    const parsed = peopleListQuerySchema.safeParse(input);
    if (!parsed.success) return this.invalid(actor);
    const query = parsed.data;
    return this.repository.transaction(actor, false, async (tx) => {
      this.ready(tx);
      const units = await this.repository.projectedUnits(tx);
      // Filter before search, counts, cursor validation and pagination. The
      // canonical tree remains server-only; breadcrumbs never grant authority.
      const search = query.search?.toLowerCase() ?? '';
      const allowed = units
        .filter((unit) => this.readable(tx, unit) && unit.name?.toLowerCase().includes(search))
        .sort(
          (a, b) =>
            compareCodePoints(a.type, b.type) ||
            compareCodePoints(
              configurationNameKey(a.name ?? ''),
              configurationNameKey(b.name ?? ''),
            ) ||
            compareCodePoints(a.id, b.id),
        );
      let offset = 0;
      if (query.cursor) {
        let decoded: unknown;
        try {
          decoded = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
        } catch {
          return this.invalid(actor, 'cursor');
        }
        const cursor = cursorSchema.safeParse(decoded);
        if (!cursor.success || cursor.data.search !== search) return this.invalid(actor, 'cursor');
        if (
          cursor.data.revision !== tx.record.revision ||
          cursor.data.accessRevision !== tx.access.context.accessRevision ||
          cursor.data.fingerprint !== tx.access.context.fingerprint
        )
          throw new StructureException({
            code: 'STRUCTURE_CONFLICT',
            requestId: actor.requestId,
            reason: 'revision',
            organizationRevision: tx.record.revision,
            accessRevision: tx.access.context.accessRevision,
          });
        const previous = allowed.findIndex((unit) => unit.id === cursor.data.after);
        if (previous < 0) return this.invalid(actor, 'cursor');
        offset = previous + 1;
      }
      const page = allowed.slice(offset, offset + query.limit);
      const after = page.at(-1)?.id;
      const nextCursor =
        after && offset + page.length < allowed.length
          ? Buffer.from(
              JSON.stringify({
                revision: tx.record.revision,
                accessRevision: tx.access.context.accessRevision,
                fingerprint: tx.access.context.fingerprint,
                search,
                after,
              }),
            ).toString('base64url')
          : null;
      return scopedUnitsResponseSchema.parse({
        revision: tx.record.revision,
        accessRevision: tx.access.context.accessRevision,
        units: page,
        ancestors: this.ancestors(units, page),
        nextCursor,
        total: allowed.length,
      });
    });
  }

  async detail(actor: ConfigurationActor, unitId: unknown, input: unknown) {
    if (!z.strictObject({}).safeParse(input).success) return this.invalid(actor);
    const id = peopleIdSchema.safeParse(unitId);
    if (!id.success) return this.invalid(actor, 'id');
    return this.repository.transaction(actor, false, async (tx) => {
      this.ready(tx);
      const units = await this.repository.projectedUnits(tx);
      const unit = units.find((unit) => unit.id === id.data && this.readable(tx, unit));
      if (!unit)
        throw new StructureException({ code: 'STRUCTURE_NOT_FOUND', requestId: actor.requestId });
      return scopedUnitDetailSchema.parse({
        revision: tx.record.revision,
        accessRevision: tx.access.context.accessRevision,
        unit,
        // Detail ancestors must follow the unit's canonical path, not list order.
        ancestors: unit.ancestorIds.map((id) => {
          const ancestor = units.find((row) => row.id === id);
          return { id, type: ancestor?.type, name: ancestor?.name, actionable: false };
        }),
      });
    });
  }
}

const cursorSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  accessRevision: z.number().int().nonnegative(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  search: z.string().max(240),
  after: peopleIdSchema,
});
