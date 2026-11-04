import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  accessRevisionSchema,
  PEOPLE_LIMITS,
  peopleIdSchema,
  peopleSubjectSchema,
  peopleVersionSchema,
} from '@thaarei/turnstile-contracts';
import { z } from 'zod';
import { pruneInvitationRecords } from '../../infrastructure/database/invitation-maintenance.js';
import { invitationSchemaSafe } from '../../infrastructure/database/invitation-safety.js';
import { peopleSchemaSafe } from '../../infrastructure/database/people-safety.js';
import { withProductOperator } from '../../infrastructure/database/product-operator.js';
import { accessCounts, type EffectiveAccess, readAccess } from './access-evaluator.js';
import { accessSchemaSafe, canonicalAccessReady } from './access-safety.js';
import {
  AccessInvariantError,
  commandDigest,
  enforceProtectedCounts,
  importLegacyAccess,
  lockAccess,
  recordAccessChange,
  replayCommand,
  saveCommand,
} from './access-transactions.js';
import { verifyOperatorSubject } from './operator-identity.js';

const base = { operatorId: peopleSubjectSchema };
const command = {
  ...base,
  key: peopleIdSchema,
  expectedRevision: accessRevisionSchema,
  userId: peopleSubjectSchema,
};
const operations = {
  verify: z.strictObject(base),
  initialize: z.strictObject(base),
  inspect: z.strictObject({ ...base, userId: peopleSubjectSchema.optional() }),
  prune: z.strictObject(base),
  'retire-legacy': z.strictObject({ ...command, expectedLegacyVersion: peopleVersionSchema }),
  'bootstrap-administrator': z.strictObject({
    ...command,
    identityAccessToken: z.string().min(1).max(8192),
  }),
  'handover-administrator': z.strictObject({
    ...command,
    fromUserId: peopleSubjectSchema,
    identityAccessToken: z.string().min(1).max(8192),
  }),
};
export type AccessOperation = keyof typeof operations;

function currentMember(access: EffectiveAccess) {
  return {
    id: access.memberId,
    version: access.memberVersion,
    status: access.status,
    protectedAdministrator: access.protectedAdministrator,
    access: access.context,
  };
}

