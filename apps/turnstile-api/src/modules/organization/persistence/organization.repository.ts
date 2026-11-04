import { randomUUID } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';
import {
  CONFIGURATION_LIMITS,
  CONFIGURATION_MANAGE_PERMISSION,
  type ConfigurationSnapshotDto,
  configurationNameKey,
  configurationSnapshotSchema,
  type OrganizationUnitDto,
  type WorkspaceStatusDto,
} from '@thaarei/turnstile-contracts';
import type { PoolClient } from 'pg';
import { AccessContextChangedException } from '../../../infrastructure/access-context-exception.js';
import { authError } from '../../../infrastructure/access-error.js';
import type { ConfigurationActor } from '../../../infrastructure/configuration-context.js';
import { ConfigurationException } from '../../../infrastructure/configuration-exception.js';
import { withTenant } from '../../../infrastructure/database/postgres.js';
import { ProductPersistenceService } from '../../../infrastructure/database/product-persistence.service.js';
import {
  covers,
  type EffectiveAccess,
  hasShell,
  readAccess,
} from '../../access/access-evaluator.js';
import { StructureAccessService } from '../../access/structure-access.service.js';

export type { ConfigurationActor } from '../../../infrastructure/configuration-context.js';
export interface ConfigurationRecord {
  tenant_id: string;
  revision: number;
  name: string | null;
  time_zone: string | null;
  root_id: string | null;
  requirement_version: 1 | 2;
  completed_at: Date | null;
  completed_by: string | null;
}
export interface UnitRecord {
  id: string;
  type: OrganizationUnitDto['type'];
  parent_id: string | null;
  name: string | null;
  name_key: string | null;
}
export interface ConfigurationTransaction {
  client: PoolClient;
  tenantId: string;
  record: ConfigurationRecord;
  actor: ConfigurationActor;
  canManage: boolean;
  access: EffectiveAccess;
}
type OrganizationReadContext = Omit<ConfigurationTransaction, 'access'>;

export function configurationUnavailable(): never {
  throw new ConfigurationException({ code: 'CONFIGURATION_UNAVAILABLE' });
}
export function invalidConfiguration(
  field: 'name' | 'timeZone' | 'parentId' | 'id' | 'type' | 'body',
  reason: 'required' | 'invalid' | 'unsupported' | 'limit_reached' = 'invalid',
): never {
  throw new ConfigurationException({
    code: 'CONFIGURATION_INVALID',
    fieldErrors: [{ field, reason }],
  });
}
export function configurationConflict(
  record: ConfigurationRecord,
  reason: 'revision' | 'duplicate_name' | 'unit_in_use' | 'idempotency_mismatch' | 'required_unit',
): never {
  throw new ConfigurationException({
    code: 'CONFIGURATION_CONFLICT',
    reason,
    revision: record.revision,
  });
}

export function compareCodePoints(left: string, right: string) {
  const a = [...left];
  const b = [...right];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const difference = (a[i]?.codePointAt(0) ?? 0) - (b[i]?.codePointAt(0) ?? 0);
    if (difference) return difference;
  }
  return a.length - b.length;
}

@Injectable()
export class OrganizationRepository {
  constructor(
    private readonly persistence: ProductPersistenceService,
    private readonly structureAccess: StructureAccessService,
  ) {}

  private async connection() {
    const { pool, config } = this.persistence;
    if (!pool || !config || !(await this.persistence.ready())) return configurationUnavailable();
    const safety = await pool.query(
      "SELECT count(*) = 4 AND bool_and(relrowsecurity AND relforcerowsecurity) AS safe FROM pg_class WHERE oid IN ('turnstile.organization_configuration'::regclass, 'turnstile.organization_unit'::regclass, 'turnstile.configuration_create_receipt'::regclass, 'turnstile.configuration_audit'::regclass)",
    );
    if (!safety.rows[0]?.safe) return configurationUnavailable();
    return { pool, config };
  }

