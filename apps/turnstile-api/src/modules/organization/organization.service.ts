import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  CONFIGURATION_LIMITS,
  configurationNameKey,
  organizationPatchSchema,
  setupCompleteSchema,
  unitCreateHeadersSchema,
  unitCreateResponseSchema,
  unitCreateSchema,
  unitDeleteSchema,
  unitMoveSchema,
  unitPathSchema,
  unitRenameSchema,
  type WorkspaceStatusDto,
} from '@thaarei/turnstile-contracts';
import { parseConfiguration } from '../../infrastructure/configuration-validation.js';
import {
  validateCreate,
  validateDelete,
  validateMove,
  validateRename,
} from './organization-rules.js';
import {
  type ConfigurationActor,
  type ConfigurationTransaction,
  configurationConflict,
  configurationUnavailable,
  invalidConfiguration,
  OrganizationRepository,
} from './persistence/organization.repository.js';

@Injectable()
export class OrganizationService {
  constructor(private readonly repository: OrganizationRepository) {}

  read(actor: ConfigurationActor) {
    return this.repository.transaction(actor, true, (tx) => this.repository.snapshot(tx));
  }

  status(actor: ConfigurationActor): Promise<WorkspaceStatusDto> {
    return this.repository.status(actor);
  }

  private expected(tx: ConfigurationTransaction, expected: number) {
    if (tx.record.revision !== expected) return configurationConflict(tx.record, 'revision');
  }

  async save(actor: ConfigurationActor, input: unknown) {
    const value = parseConfiguration(organizationPatchSchema, input);
    return this.repository.transaction(actor, true, async (tx) => {
      this.expected(tx, value.expectedRevision);
      const fields = [
        value.name !== undefined && value.name !== tx.record.name ? 'name' : null,
        value.timeZone !== undefined && value.timeZone !== tx.record.time_zone ? 'timeZone' : null,
      ].filter((field): field is string => field !== null);
      if (!fields.length) return this.repository.snapshot(tx);
      let rootId = tx.record.root_id;
      if (value.name !== undefined && !rootId) {
        rootId = randomUUID();
        await this.repository.insertRoot(tx, rootId);
      }
      await this.repository.change(tx, 'profile_saved', rootId ?? tx.tenantId, fields, {
        ...(value.name !== undefined ? { name: value.name } : {}),
        ...(value.timeZone !== undefined ? { timeZone: value.timeZone } : {}),
        ...(rootId ? { rootId } : {}),
      });
      return this.repository.snapshot(tx);
    });
  }

