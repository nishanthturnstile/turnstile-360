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
import type { ConfigurationActor } from '../../../infrastructure/configuration-context.js';
import { ConfigurationException } from '../../../infrastructure/configuration-exception.js';
import { lockConfiguration } from '../../../infrastructure/database/configuration-lock.js';
import { withTenant } from '../../../infrastructure/database/postgres.js';
import { ProductPersistenceService } from '../../../infrastructure/database/product-persistence.service.js';
import { authError } from '../../auth/browser-auth/auth-errors.js';

export type { ConfigurationActor } from '../../../infrastructure/configuration-context.js';
export interface ConfigurationRecord {
  tenant_id: string;
  revision: number;
  name: string | null;
  time_zone: string | null;
  root_id: string | null;
  requirement_version: 1;
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
}

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
  reason: 'revision' | 'duplicate_name' | 'unit_in_use' | 'idempotency_mismatch',
): never {
  throw new ConfigurationException({
    code: 'CONFIGURATION_CONFLICT',
    reason,
    revision: record.revision,
  });
}

function compareCodePoints(left: string, right: string) {
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
  constructor(private readonly persistence: ProductPersistenceService) {}

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
      return await withTenant(pool, config.INSTALLATION_TENANT_ID, async (client) => {
        // One committed statement snapshot, without queuing readers on mutation locks.
        const row = (
          await client.query(
            `SELECT c.completed_at,a.enabled,a.permissions FROM turnstile.organization_configuration c
          LEFT JOIN turnstile.user_access a ON a.tenant_id = c.tenant_id AND a.user_id = $2
          WHERE c.tenant_id = $1`,
            [config.INSTALLATION_TENANT_ID, actor.userId],
          )
        ).rows[0];
        if (!row) return configurationUnavailable();
        if (
          !row.enabled ||
          !Array.isArray(row.permissions) ||
          !row.permissions.includes('turnstile:access')
        )
          return authError(403, 'PRODUCT_ACCESS_DENIED');
        return {
          status: row.completed_at ? 'complete' : 'incomplete',
          canManageConfiguration: row.permissions.includes(CONFIGURATION_MANAGE_PERMISSION),
        };
      });
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
      return await withTenant(pool, config.INSTALLATION_TENANT_ID, async (client) => {
        const record = (await lockConfiguration(client, config.INSTALLATION_TENANT_ID)) as
          | ConfigurationRecord
          | undefined;
        if (!record) return configurationUnavailable();
        const grant = (
          await client.query(
            'SELECT enabled, permissions FROM turnstile.user_access WHERE tenant_id = $1 AND user_id = $2',
            [record.tenant_id, actor.userId],
          )
        ).rows[0];
        if (
          !grant?.enabled ||
          !Array.isArray(grant.permissions) ||
          !grant.permissions.includes('turnstile:access')
        )
          return authError(403, 'PRODUCT_ACCESS_DENIED');
        if (manage && !grant.permissions.includes(CONFIGURATION_MANAGE_PERMISSION))
          return authError(403, 'PERMISSION_DENIED');
        return work({
          client,
          tenantId: record.tenant_id,
          record,
          actor,
          canManage: grant.permissions.includes(CONFIGURATION_MANAGE_PERMISSION),
        });
      });
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

  async units(tx: ConfigurationTransaction): Promise<UnitRecord[]> {
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

  async deleteUnit(tx: ConfigurationTransaction, id: string) {
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

  async snapshot(tx: ConfigurationTransaction): Promise<ConfigurationSnapshotDto> {
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
    const { record } = tx;
    const profile = [record.name !== null, record.time_zone !== null, record.root_id !== null];
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
          'organization_name',
          'time_zone',
          'organization_root',
          'configuration_manager',
        ].map((id, index) => ({ id, satisfied: index < 3 ? profile[index] : tx.canManage })),
        nextStep: complete ? null : profile.every(Boolean) ? 'review' : 'organization',
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