  async status(actor: ConfigurationActor): Promise<WorkspaceStatusDto> {
    try {
      const { pool, config } = await this.connection();
      return await withTenant(
        pool,
        config.INSTALLATION_TENANT_ID,
        async (client) => {
          const access = await readAccess(client, config.INSTALLATION_TENANT_ID, actor.userId);
          if (!hasShell(access)) return authError(403, 'PRODUCT_ACCESS_DENIED');
          if (access.workspaceComplete === null) return configurationUnavailable();
          return {
            status: access.workspaceComplete ? 'complete' : 'incomplete',
            canManageConfiguration: covers(access, CONFIGURATION_MANAGE_PERMISSION, {
              kind: 'company',
            }),
          };
        },
        actor.deadlineAt,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      return configurationUnavailable();
    }
  }

  async transaction<T>(
    actor: ConfigurationActor,
    manage: boolean,
    work: (tx: ConfigurationTransaction) => Promise<T>,
  ): Promise<T> {
    try {
      const { pool, config } = await this.connection();
      return await withTenant(
        pool,
        config.INSTALLATION_TENANT_ID,
        async (client) => {
          await client.query('SELECT turnstile.lock_access_context($1::uuid)', [
            config.INSTALLATION_TENANT_ID,
          ]);
          const record = (
            await client.query(
              'SELECT * FROM turnstile.organization_configuration WHERE tenant_id = $1',
              [config.INSTALLATION_TENANT_ID],
            )
          ).rows[0] as ConfigurationRecord | undefined;
          if (!record) return configurationUnavailable();
          const access = await readAccess(client, record.tenant_id, actor.userId);
          if (!hasShell(access)) return authError(403, 'PRODUCT_ACCESS_DENIED');
          if (actor.accessFingerprint && actor.accessFingerprint !== access.context.fingerprint)
            throw new AccessContextChangedException(actor.requestId, access.context.accessRevision);
          const canManage = covers(access, CONFIGURATION_MANAGE_PERMISSION, { kind: 'company' });
          if (manage && !canManage) return authError(403, 'PERMISSION_DENIED');
          return work({
            client,
            tenantId: record.tenant_id,
            record,
            actor,
            canManage,
            access,
          });
        },
        actor.deadlineAt,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      return configurationUnavailable();
    }
  }

  async change(
    tx: ConfigurationTransaction,
    action: string,
    subjectId: string,
    fields: string[],
    changes: { name?: string; timeZone?: string; rootId?: string; complete?: boolean } = {},
  ) {
    if (tx.record.revision >= CONFIGURATION_LIMITS.revision) return configurationUnavailable();
    const before = tx.record.revision;
    tx.record = (
      await tx.client.query(
        `UPDATE turnstile.organization_configuration SET revision = revision + 1, name = $2, time_zone = $3, root_id = $4,
      completed_at = CASE WHEN $5::boolean THEN statement_timestamp() ELSE completed_at END,
      completed_by = CASE WHEN $5::boolean THEN $6::text ELSE completed_by END WHERE tenant_id = $1 RETURNING *`,
        [
          tx.tenantId,
          changes.name ?? tx.record.name,
          changes.timeZone ?? tx.record.time_zone,
          changes.rootId ?? tx.record.root_id,
          changes.complete ?? false,
          tx.actor.userId,
        ],
      )
    ).rows[0];
    await tx.client.query(
      `INSERT INTO turnstile.configuration_audit (tenant_id,id,actor_kind,actor_id,request_id,action,subject_id,changed_fields,revision_before,revision_after)
      VALUES ($1,$2,'user',$3,$4,$5,$6,$7,$8,$9)`,
      [
        tx.tenantId,
        randomUUID(),
        tx.actor.userId,
        tx.actor.requestId,
        action,
        subjectId,
        fields,
        before,
        tx.record.revision,
      ],
    );
  }

  async units(tx: OrganizationReadContext): Promise<UnitRecord[]> {
    const rows = (
      await tx.client.query(
        'SELECT id, type, parent_id, name, name_key FROM turnstile.organization_unit WHERE tenant_id = $1 LIMIT $2',
        [tx.tenantId, CONFIGURATION_LIMITS.units + 1],
      )
    ).rows;
    if (rows.length > CONFIGURATION_LIMITS.units) return configurationUnavailable();
    return rows;
  }

  async insertRoot(tx: ConfigurationTransaction, id: string) {
    await tx.client.query(
      "INSERT INTO turnstile.organization_unit (tenant_id,id,type) VALUES ($1,$2,'organization')",
      [tx.tenantId, id],
    );
  }

  async insertUnit(
    tx: ConfigurationTransaction,
    unit: {
      id: string;
      type: 'site' | 'department';
      parentId: string;
      name: string;
      nameKey: string;
    },
  ) {
    await tx.client.query(
      'INSERT INTO turnstile.organization_unit (tenant_id,id,type,parent_id,name,name_key) VALUES ($1,$2,$3,$4,$5,$6)',
      [tx.tenantId, unit.id, unit.type, unit.parentId, unit.name, unit.nameKey],
    );
  }

  async renameUnit(tx: ConfigurationTransaction, id: string, name: string, key: string) {
    await tx.client.query(
      'UPDATE turnstile.organization_unit SET name = $3, name_key = $4 WHERE tenant_id = $1 AND id = $2',
      [tx.tenantId, id, name, key],
    );
  }

  async moveUnit(
    tx: ConfigurationTransaction,
    id: string,
    parentId: string,
    review?: { command: unknown; confirmation: string | null },
  ) {
    // Every supported structure writer reaches this boundary under the shared
    // installation/configuration/access locks. The old endpoint has no impact
    // confirmation contract, so it must never commit a possible coverage change.
    const units = await this.projectedUnits(tx);
    const source = units.find((unit) => unit.id === id);
    const destination = units.find((unit) => unit.id === parentId);
    if (!source || !destination) return configurationUnavailable();
    const context = { ...tx, organizationRevision: tx.record.revision };
    const impact = await this.structureAccess.assess(context, id, parentId);
    if (review)
      await this.structureAccess.confirm(context, review.command, impact, review.confirmation);
    else if (impact.changed) return configurationConflict(tx.record, 'unit_in_use');
    if (source.parentId === parentId) return impact;
    await this.structureAccess.invalidate(context, impact);
    try {
      await tx.client.query(
        'UPDATE turnstile.organization_unit SET parent_id = $3 WHERE tenant_id = $1 AND id = $2',
        [tx.tenantId, id, parentId],
      );
      return impact;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === '23503') return configurationConflict(tx.record, 'unit_in_use');
        if (error.code === '23505') return configurationConflict(tx.record, 'duplicate_name');
      }
      throw error;
    }
  }

