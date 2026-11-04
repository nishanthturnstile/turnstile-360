import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  configurationNameKey,
  type OrganizationUnitDto,
  peopleIdSchema,
  peopleMutationHeadersSchema,
  scopedCommandResultSchema,
  scopedMoveCommandSchema,
  scopedMoveRequestSchema,
  scopedUnitCreateSchema,
  scopedUnitDeleteSchema,
  scopedUnitDetailSchema,
  scopedUnitRenameSchema,
} from '@thaarei/turnstile-contracts';
import type { z } from 'zod';
import type { ConfigurationActor } from '../../infrastructure/configuration-context.js';
import { ConfigurationException } from '../../infrastructure/configuration-exception.js';
import { StructureException } from '../../infrastructure/structure-http.js';
import { covers, descendant, impliedPermissions, readAccess } from '../access/access-evaluator.js';
import { commandDigest } from '../access/access-transactions.js';
import { featureWritesOpen } from '../access/release-state.js';
import { StructureAccessService } from '../access/structure-access.service.js';
import {
  validateCreate,
  validateDelete,
  validateMove,
  validateRename,
} from './organization-rules.js';
import {
  type ConfigurationTransaction,
  OrganizationRepository,
} from './persistence/organization.repository.js';

type Versions = { expectedAccessRevision: number; expectedOrganizationRevision: number };
type Receipt = {
  operation: string;
  digest: string;
  subject_id: string;
  scope_parent_id: string | null;
};

@Injectable()
export class StructureCommandsService {
  constructor(
    private readonly repository: OrganizationRepository,
    private readonly access: StructureAccessService,
  ) {}

  // Only the explicit compatible release operator opens this capability.
  async requireOpen(tx: ConfigurationTransaction) {
    if (!(await featureWritesOpen(tx.client, tx.tenantId))) this.unavailable(tx);
  }
  private unavailable(
    tx: ConfigurationTransaction,
    reason: 'readiness' | 'revision_exhausted' | 'capacity' = 'readiness',
  ): never {
    throw new StructureException({
      code: 'STRUCTURE_UNAVAILABLE',
      requestId: tx.actor.requestId,
      reason,
    });
  }
  private invalid(actor: ConfigurationActor, field: 'body' | 'id' | 'parentId' = 'body'): never {
    throw new StructureException({
      code: 'STRUCTURE_INVALID',
      requestId: actor.requestId,
      fieldErrors: [{ field, reason: 'invalid' }],
    });
  }
  private parse<T extends z.ZodType>(
    actor: ConfigurationActor,
    schema: T,
    input: unknown,
  ): z.infer<T> {
    const result = schema.safeParse(input);
    if (!result.success) return this.invalid(actor);
    return result.data;
  }
  private id(actor: ConfigurationActor, input: unknown) {
    const result = peopleIdSchema.safeParse(input);
    if (!result.success) return this.invalid(actor, 'id');
    return result.data;
  }
  private key(actor: ConfigurationActor, input: unknown) {
    return this.parse(actor, peopleMutationHeadersSchema, { 'idempotency-key': input })[
      'idempotency-key'
    ];
  }
  private conflict(
    tx: ConfigurationTransaction,
    reason: 'revision' | 'idempotency_mismatch' | 'reference_in_use' | 'state' = 'revision',
  ): never {
    throw new StructureException({
      code: 'STRUCTURE_CONFLICT',
      requestId: tx.actor.requestId,
      reason,
      accessRevision: tx.access.context.accessRevision,
      organizationRevision: tx.record.revision,
    });
  }
  private missing(tx: ConfigurationTransaction): never {
    throw new StructureException({ code: 'STRUCTURE_NOT_FOUND', requestId: tx.actor.requestId });
  }
  private unit(
    tx: ConfigurationTransaction,
    units: OrganizationUnitDto[],
    id: string,
    action = 'turnstile:units:manage',
  ) {
    const unit = units.find((row) => row.id === id && row.type !== 'organization');
    if (
      !unit ||
      !covers(tx.access, action, { kind: 'units', unitIds: [id], includeChildren: false })
    )
      return this.missing(tx);
    return unit;
  }
  private parent(
    tx: ConfigurationTransaction,
    units: OrganizationUnitDto[],
    id: string,
    children = false,
  ) {
    const parent = units.find((row) => row.id === id);
    if (
      !parent ||
      (parent.type === 'organization'
        ? !tx.canManage
        : !covers(tx.access, 'turnstile:units:manage', {
            kind: 'units',
            unitIds: [id],
            includeChildren: children,
          }))
    )
      return this.missing(tx);
    return parent;
  }
  private versions(tx: ConfigurationTransaction, value: Versions) {
    if (
      value.expectedAccessRevision !== tx.access.context.accessRevision ||
      value.expectedOrganizationRevision !== tx.record.revision
    )
      this.conflict(tx);
  }
  private context(tx: ConfigurationTransaction) {
    return { ...tx, organizationRevision: tx.record.revision };
  }

