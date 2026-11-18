import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOCUMENTS_PERMISSIONS,
  documentsValidatorCommandSchema,
} from '@thaarei/turnstile-contracts/documents';
import { configurationNameKey } from '@thaarei/turnstile-contracts/runtime';
import { withProductOperator } from '../../infrastructure/database/product-operator.js';
import { readAccess } from '../access/access-evaluator.js';
import { canonicalAccessReady } from '../access/access-safety.js';
import {
  commandDigest,
  lockAccess,
  recordAccessChange,
  replayCommand,
  saveCommand,
} from '../access/access-transactions.js';
import { verifyOperatorSubject } from '../access/operator-identity.js';
import { operatorSession } from '../access/operator-session.js';

// Private owning command. Verification finishes before acquiring database locks.
export async function documentsAccessOperator(input: unknown, environment = process.env) {
  const command = documentsValidatorCommandSchema.parse(input);
  const administrator = await verifyOperatorSubject(
    command.operatorUserId,
    await operatorSession(command.operatorUserId, command.operatorCookie, environment),
    environment,
  );
  const target =
    command.action === 'revoke'
      ? null
      : await verifyOperatorSubject(
          command.targetUserId,
          await operatorSession(command.targetUserId, command.targetCookie, environment),
          environment,
        );
  const { operatorCookie: _operatorCookie, ...withoutOperatorCookie } = command;
  const { targetCookie: _targetCookie, ...safe } = {
    ...withoutOperatorCookie,
    targetCookie: command.action === 'revoke' ? undefined : command.targetCookie,
  };
  return withProductOperator(environment, async (db, installed) => {
    const tenant = installed.tenant_id;
    if (!(await canonicalAccessReady(db, tenant, environment)))
      throw new Error('Canonical access release required');
    const context = await lockAccess(db, tenant);
    const fresh = (proof: typeof administrator | null) =>
      proof && proof.expiresAt > Date.now() && Date.now() - proof.checkedAt < 10000;
    if (
      !fresh(administrator) ||
      !(await readAccess(db, tenant, command.operatorUserId)).protectedAdministrator
    )
      throw new Error('Current verified protected administrator required');
    const receipt = {
      operatorId: command.operatorUserId,
      key: command.key,
      operation: `documents.${command.action}`,
      digest: commandDigest(safe),
    };
    if (await replayCommand(db, tenant, receipt))
      return { replayed: true, revision: context.revision, roleId: command.roleId };
    if (context.revision !== command.expectedAccessRevision)
      throw new Error('Access revision changed');
    const member = (
      await db.query<{ id: string; status: string }>(
        'SELECT id,status FROM turnstile.access_member WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE',
        [tenant, command.targetUserId],
      )
    ).rows[0];
    if (
      !member ||
      (command.action !== 'revoke' &&
        (member.status !== 'active' ||
          !fresh(target) ||
          (await readAccess(db, tenant, command.targetUserId)).status !== 'active'))
    )
      throw new Error('Existing active verified target required');
    const role = (
      await db.query<{ system_key: string | null }>(
        'SELECT system_key FROM turnstile.access_role WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
        [tenant, command.roleId],
      )
    ).rows[0];
    if (role?.system_key) throw new Error('Custom role required');
    const existing = (
      await db.query<{ permission: string }>(
        'SELECT permission FROM turnstile.access_role_permission WHERE tenant_id=$1 AND role_id=$2',
        [tenant, command.roleId],
      )
    ).rows.map((row) => row.permission);
    if (
      existing.some(
        (p) =>
          p !== 'turnstile:access' && !(DOCUMENTS_PERMISSIONS as readonly string[]).includes(p),
      )
    )
      throw new Error('Dedicated Documents role required');
    const allowedUsers = [
      command.targetUserId,
      ...(command.action === 'handover' ? [command.fromUserId] : []),
    ];
    if (
      (
        await db.query(
          `SELECT 1 FROM turnstile.access_assignment a JOIN turnstile.access_member m ON m.tenant_id=a.tenant_id AND m.id=a.member_id WHERE a.tenant_id=$1 AND a.role_id=$2 AND (m.user_id<>ALL($3::text[]) OR a.scope_kind<>'company') LIMIT 1`,
          [tenant, command.roleId, allowedUsers],
        )
      ).rowCount
    )
      throw new Error('Role has other assignments');
    let fromMemberId: string | undefined;
    if (command.action !== 'revoke') {
      // One transaction makes the release fence durable before any permission becomes visible.
      if (!role) {
        if (
          Number(
            (
              await db.query('SELECT count(*) FROM turnstile.access_role WHERE tenant_id=$1', [
                tenant,
              ])
            ).rows[0].count,
          ) >= 128
        )
          throw new Error('Role capacity');
        const name = `Documents validator ${command.roleId.slice(0, 8)}`;
        await db.query(
          'INSERT INTO turnstile.access_role(tenant_id,id,name,name_key) VALUES($1,$2,$3,$4)',
          [tenant, command.roleId, name, configurationNameKey(name)],
        );
      } else
        await db.query(
          'UPDATE turnstile.access_role SET version=version+1,permission_version=permission_version+1 WHERE tenant_id=$1 AND id=$2',
          [tenant, command.roleId],
        );
      await db.query(
        'DELETE FROM turnstile.access_role_permission WHERE tenant_id=$1 AND role_id=$2',
        [tenant, command.roleId],
      );
      await db.query(
        'INSERT INTO turnstile.access_role_permission(tenant_id,role_id,permission) SELECT $1,$2,unnest($3::text[])',
        [tenant, command.roleId, command.permissions],
      );
      if (command.action === 'handover') {
        const removed = await db.query(
          `DELETE FROM turnstile.access_assignment a USING turnstile.access_member m WHERE a.tenant_id=$1 AND a.role_id=$2 AND m.tenant_id=a.tenant_id AND m.id=a.member_id AND m.user_id=$3 RETURNING a.member_id`,
          [tenant, command.roleId, command.fromUserId],
        );
        if (!removed.rowCount) throw new Error('Existing handover source required');
        fromMemberId = removed.rows[0].member_id;
        await db.query(
          'UPDATE turnstile.access_member SET version=version+1 WHERE tenant_id=$1 AND user_id=$2',
          [tenant, command.fromUserId],
        );
      }
      await db.query(
        `INSERT INTO turnstile.access_assignment(tenant_id,id,member_id,role_id,scope_kind,include_children,scope_key) VALUES($1,$2,$3,$4,'company',false,'company') ON CONFLICT(tenant_id,member_id,role_id,scope_key) DO NOTHING`,
        [tenant, randomUUID(), member.id, command.roleId],
      );
    } else {
      if (!role) throw new Error('Existing Documents role required');
      await db.query(
        "DELETE FROM turnstile.access_assignment WHERE tenant_id=$1 AND member_id=$2 AND role_id=$3 AND scope_kind='company'",
        [tenant, member.id, command.roleId],
      );
    }
    await db.query(
      'UPDATE turnstile.access_member SET version=version+1 WHERE tenant_id=$1 AND id=$2',
      [tenant, member.id],
    );
    await recordAccessChange(db, tenant, context.revision, {
      operatorId: command.operatorUserId,
      requestId: command.key,
      action: 'member_assignments_changed',
      activateDocumentsContract: command.action !== 'revoke',
      reviewedReason: command.reason,
      subjectId: member.id,
      userId: command.targetUserId,
      ...(fromMemberId && command.action === 'handover'
        ? { additionalSubject: { id: fromMemberId, userId: command.fromUserId } }
        : {}),
    });
    await saveCommand(db, tenant, receipt, member.id);
    return { replayed: false, revision: context.revision + 1, roleId: command.roleId };
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    if (process.stdin.isTTY || process.argv.length !== 2)
      throw new Error('Private JSON stdin required');
    let raw = '';
    for await (const chunk of process.stdin) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 16384) throw new Error('Input too large');
    }
    console.log(JSON.stringify(await documentsAccessOperator(JSON.parse(raw))));
  } catch {
    console.error('Documents access command failed; preserve its key and review current access.');
    process.exitCode = 1;
  }
}