  async deleteUnit(tx: ConfigurationTransaction, id: string) {
    // Include retained assignments of suspended members. Historical audit has no
    // live-unit FK and does not pin units after the assignment is removed.
    if (
      await this.structureAccess.referenced({ ...tx, organizationRevision: tx.record.revision }, id)
    )
      return configurationConflict(tx.record, 'unit_in_use');
    try {
      await tx.client.query(
        'DELETE FROM turnstile.organization_unit WHERE tenant_id = $1 AND id = $2',
        [tx.tenantId, id],
      );
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23503')
        return configurationConflict(tx.record, 'unit_in_use');
      throw error;
    }
  }

  async deleteExpiredReceipts(tx: ConfigurationTransaction, key: string) {
    await tx.client.query(
      `DELETE FROM turnstile.configuration_create_receipt WHERE tenant_id = $1 AND key IN
      (SELECT key FROM turnstile.configuration_create_receipt WHERE tenant_id = $1 AND expires_at <= statement_timestamp() ORDER BY (key = $2) DESC, expires_at, key LIMIT $3)`,
      [tx.tenantId, key, CONFIGURATION_LIMITS.maintenanceRows],
    );
  }

  async receipt(
    tx: ConfigurationTransaction,
    key: string,
  ): Promise<{ actor_id: string; fingerprint: string; unit_id: string } | undefined> {
    return (
      await tx.client.query(
        'SELECT actor_id, fingerprint, unit_id FROM turnstile.configuration_create_receipt WHERE tenant_id = $1 AND key = $2 AND expires_at > statement_timestamp()',
        [tx.tenantId, key],
      )
    ).rows[0];
  }

