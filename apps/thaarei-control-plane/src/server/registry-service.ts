import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { RegistryCommand, RegistryReceipt } from '../contracts/registry.ts';
import {
  auditRecord,
  clientDetail,
  clientList,
  clientRecord,
  INSTALLATIONS_PER_CLIENT,
  installationRecord,
  productRecord,
  REGISTRY_PAGE_SIZE,
  receipt,
  registryCommand,
  registryQuery,
} from '../contracts/registry.ts';
import type { StaffContext } from './access.ts';
import {
  AccessError,
  identity,
  requireStaff,
  STAFF_LOCK,
  staffContext,
  transaction,
} from './access.ts';
import { assertAuthority } from './machine-signing.ts';
import { runtime } from './runtime.ts';

type Row = Record<string, unknown>;
const iso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
const nullableIso = (value: unknown) => (value == null ? null : iso(value));
function clientDto(row: Row) {
  return clientRecord.parse({
    id: row.id,
    code: row.code,
    name: row.name,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    archived: row.archived,
    revision: row.revision,
    registeredAt: iso(row.registered_at),
    updatedAt: iso(row.updated_at),
  });
}
function installationDto(row: Row) {
  return installationRecord.parse({
    id: row.id,
    clientId: row.client_id,
    environment: row.environment,
    label: row.label,
    localInstallationId: row.local_installation_id,
    tenantId: row.tenant_id,
    registeredAt: iso(row.registered_at),
  });
}
function productDto(row: Row) {
  return productRecord.parse({
    id: row.id,
    clientId: row.client_id,
    installationId: row.installation_id,
    product: row.product,
    applicationId: row.application_id,
    localInstallationId: row.local_installation_id,
    tenantId: row.tenant_id,
    environment: row.environment,
    policyState: row.policy_state,
    revision: row.revision,
    registeredAt: iso(row.registered_at),
    policyChangedAt: iso(row.policy_changed_at),
    policyChangedBy: row.policy_changed_by,
    policyReason: row.policy_reason,
    pairingVerifiedAt: nullableIso(row.pairing_verified_at),
    firstApprovedAt: nullableIso(row.first_approved_at),
    lastApprovedAt: nullableIso(row.last_approved_at),
    firstActivationAcknowledgedAt: nullableIso(row.first_acknowledged_at),
    currentActivationAcknowledgedAt: nullableIso(row.current_acknowledged_at),
    firstIssuedApprovalAt: nullableIso(row.first_issued_at),
    firstReportedActivityAt: null,
    lastContactAt: nullableIso(row.last_contact_at),
    reportedVersion: null,
  });
}
const productSelect = `SELECT p.*,m.first_issued_at,m.first_acknowledged_at,m.current_acknowledged_at,m.last_contact_at,i.local_installation_id,i.tenant_id,i.environment FROM control_plane.registry_product p
  JOIN control_plane.registry_installation i ON i.id=p.installation_id AND i.client_id=p.client_id LEFT JOIN control_plane.machine m ON m.product_id=p.id`;