  async createUnit(actor: ConfigurationActor, input: unknown, retryKey: unknown) {
    const value = parseConfiguration(unitCreateSchema, input);
    const key = parseConfiguration(unitCreateHeadersSchema, { 'idempotency-key': retryKey })[
      'idempotency-key'
    ];
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          expectedRevision: value.expectedRevision,
          type: value.type,
          parentId: value.parentId,
          name: value.name,
        }),
      )
      .digest('hex');
    return this.repository.transaction(actor, true, async (tx) => {
      // Expired receipt deletion is separately restricted by RLS.
      await this.repository.deleteExpiredReceipts(tx, key);
      const accessReceipt = await tx.client.query(
        `SELECT 1 FROM turnstile.access_command_receipt WHERE tenant_id=$1 AND actor_id=$2 AND key=$3 AND expires_at>statement_timestamp()`,
        [tx.tenantId, actor.userId, key],
      );
      if (accessReceipt.rowCount) return configurationConflict(tx.record, 'idempotency_mismatch');
      const receipt = await this.repository.receipt(tx, key);
      if (receipt) {
        if (receipt.actor_id !== actor.userId || receipt.fingerprint !== fingerprint)
          return configurationConflict(tx.record, 'idempotency_mismatch');
        return unitCreateResponseSchema.parse({
          configuration: await this.repository.snapshot(tx),
          unitId: receipt.unit_id,
          replayed: true,
        });
      }
      this.expected(tx, value.expectedRevision);
      const snapshot = await this.repository.snapshot(tx);
      validateCreate(tx.record, snapshot.units, value);
      const nameKey = configurationNameKey(value.name);
      if ((await this.repository.liveReceipts(tx)) >= CONFIGURATION_LIMITS.createReceipts)
        return configurationUnavailable();
      const id = randomUUID();
      await this.repository.insertUnit(tx, {
        id,
        type: value.type,
        parentId: value.parentId,
        name: value.name,
        nameKey,
      });
      await this.repository.change(tx, 'unit_created', id, ['name', 'type', 'parentId']);
      await this.repository.insertReceipt(tx, key, fingerprint, id);
      return unitCreateResponseSchema.parse({
        configuration: await this.repository.snapshot(tx),
        unitId: id,
        replayed: false,
      });
    });
  }

  async renameUnit(actor: ConfigurationActor, unitId: unknown, input: unknown) {
    const id = parseConfiguration(unitPathSchema, { id: unitId }).id;
    const value = parseConfiguration(unitRenameSchema, input);
    return this.repository.transaction(actor, true, async (tx) => {
      this.expected(tx, value.expectedRevision);
      const snapshot = await this.repository.snapshot(tx);
      const unit = validateRename(tx.record, snapshot.units, id, value.name);
      if (unit.name === value.name) return snapshot;
      const key = configurationNameKey(value.name);
      await this.repository.renameUnit(tx, id, value.name, key);
      await this.repository.change(tx, 'unit_renamed', id, ['name']);
      return this.repository.snapshot(tx);
    });
  }

  async moveUnit(actor: ConfigurationActor, unitId: unknown, input: unknown) {
    const id = parseConfiguration(unitPathSchema, { id: unitId }).id;
    const value = parseConfiguration(unitMoveSchema, input);
    return this.repository.transaction(actor, true, async (tx) => {
      this.expected(tx, value.expectedRevision);
      const snapshot = await this.repository.snapshot(tx);
      const { parent, changed } = validateMove(tx.record, snapshot.units, id, value.parentId);
      if (!changed) return snapshot;
      await this.repository.moveUnit(tx, id, parent.id);
      await this.repository.change(tx, 'unit_moved', id, ['parentId']);
      return this.repository.snapshot(tx);
    });
  }

  async deleteUnit(actor: ConfigurationActor, unitId: unknown, input: unknown) {
    const id = parseConfiguration(unitPathSchema, { id: unitId }).id;
    const value = parseConfiguration(unitDeleteSchema, input);
    return this.repository.transaction(actor, true, async (tx) => {
      this.expected(tx, value.expectedRevision);
      const snapshot = await this.repository.snapshot(tx);
      validateDelete(tx.record, snapshot.units, id);
      await this.repository.deleteUnit(tx, id);
      await this.repository.change(tx, 'unit_deleted', id, []);
      return this.repository.snapshot(tx);
    });
  }

  async complete(actor: ConfigurationActor, input: unknown) {
    const value = parseConfiguration(setupCompleteSchema, input);
    return this.repository.transaction(actor, true, async (tx) => {
      const snapshot = await this.repository.snapshot(tx);
      if (snapshot.setup.state === 'completed') return snapshot;
      this.expected(tx, value.expectedRevision);
      if (!snapshot.organization.name) return invalidConfiguration('name', 'required');
      if (!snapshot.organization.timeZone) return invalidConfiguration('timeZone', 'required');
      if (!snapshot.organization.rootId) return configurationUnavailable();
      if (
        snapshot.setup.requirementVersion === 2 &&
        !snapshot.setup.requirements.find((item) => item.id === 'first_unit')?.satisfied
      )
        return invalidConfiguration('body', 'required');
      await this.repository.change(tx, 'setup_completed', tx.tenantId, ['completion'], {
        complete: true,
      });
      return this.repository.snapshot(tx);
    });
  }
}
