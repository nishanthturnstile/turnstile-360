import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUSINESS_MODULES,
  businessModuleIdSchema,
  canonicalPeopleName,
  configurationNameKey,
  peopleIdSchema,
  peopleSubjectSchema,
} from '@thaarei/turnstile-contracts';
import { z } from 'zod';
import { withProductOperator } from '../../infrastructure/database/product-operator.js';
import { covers, readAccess } from '../access/access-evaluator.js';
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

const base = {
  operatorId: peopleSubjectSchema,
  key: peopleIdSchema,
  expectedRevision: z.number().int().min(0).max(2147483646),
  userId: peopleSubjectSchema,
  moduleId: businessModuleIdSchema,
  roleId: peopleIdSchema,
  reason: z.string().trim().min(1).max(300),
};
export const moduleGrantCommand = z.discriminatedUnion('action', [
  z
    .object({
      ...base,
      action: z.literal('grant'),
      identityAccessToken: z.string().min(1).max(8192),
    })
    .strict(),
  z.object({ ...base, action: z.literal('revoke') }).strict(),
]);
/** Private owning role administration. Explicit grants never create deployment authority. */
export async function moduleAccessOperator(raw: unknown, environment = process.env) {
  const command = moduleGrantCommand.parse(raw);
  const proof =
    command.action === 'grant'
      ? await verifyOperatorSubject(command.userId, command.identityAccessToken, environment)
      : null;
  return withProductOperator(environment, async (db, installed) => {
    const tenant = installed.tenant_id;
    if (!(await canonicalAccessReady(db, tenant, environment)))
      throw new Error('Canonical access release required');
    const context = await lockAccess(db, tenant);
    const { identityAccessToken: _token, ...safe } =
      command.action === 'grant' ? command : { ...command, identityAccessToken: undefined };
    const receipt = {
      operatorId: command.operatorId,
      key: command.key,
      operation: `module.${command.action}`,
      digest: commandDigest(safe),
    };
    if (await replayCommand(db, tenant, receipt))
      return { replayed: true, revision: context.revision, userId: command.userId };
    if (context.revision !== command.expectedRevision) throw new Error('Access revision changed');
    const member = (
      await db.query(
        'SELECT id,status FROM turnstile.access_member WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE',
        [tenant, command.userId],
      )
    ).rows[0];
    if (!member) throw new Error('Existing admitted membership required');
    const definition = BUSINESS_MODULES.find((m) => m.id === command.moduleId);
    if (!definition) throw new Error('Unknown module');
    const name = canonicalPeopleName(80).parse(`${definition.title} reader`),
      nameKey = configurationNameKey(name);
    const role = (
      await db.query(
        'SELECT id,name_key,system_key FROM turnstile.access_role WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
        [tenant, command.roleId],
      )
    ).rows[0];
    if (role) {
      const permissions = (
        await db.query(
          'SELECT permission FROM turnstile.access_role_permission WHERE tenant_id=$1 AND role_id=$2 ORDER BY permission',
          [tenant, command.roleId],
        )
      ).rows.map((r) => r.permission);
      if (
        role.system_key !== null ||
        role.name_key !== nameKey ||
        permissions.length !== 2 ||
        !permissions.includes('turnstile:access') ||
        !permissions.includes(definition.permission)
      )
        throw new Error('Reviewed module reader role required');
    }
    let changed = false;
    if (command.action === 'grant') {
      if (
        !proof ||
        proof.expiresAt <= Date.now() ||
        Date.now() - proof.checkedAt > 10000 ||
        member.status !== 'active' ||
        !covers(await readAccess(db, tenant, command.userId), 'turnstile:access', {
          kind: 'company',
        })
      )
        throw new Error('Current active user proof and shell entry required');
      if (!role) {
        const count = Number(
          (
            await db.query(
              'SELECT count(*) AS count FROM turnstile.access_role WHERE tenant_id=$1',
              [tenant],
            )
          ).rows[0].count,
        );
        if (count >= 128) throw new Error('Role limit reached');
        await db.query(
          'INSERT INTO turnstile.access_role(tenant_id,id,name,name_key) VALUES($1,$2,$3,$4)',
          [tenant, command.roleId, name, nameKey],
        );
        await db.query(
          'INSERT INTO turnstile.access_role_permission(tenant_id,role_id,permission) SELECT $1,$2,unnest($3::text[])',
          [tenant, command.roleId, ['turnstile:access', definition.permission]],
        );
        changed = true;
      }
      const added = await db.query(
        "INSERT INTO turnstile.access_assignment(tenant_id,id,member_id,role_id,scope_kind,include_children,scope_key) VALUES($1,$2,$3,$4,'company',false,'company') ON CONFLICT(tenant_id,member_id,role_id,scope_key) DO NOTHING",
        [tenant, randomUUID(), member.id, command.roleId],
      );
      changed = changed || (added.rowCount ?? 0) > 0;
    } else if (role) {
      const removed = await db.query(
        "DELETE FROM turnstile.access_assignment WHERE tenant_id=$1 AND member_id=$2 AND role_id=$3 AND scope_kind='company'",
        [tenant, member.id, command.roleId],
      );
      changed = (removed.rowCount ?? 0) > 0;
    }
    if (changed) {
      await db.query(
        'UPDATE turnstile.access_member SET version=version+1 WHERE tenant_id=$1 AND id=$2',
        [tenant, member.id],
      );
      await recordAccessChange(db, tenant, context.revision, {
        operatorId: command.operatorId,
        requestId: command.key,
        action: 'member_assignments_changed',
        subjectId: member.id,
        userId: command.userId,
      });
    }
    await saveCommand(db, tenant, receipt, member.id);
    return {
      replayed: false,
      changed,
      revision: context.revision + Number(changed),
      userId: command.userId,
      moduleId: command.moduleId,
      roleId: command.roleId,
    };
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    if (process.stdin.isTTY || process.argv.length !== 2)
      throw new Error('Private JSON input required');
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > 16384) throw new Error('Bounded input required');
    }
    const raw = z
      .object({ userCookie: z.string().min(1).max(8192).optional() })
      .passthrough()
      .parse(JSON.parse(input));
    const { userCookie, ...command } = raw;
    if (userCookie) {
      if (command.action !== 'grant' || command.identityAccessToken !== undefined)
        throw new Error('One current normal-login subject proof required');
      command.identityAccessToken = await operatorSession(
        peopleSubjectSchema.parse(command.userId),
        userCookie,
        process.env,
      );
    }
    console.log(JSON.stringify(await moduleAccessOperator(command)));
  } catch {
    console.error(
      'Private module permission operation failed; preserve its request identity and reconcile current access.',
    );
    process.exitCode = 1;
  }
}