function writer(actor: StaffContext, sensitive = false) {
  if (!['admin', 'operator'].includes(actor.role))
    throw new AccessError(403, 'Registry changes require Admin or Operator');
  if (sensitive && !actor.recent) throw new AccessError(403, 'Verify MFA again to continue');
}
async function clientRow(db: PoolClient, id: string, active = false) {
  const row = (
    await db.query('SELECT * FROM control_plane.registry_client WHERE id=$1 FOR UPDATE', [id])
  ).rows[0];
  if (!row) throw new AccessError(404, 'Client not found');
  if (active && row.archived)
    throw new AccessError(409, 'Unarchive the client before adding deployments');
  return row as Row;
}
async function recordAudit(
  db: PoolClient,
  actor: StaffContext,
  command: RegistryCommand,
  clientId: string,
  resourceId: string,
  action: string,
  before: unknown,
  after: unknown,
  committedAt: string,
) {
  await db.query(
    `INSERT INTO control_plane.registry_audit(id,client_id,resource_id,actor_id,actor_role,action,reason,"before","after",committed_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      randomUUID(),
      clientId,
      resourceId,
      actor.id,
      actor.role,
      action,
      command.reason,
      before == null ? null : JSON.stringify(before),
      JSON.stringify(after),
      committedAt,
    ],
  );
}
async function apply(
  db: PoolClient,
  actor: StaffContext,
  command: RegistryCommand,
  committedAt: string,
): Promise<RegistryReceipt> {
  let resourceId: string;
  let clientId: string;
  let kind: RegistryReceipt['resourceKind'];
  let revision: number | null;
  switch (command.type) {
    case 'client.create': {
      resourceId = randomUUID();
      clientId = resourceId;
      kind = 'client';
      revision = 1;
      const row = (
        await db.query(
          `INSERT INTO control_plane.registry_client(id,code,name,contact_name,contact_email,registered_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING *`,
          [
            resourceId,
            command.code,
            command.name,
            command.contactName,
            command.contactEmail,
            committedAt,
          ],
        )
      ).rows[0];
      await recordAudit(
        db,
        actor,
        command,
        clientId,
        resourceId,
        'client.created',
        null,
        clientDto(row),
        committedAt,
      );
      break;
    }
    case 'client.update': {
      const before = await clientRow(db, command.id);
      if (before.revision !== command.revision)
        throw new AccessError(409, 'Client changed; reload before saving');
      resourceId = command.id;
      clientId = resourceId;
      kind = 'client';
      revision = command.revision + 1;
      const row = (
        await db.query(
          `UPDATE control_plane.registry_client SET name=$2,contact_name=$3,contact_email=$4,archived=$5,revision=revision+1,updated_at=$6 WHERE id=$1 RETURNING *`,
          [
            command.id,
            command.name,
            command.contactName,
            command.contactEmail,
            command.archived,
            committedAt,
          ],
        )
      ).rows[0];
      await recordAudit(
        db,
        actor,
        command,
        clientId,
        resourceId,
        'client.updated',
        clientDto(before),
        clientDto(row),
        committedAt,
      );
      break;
    }
    case 'installation.create': {
      await clientRow(db, command.clientId, true);
      const count = (
        await db.query(
          'SELECT count(*)::int AS count FROM control_plane.registry_installation WHERE client_id=$1',
          [command.clientId],
        )
      ).rows[0].count;
      if (count >= INSTALLATIONS_PER_CLIENT)
        throw new AccessError(409, 'Installation limit reached for this client');
      resourceId = randomUUID();
      clientId = command.clientId;
      kind = 'installation';
      revision = null;
      const row = (
        await db.query(
          `INSERT INTO control_plane.registry_installation(id,client_id,environment,label,local_installation_id,tenant_id,registered_at)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            resourceId,
            clientId,
            command.environment,
            command.label,
            command.localInstallationId,
            command.tenantId,
            committedAt,
          ],
        )
      ).rows[0];
      await recordAudit(
        db,
        actor,
        command,
        clientId,
        resourceId,
        'installation.created',
        null,
        installationDto(row),
        committedAt,
      );
      break;
    }
    case 'product.create': {
      await clientRow(db, command.clientId, true);
      const installation = (
        await db.query(
          'SELECT id FROM control_plane.registry_installation WHERE id=$1 AND client_id=$2',
          [command.installationId, command.clientId],
        )
      ).rows[0];
      if (!installation) throw new AccessError(404, 'Installation not found for this client');
      resourceId = randomUUID();
      clientId = command.clientId;
      kind = 'product';
      revision = 1;
      await db.query(
        `INSERT INTO control_plane.registry_product(id,client_id,installation_id,product,application_id,policy_changed_by,registered_at,policy_changed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$7)`,
        [
          resourceId,
          clientId,
          command.installationId,
          command.binding.product,
          command.binding.applicationId,
          actor.id,
          committedAt,
        ],
      );
      const row = (await db.query(`${productSelect} WHERE p.id=$1`, [resourceId])).rows[0];
      await recordAudit(
        db,
        actor,
        command,
        clientId,
        resourceId,
        'product.registered',
        null,
        productDto(row),
        committedAt,
      );
      break;
    }
    case 'product.policy': {
      if (command.decision === 'approve') await assertAuthority(db);
      writer(actor, true);
      if (command.decision === 'suspend' && actor.role !== 'admin')
        throw new AccessError(403, 'Suspension requires an Administrator');
      const before = (
        await db.query(`${productSelect} WHERE p.id=$1 FOR UPDATE OF p`, [command.id])
      ).rows[0];
      if (!before) throw new AccessError(404, 'Product not found');
      if (before.revision !== command.revision)
        throw new AccessError(409, 'Product policy changed; reload before deciding');
      const target = { approve: 'approved', reject: 'rejected', suspend: 'suspended' }[
        command.decision
      ];
      if (before.policy_state === target)
        throw new AccessError(409, 'Product already has this policy state');
      if (command.decision === 'reject' && before.policy_state !== 'pending')
        throw new AccessError(
          409,
          'Only a pending product can be rejected; suspend an approved product',
        );
      if (command.decision === 'approve' && !before.pairing_verified_at)
        throw new AccessError(409, 'Verified product pairing is required before approval');
      resourceId = command.id;
      clientId = before.client_id;
      kind = 'product';
      revision = command.revision + 1;
      await db.query(
        `UPDATE control_plane.registry_product SET policy_state=$2,revision=revision+1,policy_reason=$3,policy_changed_by=$4,policy_changed_at=$5,
        first_approved_at=CASE WHEN $2='approved' THEN COALESCE(first_approved_at,$5::timestamptz) ELSE first_approved_at END,
        last_approved_at=CASE WHEN $2='approved' THEN $5::timestamptz ELSE last_approved_at END WHERE id=$1`,
        [resourceId, target, command.reason, actor.id, committedAt],
      );
      const row = (await db.query(`${productSelect} WHERE p.id=$1`, [resourceId])).rows[0];
      const action =
        target === 'approved' && before.first_approved_at
          ? 'product.reapproved'
          : `product.${target}`;
      await recordAudit(
        db,
        actor,
        command,
        clientId,
        resourceId,
        action,
        productDto(before),
        productDto(row),
        committedAt,
      );
      break;
    }
  }
  return receipt.parse({
    requestId: command.requestId,
    resourceKind: kind,
    resourceId,
    clientId,
    revision,
    committedAt,
  });
}
export async function executeRegistry(headers: Headers, raw: unknown) {
  const command = registryCommand.parse(raw);
  const session = await identity(headers);
  if (!session) throw new AccessError(401, 'Sign in required');
  const digest = createHash('sha256').update(JSON.stringify(command)).digest('hex');
  try {
    return await transaction(async (db) => {
      // Same lock as staff administration/recovery: actor changes cannot race a mutation.
      // Transactions contain only bounded SQL, never SMTP, crypto hashing or remote calls.
      await db.query('SELECT pg_advisory_xact_lock($1)', [STAFF_LOCK]);
      const actor = await staffContext(session.session.id, db);
      writer(actor, command.type === 'product.policy');
      if (
        command.type === 'product.policy' &&
        command.decision === 'suspend' &&
        actor.role !== 'admin'
      )
        throw new AccessError(403, 'Suspension requires an Administrator');
      const saved = (
        await db.query(
          'SELECT actor_id,digest,result FROM control_plane.registry_receipt WHERE request_id=$1',
          [command.requestId],
        )
      ).rows[0];
      if (saved) {
        if (saved.actor_id !== actor.id || saved.digest !== digest)
          throw new AccessError(409, 'Request identifier was already used with different inputs');
        return receipt.parse(saved.result);
      }
      const committedAt = iso(
        (await db.query('SELECT clock_timestamp() AS committed_at')).rows[0].committed_at,
      );
      const result = await apply(db, actor, command, committedAt);
      await db.query(
        'INSERT INTO control_plane.registry_receipt(request_id,actor_id,digest,result,committed_at) VALUES($1,$2,$3,$4,$5)',
        [command.requestId, actor.id, digest, JSON.stringify(result), committedAt],
      );
      return result;
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
      throw new AccessError(
        409,
        'A registry record with this code, environment or binding already exists',
      );
    throw error;
  }
}
export async function listClients(headers: Headers, query: unknown) {
  await requireStaff(headers);
  const input = registryQuery.parse(query);
  const search = `%${input.q.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_')}%`;
  const rows = (
    await runtime().pool.query(
      `SELECT * FROM control_plane.registry_client
    WHERE ($1='all' OR archived=($1='archived')) AND (code ILIKE $2 ESCAPE '!' OR name ILIKE $2 ESCAPE '!')
    AND ($3::text IS NULL OR code>$3) ORDER BY code LIMIT $4`,
      [input.archived, search, input.after ?? null, REGISTRY_PAGE_SIZE + 1],
    )
  ).rows;
  return clientList.parse({
    clients: rows.slice(0, REGISTRY_PAGE_SIZE).map(clientDto),
    nextCursor: rows.length > REGISTRY_PAGE_SIZE ? rows[REGISTRY_PAGE_SIZE - 1].code : null,
  });
}
export async function getClient(headers: Headers, rawId: string) {
  await requireStaff(headers);
  const id = z.uuid().parse(rawId);
  const db = await runtime().pool.connect();
  try {
    // A coherent readback cannot mix parent revisions with older child/audit snapshots.
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const row = (await db.query('SELECT * FROM control_plane.registry_client WHERE id=$1', [id]))
      .rows[0];
    if (!row) throw new AccessError(404, 'Client not found');
    const installations = (
      await db.query(
        'SELECT * FROM control_plane.registry_installation WHERE client_id=$1 ORDER BY environment LIMIT $2',
        [id, INSTALLATIONS_PER_CLIENT],
      )
    ).rows.map(installationDto);
    const products = (
      await db.query(
        `${productSelect} WHERE p.client_id=$1 ORDER BY i.environment,p.product LIMIT $2`,
        [id, INSTALLATIONS_PER_CLIENT * 2],
      )
    ).rows.map(productDto);
    const activity = (
      await db.query(
        'SELECT * FROM control_plane.registry_audit WHERE client_id=$1 ORDER BY committed_at DESC,id DESC LIMIT 50',
        [id],
      )
    ).rows.map((a) =>
      auditRecord.parse({
        id: a.id,
        clientId: a.client_id,
        resourceId: a.resource_id,
        action: a.action,
        actorId: a.actor_id,
        actorRole: a.actor_role,
        reason: a.reason,
        before: a.before,
        after: a.after,
        committedAt: iso(a.committed_at),
      }),
    );
    const result = clientDetail.parse({
      client: clientDto(row),
      installations,
      products,
      activity,
    });
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
export async function getReceipt(headers: Headers, rawId: string) {
  const actor = await requireStaff(headers);
  const id = z.uuid().parse(rawId);
  const row = (
    await runtime().pool.query(
      'SELECT result FROM control_plane.registry_receipt WHERE request_id=$1 AND actor_id=$2',
      [id, actor.id],
    )
  ).rows[0];
  if (!row) throw new AccessError(404, 'Receipt not found');
  return receipt.parse(row.result);
}