  async liveReceipts(tx: ConfigurationTransaction): Promise<number> {
    return (
      await tx.client.query(
        'SELECT count(*)::int AS total FROM turnstile.configuration_create_receipt WHERE tenant_id = $1 AND expires_at > statement_timestamp()',
        [tx.tenantId],
      )
    ).rows[0].total;
  }

  async insertReceipt(
    tx: ConfigurationTransaction,
    key: string,
    fingerprint: string,
    unitId: string,
  ) {
    await tx.client.query(
      'INSERT INTO turnstile.configuration_create_receipt (tenant_id,key,actor_id,fingerprint,unit_id) VALUES ($1,$2,$3,$4,$5)',
      [tx.tenantId, key, tx.actor.userId, fingerprint, unitId],
    );
  }

  async projectedUnits(tx: OrganizationReadContext): Promise<OrganizationUnitDto[]> {
    const rows = await this.units(tx);
    const children = new Map<string | null, UnitRecord[]>();
    for (const row of rows) {
      if (
        row.type !== 'organization' &&
        (row.name === null || row.name_key !== configurationNameKey(row.name))
      )
        return configurationUnavailable();
      children.set(row.parent_id, [...(children.get(row.parent_id) ?? []), row]);
    }
    const units: OrganizationUnitDto[] = [];
    const visit = (parent: string | null, ancestors: string[]) => {
      const siblings = (children.get(parent) ?? []).sort(
        (a, b) =>
          compareCodePoints(a.name_key ?? '', b.name_key ?? '') || compareCodePoints(a.id, b.id),
      );
      if (ancestors.length >= CONFIGURATION_LIMITS.depth && siblings.length)
        return configurationUnavailable();
      for (const row of siblings) {
        if (ancestors.includes(row.id)) return configurationUnavailable();
        units.push({
          id: row.id,
          type: row.type,
          parentId: row.parent_id,
          name: row.type === 'organization' ? tx.record.name : row.name,
          ancestorIds: ancestors,
        } as OrganizationUnitDto);
        visit(row.id, [...ancestors, row.id]);
      }
    };
    visit(null, []);
    if (units.length !== rows.length) return configurationUnavailable();
    return units;
  }

  async snapshot(tx: OrganizationReadContext): Promise<ConfigurationSnapshotDto> {
    const units = await this.projectedUnits(tx);
    const { record } = tx;
    const profile = [record.name !== null, record.time_zone !== null, record.root_id !== null];
    const firstUnit = units.some(
      (unit) => unit.type !== 'organization' && unit.parentId === record.root_id,
    );
    const complete = record.completed_at !== null;
    const result = configurationSnapshotSchema.safeParse({
      revision: record.revision,
      organization: { name: record.name, timeZone: record.time_zone, rootId: record.root_id },
      units,
      setup: {
        state: complete ? 'completed' : record.revision === 0 ? 'not_started' : 'in_progress',
        requirementVersion: record.requirement_version,
        revision: record.revision,
        requirements: [
          { id: 'organization_name', satisfied: profile[0] },
          { id: 'time_zone', satisfied: profile[1] },
          { id: 'organization_root', satisfied: profile[2] },
          ...(record.requirement_version === 2 ? [{ id: 'first_unit', satisfied: firstUnit }] : []),
          { id: 'configuration_manager', satisfied: tx.canManage },
        ],
        nextStep: complete
          ? null
          : !profile.every(Boolean)
            ? 'organization'
            : record.requirement_version === 2 && !firstUnit
              ? 'structure'
              : 'review',
        completion: complete
          ? {
              completedAt: record.completed_at?.toISOString(),
              completedBy: record.completed_by,
              requirementVersion: record.requirement_version,
            }
          : null,
      },
    });
    if (!result.success) return configurationUnavailable();
    return result.data;
  }
}