export async function accessOperator(
  operation: AccessOperation,
  input: unknown,
  environment = process.env,
) {
  const schema = operations[operation];
  if (!schema) throw new Error('Unknown access operation');
  const parsed = schema.parse(input);
  const value =
    operation === 'retire-legacy'
      ? operations['retire-legacy'].parse(input)
      : operation === 'bootstrap-administrator'
        ? operations['bootstrap-administrator'].parse(input)
        : operation === 'handover-administrator'
          ? operations['handover-administrator'].parse(input)
          : undefined;
  const proof =
    value && 'identityAccessToken' in value
      ? await verifyOperatorSubject(value.userId, value.identityAccessToken, environment)
      : undefined;
  return withProductOperator(environment, async (client, installed) => {
    const tenantId = installed.tenant_id;
    if (!(await invitationSchemaSafe(client)) || !(await peopleSchemaSafe(client)))
      throw new Error('People schema unsafe');
    if (!(await accessSchemaSafe(client))) throw new Error('Access schema unsafe');
    const resultBase = {
      action: `access-${operation}`,
      operatorId: parsed.operatorId,
      tenantId,
      applicationId: installed.application_id,
    };
    const publicWrites = async () =>
      (
        await client.query<{ public_writes_enabled: boolean }>(
          'SELECT public_writes_enabled FROM turnstile.access_context WHERE tenant_id=$1',
          [tenantId],
        )
      ).rows[0]?.public_writes_enabled ?? false;
    if (operation === 'verify') {
      if (!(await canonicalAccessReady(client, tenantId, environment)))
        throw new Error('Canonical access not ready');
      return {
        ...resultBase,
        ...(await lockAccess(client, tenantId)),
        modelVersion: 1,
        publicWritesEnabled: await publicWrites(),
      };
    }
    if (operation === 'initialize') {
      const changed = await importLegacyAccess(client, tenantId, parsed.operatorId);
      return {
        ...resultBase,
        changed,
        ...(await lockAccess(client, tenantId)),
        publicWritesEnabled: await publicWrites(),
      };
    }
    const context = await lockAccess(client, tenantId);
    if (operation === 'inspect') {
      const selected = operations.inspect.parse(input).userId;
      if (selected) {
        const current = await readAccess(client, tenantId, selected);
        const legacySource =
          (
            await client.query(
              `SELECT id,version,permissions,retired FROM turnstile.access_legacy_source
          WHERE tenant_id = $1 AND member_id = $2`,
              [tenantId, current.memberId],
            )
          ).rows[0] ?? null;
        return {
          ...resultBase,
          ...context,
          userId: selected,
          current: currentMember(current),
          legacySource,
          publicWritesEnabled: await publicWrites(),
        };
      }
      const members = (
        await client.query(
          `SELECT id,user_id,status,version,count(*) OVER()::int AS total
        FROM turnstile.access_member WHERE tenant_id = $1 ORDER BY user_id COLLATE "C" LIMIT 100`,
          [tenantId],
        )
      ).rows;
      const audit = (
        await client.query(
          `SELECT id,actor_kind,actor_id,request_id,action,subject_id,subject_user_id,revision_before,revision_after,occurred_at
        FROM turnstile.access_audit WHERE tenant_id = $1 ORDER BY occurred_at DESC,id DESC LIMIT 100`,
          [tenantId],
        )
      ).rows;
      return {
        ...resultBase,
        ...context,
        counts: await accessCounts(client, tenantId),
        members: {
          total: members[0]?.total ?? 0,
          entries: members.map(({ total: _total, ...row }) => row),
        },
        audit,
        roles: (
          await client.query(
            'SELECT id,system_key,name,version,permission_version FROM turnstile.access_role WHERE tenant_id = $1 ORDER BY id LIMIT 128',
            [tenantId],
          )
        ).rows,
        publicWritesEnabled: await publicWrites(),
      };
    }
    if (operation === 'prune') {
      const audit = await client.query(
        `DELETE FROM turnstile.access_audit WHERE tenant_id = $1 AND id IN
        (SELECT id FROM turnstile.access_audit WHERE tenant_id = $1 AND occurred_at < statement_timestamp() - interval '90 days' ORDER BY occurred_at,id LIMIT $2)`,
        [tenantId, PEOPLE_LIMITS.maintenanceRows],
      );
      const receipts = await client.query(
        `DELETE FROM turnstile.access_command_receipt WHERE tenant_id = $1 AND (actor_id,key) IN
        (SELECT actor_id,key FROM turnstile.access_command_receipt WHERE tenant_id = $1 AND expires_at <= statement_timestamp() ORDER BY expires_at,actor_id,key LIMIT $2)`,
        [tenantId, PEOPLE_LIMITS.maintenanceRows - (audit.rowCount ?? 0)],
      );
      const impacts = await client.query(
        `DELETE FROM turnstile.access_impact_receipt WHERE tenant_id = $1 AND id IN
        (SELECT id FROM turnstile.access_impact_receipt WHERE tenant_id = $1 AND expires_at <= statement_timestamp() ORDER BY expires_at,id LIMIT $2)`,
        [
          tenantId,
          PEOPLE_LIMITS.maintenanceRows - (audit.rowCount ?? 0) - (receipts.rowCount ?? 0),
        ],
      );
      return {
        ...resultBase,
        ...context,
        auditDeleted: audit.rowCount,
        receiptsDeleted: receipts.rowCount,
        impactsDeleted: impacts.rowCount,
        invitationsDeleted: await pruneInvitationRecords(
          client,
          tenantId,
          Math.max(
            0,
            PEOPLE_LIMITS.maintenanceRows -
              (audit.rowCount ?? 0) -
              (receipts.rowCount ?? 0) -
              (impacts.rowCount ?? 0),
          ),
        ),
      };
    }
    if (!value) throw new Error('Access command required');
    const receipt = {
      operatorId: value.operatorId,
      key: value.key,
      operation:
        operation === 'retire-legacy'
          ? 'legacy.retire'
          : operation === 'handover-administrator'
            ? 'administrator.handover'
            : 'administrator.bootstrap',
      digest: commandDigest({
        operation,
        operatorId: value.operatorId,
        userId: value.userId,
        expectedRevision: value.expectedRevision,
        ...('expectedLegacyVersion' in value
          ? { expectedLegacyVersion: value.expectedLegacyVersion }
          : {}),
        ...('fromUserId' in value ? { fromUserId: value.fromUserId } : {}),
      }),
    };
    const replayed = await replayCommand(client, tenantId, receipt);
    if (replayed)
      return {
        ...resultBase,
        ...context,
        changed: false,
        replayed: true,
        current: currentMember(await readAccess(client, tenantId, value.userId)),
      };
    if (context.revision !== value.expectedRevision)
      throw new AccessInvariantError('ACCESS_CONFLICT');
    const before = await accessCounts(client, tenantId);
    let target = (
      await client.query<{ id: string; status: string }>(
        'SELECT id,status FROM turnstile.access_member WHERE tenant_id = $1 AND user_id = $2 FOR UPDATE',
        [tenantId, value.userId],
      )
    ).rows[0];
    let changed = false;
    let formerAdministrator: { id: string; userId: string } | undefined;
    if ('expectedLegacyVersion' in value) {
      if (!target) throw new AccessInvariantError('ACCESS_CONFLICT');
      const legacy = (
        await client.query<{ version: number; retired: boolean }>(
          'SELECT version,retired FROM turnstile.access_legacy_source WHERE tenant_id = $1 AND member_id = $2 FOR UPDATE',
          [tenantId, target.id],
        )
      ).rows[0];
      if (!legacy || legacy.version !== value.expectedLegacyVersion)
        throw new AccessInvariantError('ACCESS_CONFLICT');
      if (!legacy.retired) {
        await client.query(
          'UPDATE turnstile.access_legacy_source SET retired = true,version = version + 1 WHERE tenant_id = $1 AND member_id = $2',
          [tenantId, target.id],
        );
        await client.query(
          'UPDATE turnstile.access_member SET version = version + 1 WHERE tenant_id = $1 AND id = $2',
          [tenantId, target.id],
        );
        changed = true;
      }
    } else {
      if (!proof || proof.expiresAt <= Date.now() || Date.now() - proof.checkedAt > 10000)
        throw new Error('Identity proof expired');
      if (target?.status === 'suspended') throw new AccessInvariantError('ACCESS_CONFLICT');
      if ('fromUserId' in value) {
        const fromUserId = value.fromUserId;
        if (typeof fromUserId !== 'string' || fromUserId === value.userId)
          throw new AccessInvariantError('ACCESS_CONFLICT');
        const former = await readAccess(client, tenantId, fromUserId);
        if (!former.protectedAdministrator || !former.memberId)
          throw new AccessInvariantError('ACCESS_CONFLICT');
        formerAdministrator = { id: former.memberId, userId: fromUserId };
      }
      if (!target) {
        target = { id: randomUUID(), status: 'active' };
        await client.query(
          'INSERT INTO turnstile.access_member (tenant_id,id,user_id,status) VALUES ($1,$2,$3,$4)',
          [tenantId, target.id, value.userId, target.status],
        );
      }
      const role = (
        await client.query<{ id: string }>(
          "SELECT id FROM turnstile.access_role WHERE tenant_id = $1 AND system_key = 'workspace_administrator'",
          [tenantId],
        )
      ).rows[0];
      if (!role) throw new Error('Administrator template unavailable');
      const grant = await client.query(
        `INSERT INTO turnstile.access_assignment (tenant_id,id,member_id,role_id,scope_kind,include_children,scope_key)
        VALUES ($1,$2,$3,$4,'company',false,'company') ON CONFLICT (tenant_id,member_id,role_id,scope_key) DO NOTHING`,
        [tenantId, randomUUID(), target.id, role.id],
      );
      changed = (grant.rowCount ?? 0) > 0;
      if (changed)
        await client.query(
          'UPDATE turnstile.access_member SET version = version + 1 WHERE tenant_id = $1 AND id = $2',
          [tenantId, target.id],
        );
      if ('fromUserId' in value) {
        await client.query(
          `DELETE FROM turnstile.access_assignment a USING turnstile.access_member m
          WHERE a.tenant_id = $1 AND a.role_id = $2 AND m.tenant_id = a.tenant_id AND m.id = a.member_id AND m.user_id = $3`,
          [tenantId, role.id, value.fromUserId],
        );
        await client.query(
          'UPDATE turnstile.access_member SET version = version + 1 WHERE tenant_id = $1 AND user_id = $2',
          [tenantId, value.fromUserId],
        );
        changed = true;
      }
    }
    await enforceProtectedCounts(client, tenantId, before);
    if (changed)
      await recordAccessChange(client, tenantId, context.revision, {
        operatorId: value.operatorId,
        requestId: value.key,
        action:
          operation === 'retire-legacy'
            ? 'legacy_retired'
            : operation === 'handover-administrator'
              ? 'administrator_handed_over'
              : 'administrator_bootstrapped',
        subjectId: target?.id,
        userId: value.userId,
        ...(formerAdministrator ? { additionalSubject: formerAdministrator } : {}),
      });
    await saveCommand(client, tenantId, receipt, target?.id);
    return {
      ...resultBase,
      revision: context.revision + Number(changed),
      changed,
      replayed: false,
      current: currentMember(await readAccess(client, tenantId, value.userId)),
    };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const operation = process.argv[2];
    if (
      !Object.hasOwn(operations, operation ?? '') ||
      process.argv.length !== 3 ||
      process.stdin.isTTY
    )
      throw new Error('Private operation/input required');
    process.stdin.setEncoding('utf8');
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > PEOPLE_LIMITS.bodyBytes) throw new Error('Input too large');
    }
    console.log(
      JSON.stringify(await accessOperator(operation as AccessOperation, JSON.parse(input))),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        code: error instanceof AccessInvariantError ? error.code : 'ACCESS_OPERATOR_FAILED',
      }),
    );
    process.exitCode = 1;
  }
}