  private async run<T>(
    actor: ConfigurationActor,
    work: (tx: ConfigurationTransaction) => Promise<T>,
    writer = true,
  ) {
    try {
      return await this.repository.transaction(actor, false, async (tx) => {
        if (!tx.record.completed_at)
          throw new StructureException({ code: 'SETUP_REQUIRED', requestId: actor.requestId });
        if (writer) await this.requireOpen(tx);
        return work(tx);
      });
    } catch (error) {
      if (error instanceof ConfigurationException) {
        const body = error.getResponse() as {
          code: string;
          reason?: string;
          fieldErrors?: { field: 'body'; reason: 'invalid' }[];
        };
        if (body.code === 'CONFIGURATION_CONFLICT')
          throw new StructureException({
            code: 'STRUCTURE_CONFLICT',
            requestId: actor.requestId,
            reason:
              body.reason === 'unit_in_use'
                ? 'reference_in_use'
                : (body.reason as 'revision' | 'duplicate_name' | 'required_unit'),
          });
        if (body.code === 'CONFIGURATION_INVALID')
          throw new StructureException({
            code: 'STRUCTURE_INVALID',
            requestId: actor.requestId,
            fieldErrors: body.fieldErrors ?? [{ field: 'body', reason: 'invalid' }],
          });
        if (body.code === 'CONFIGURATION_NOT_FOUND')
          throw new StructureException({ code: 'STRUCTURE_NOT_FOUND', requestId: actor.requestId });
        throw new StructureException({
          code: 'STRUCTURE_UNAVAILABLE',
          requestId: actor.requestId,
          reason: 'dependency',
        });
      }
      throw error;
    }
  }
  private async receipt(tx: ConfigurationTransaction, key: string) {
    return (
      await tx.client.query<Receipt>(
        `SELECT operation,digest,subject_id,scope_parent_id FROM turnstile.access_command_receipt
      WHERE tenant_id=$1 AND actor_id=$2 AND key=$3 AND expires_at>statement_timestamp()`,
        [tx.tenantId, tx.actor.userId, key],
      )
    ).rows[0];
  }
  private async replay(
    tx: ConfigurationTransaction,
    key: string,
    operation: string,
    digest: string,
  ) {
    const legacy = await tx.client.query(
      `SELECT 1 FROM turnstile.configuration_create_receipt
      WHERE tenant_id=$1 AND actor_id=$2 AND key=$3 AND expires_at>statement_timestamp()`,
      [tx.tenantId, tx.actor.userId, key],
    );
    if (legacy.rowCount) this.conflict(tx, 'idempotency_mismatch');
    const receipt = await this.receipt(tx, key);
    if (!receipt) return;
    if (receipt.operation !== operation || receipt.digest !== digest)
      this.conflict(tx, 'idempotency_mismatch');
    return this.result(
      tx,
      key,
      receipt.subject_id,
      false,
      true,
      receipt.scope_parent_id,
      receipt.operation === 'unit.delete',
    );
  }
  private async save(
    tx: ConfigurationTransaction,
    key: string,
    operation: string,
    digest: string,
    id: string,
    parent: string | null,
    accessChanges = false,
  ) {
    const revision = tx.access.context.accessRevision;
    if (accessChanges && revision >= 2147483647) this.unavailable(tx, 'revision_exhausted');
    try {
      await tx.client.query('SELECT turnstile.save_structure_command($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
        tx.tenantId,
        tx.actor.userId,
        key,
        operation,
        digest,
        id,
        tx.record.revision,
        revision + (accessChanges ? 1 : 0),
        parent,
      ]);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '54000')
        this.unavailable(tx, 'capacity');
      throw error;
    }
    if (accessChanges)
      await tx.client.query('SELECT turnstile.commit_structure_access($1,$2,$3,$4,$5)', [
        tx.tenantId,
        tx.actor.userId,
        key,
        tx.actor.requestId,
        revision,
      ]);
  }
  private async result(
    tx: ConfigurationTransaction,
    key: string,
    id: string,
    changed: boolean,
    replayed: boolean,
    parent: string | null,
    wasDeletion = false,
  ) {
    tx.access = await readAccess(tx.client, tx.tenantId, tx.actor.userId);
    const units = await this.repository.projectedUnits(tx),
      unit = units.find((row) => row.id === id);
    const common = {
      commandId: key,
      changed,
      replayed,
      accessRevision: tx.access.context.accessRevision,
    };
    if (!unit) {
      if (
        !covers(tx.access, 'turnstile:units:read', { kind: 'company' }) &&
        (!wasDeletion ||
          !parent ||
          !covers(tx.access, 'turnstile:units:read', {
            kind: 'units',
            unitIds: [parent],
            includeChildren: false,
          }))
      )
        this.missing(tx);
      return scopedCommandResultSchema.parse({
        ...common,
        kind: 'deleted_unit',
        id,
        revision: tx.record.revision,
      });
    }
    this.unit(tx, units, id, 'turnstile:units:read');
    const current = scopedUnitDetailSchema.parse({
      unit,
      revision: tx.record.revision,
      accessRevision: tx.access.context.accessRevision,
      ancestors: unit.ancestorIds.map((id) => {
        const row = units.find((unit) => unit.id === id);
        return { id, type: row?.type, name: row?.name, actionable: false };
      }),
    });
    return scopedCommandResultSchema.parse({ ...common, kind: 'unit', current });
  }

  create(actor: ConfigurationActor, input: unknown, retryKey: unknown) {
    const value = this.parse(actor, scopedUnitCreateSchema, input),
      key = this.key(actor, retryKey),
      digest = commandDigest({ operation: 'unit.create', value });
    return this.run(actor, async (tx) => {
      const replay = await this.replay(tx, key, 'unit.create', digest);
      if (replay) return replay;
      const units = await this.repository.projectedUnits(tx);
      this.parent(tx, units, value.parentId, true);
      this.versions(tx, value);
      validateCreate(tx.record, units, value);
      const id = randomUUID();
      await this.repository.insertUnit(tx, {
        ...value,
        id,
        nameKey: configurationNameKey(value.name),
      });
      await this.repository.change(tx, 'unit_created', id, ['name', 'type', 'parentId']);
      await this.save(tx, key, 'unit.create', digest, id, value.parentId);
      return this.result(tx, key, id, true, false, value.parentId);
    });
  }
  rename(actor: ConfigurationActor, unitId: unknown, input: unknown, retryKey: unknown) {
    const id = this.id(actor, unitId),
      value = this.parse(actor, scopedUnitRenameSchema, input),
      key = this.key(actor, retryKey),
      digest = commandDigest({ operation: 'unit.rename', id, value });
    return this.run(actor, async (tx) => {
      const replay = await this.replay(tx, key, 'unit.rename', digest);
      if (replay) return replay;
      const units = await this.repository.projectedUnits(tx),
        unit = this.unit(tx, units, id);
      this.versions(tx, value);
      validateRename(tx.record, units, id, value.name);
      const changed = unit.name !== value.name;
      if (changed) {
        await this.repository.renameUnit(tx, id, value.name, configurationNameKey(value.name));
        await this.repository.change(tx, 'unit_renamed', id, ['name']);
      }
      await this.save(tx, key, 'unit.rename', digest, id, unit.parentId);
      return this.result(tx, key, id, changed, false, unit.parentId);
    });
  }
  remove(actor: ConfigurationActor, unitId: unknown, input: unknown, retryKey: unknown) {
    const id = this.id(actor, unitId),
      value = this.parse(actor, scopedUnitDeleteSchema, input),
      key = this.key(actor, retryKey),
      digest = commandDigest({ operation: 'unit.delete', id, value });
    return this.run(actor, async (tx) => {
      const replay = await this.replay(tx, key, 'unit.delete', digest);
      if (replay) return replay;
      const units = await this.repository.projectedUnits(tx),
        unit = this.unit(tx, units, id);
      this.parent(tx, units, unit.parentId as string);
      this.versions(tx, value);
      validateDelete(tx.record, units, id);
      await this.repository.deleteUnit(tx, id);
      await this.repository.change(tx, 'unit_deleted', id, []);
      await this.save(tx, key, 'unit.delete', digest, id, unit.parentId);
      return this.result(tx, key, id, true, false, unit.parentId, true);
    });
  }
  private movePlan(
    tx: ConfigurationTransaction,
    units: OrganizationUnitDto[],
    value: Versions & { id: string; parentId: string },
  ) {
    const unit = this.unit(tx, units, value.id),
      parent = this.parent(tx, units, value.parentId);
    this.parent(tx, units, unit.parentId as string);
    this.versions(tx, value);
    const plan = validateMove(tx.record, units, unit.id, parent.id);
    const moved = units
      .filter(
        (row) => row.id === unit.id || row.ancestorIds.some((ancestor) => ancestor === unit.id),
      )
      .map((row) => row.id);
    const after = new Map(tx.access.units);
    after.set(unit.id, parent.id);
    const scope = { kind: 'units' as const, unitIds: moved, includeChildren: false };
    const company = covers(tx.access, 'turnstile:units:manage', { kind: 'company' });
    const common = tx.access.context.grants.some(
      (grant) =>
        impliedPermissions(grant.permissions).includes('turnstile:units:manage') &&
        grant.scope.kind === 'units' &&
        grant.scope.includeChildren &&
        grant.scope.unitIds.some(
          (anchor) =>
            descendant(tx.access.units, unit.parentId as string, anchor) &&
            descendant(tx.access.units, parent.id, anchor),
        ),
    );
    if (
      !covers(tx.access, 'turnstile:units:manage', scope) ||
      !covers({ ...tx.access, units: after }, 'turnstile:units:manage', scope) ||
      (!company && !common)
    )
      throw new StructureException({
        code: 'ACCESS_COVERAGE_DENIED',
        requestId: tx.actor.requestId,
      });
    return plan;
  }
  preview(actor: ConfigurationActor, input: unknown) {
    const value = this.parse(actor, scopedMoveCommandSchema, input);
    return this.run(actor, async (tx) => {
      this.movePlan(tx, await this.repository.projectedUnits(tx), value);
      const impact = await this.access.assess(this.context(tx), value.id, value.parentId);
      return this.access.preview(this.context(tx), value, impact);
    });
  }
  move(actor: ConfigurationActor, unitId: unknown, input: unknown, retryKey: unknown) {
    const id = this.id(actor, unitId),
      value = this.parse(actor, scopedMoveRequestSchema, input),
      key = this.key(actor, retryKey);
    if (id !== value.command.id) return this.invalid(actor, 'id');
    const digest = commandDigest({ operation: 'unit.move', value: value.command });
    return this.run(actor, async (tx) => {
      const replay = await this.replay(tx, key, 'unit.move', digest);
      if (replay) return replay;
      const plan = this.movePlan(tx, await this.repository.projectedUnits(tx), value.command);
      const impact = await this.repository.moveUnit(tx, id, value.command.parentId, {
        command: value.command,
        confirmation: value.confirmation,
      });
      if (plan.changed) await this.repository.change(tx, 'unit_moved', id, ['parentId']);
      await this.save(
        tx,
        key,
        'unit.move',
        digest,
        id,
        value.command.parentId,
        plan.changed && impact.changed,
      );
      return this.result(tx, key, id, plan.changed, false, value.command.parentId);
    });
  }
  command(actor: ConfigurationActor, commandId: unknown) {
    const key = this.id(actor, commandId);
    return this.run(
      actor,
      async (tx) => {
        const receipt = await this.receipt(tx, key);
        if (!receipt?.operation.startsWith('unit.')) return this.missing(tx);
        return this.result(
          tx,
          key,
          receipt.subject_id,
          false,
          true,
          receipt.scope_parent_id,
          receipt.operation === 'unit.delete',
        );
      },
      false,
    );
  }
}
