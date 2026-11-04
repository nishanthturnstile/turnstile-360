import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  accessRevisionSchema,
  PEOPLE_LIMITS,
  peopleIdSchema,
  peopleSubjectSchema,
} from '@thaarei/turnstile-contracts';
import { z } from 'zod';
import { invitationSchemaSafe } from '../../infrastructure/database/invitation-safety.js';
import { peopleSchemaSafe } from '../../infrastructure/database/people-safety.js';
import { withProductOperator } from '../../infrastructure/database/product-operator.js';
import { IdentityServiceTransport } from '../../integrations/identity/identity-service-transport.js';
import { parseInvitationEnvironment } from '../people/invitation-environment.js';
import { accessCounts, readAccess } from './access-evaluator.js';
import { accessOperator } from './access-operator.js';
import { accessSchemaSafe, canonicalAccessReady } from './access-safety.js';
import {
  AccessInvariantError,
  commandDigest,
  lockAccess,
  replayCommand,
  saveCommand,
} from './access-transactions.js';
import { verifyOperatorSubject } from './operator-identity.js';
import { operatorSession } from './operator-session.js';
import { ACCESS_RELEASE_VERSION, invitationRecoveryEpoch } from './release-state.js';

const base = { operatorId: peopleSubjectSchema };
const command = { ...base, key: peopleIdSchema, expectedRevision: accessRevisionSchema };
const administrator = {
  administratorUserId: peopleSubjectSchema,
  administratorCookie: z.string().min(1).max(8192),
};
const operations = {
  verify: z.strictObject(base),
  'verify-login': z.strictObject({ ...base, ...administrator }),
  'bootstrap-administrator': z.strictObject({ ...command, ...administrator }),
  open: z.strictObject({
    ...command,
    ...administrator,
    releaseId: z.string().regex(/^[0-9a-f]{64}$/),
    incompatibleProcessesStopped: z.literal(true),
  }),
  close: z.strictObject(command),
  recover: z.strictObject({ ...command, incompatibleProcessesStopped: z.literal(true) }),
};
export type ReleaseOperation = keyof typeof operations;

export async function releaseOperator(
  operation: ReleaseOperation,
  input: unknown,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const schema = operations[operation];
  if (!schema) throw new Error('Unknown release operation');
  schema.parse(input);
  const selected = ['open', 'bootstrap-administrator', 'verify-login'].includes(operation)
    ? z.object(administrator).parse(input)
    : undefined;
  const session = selected
    ? await operatorSession(selected.administratorUserId, selected.administratorCookie, environment)
    : undefined;
  if (operation === 'bootstrap-administrator') {
    const value = operations['bootstrap-administrator'].parse(input);
    return accessOperator(
      'bootstrap-administrator',
      {
        operatorId: value.operatorId,
        key: value.key,
        expectedRevision: value.expectedRevision,
        userId: value.administratorUserId,
        identityAccessToken: session,
      },
      environment,
    );
  }
  const open = operation === 'open' ? operations.open.parse(input) : undefined;
  const proof =
    selected && session
      ? await verifyOperatorSubject(selected.administratorUserId, session, environment)
      : undefined;
  const epoch = invitationRecoveryEpoch(environment);
  if (open || operation === 'verify-login') {
    parseInvitationEnvironment(environment);
    await new IdentityServiceTransport(environment).verifyRelease();
  }
  if (operation === 'recover' && !epoch) throw new Error('New external invitation epoch required');
  return withProductOperator(environment, async (db, installation) => {
    const tenant = installation.tenant_id;
    if (
      !(await accessSchemaSafe(db)) ||
      !(await invitationSchemaSafe(db)) ||
      !(await peopleSchemaSafe(db))
    )
      throw new Error('Unsafe feature schema');
    const context = await lockAccess(db, tenant);
    const read = async () => {
      const row = (
        await db.query<{
          release_version: number;
          release_id: string | null;
          recovery_epoch: string | null;
          public_writes_enabled: boolean;
          revision: number;
        }>(
          'SELECT release_version,release_id,recovery_epoch,public_writes_enabled,revision FROM turnstile.access_context WHERE tenant_id=$1',
          [tenant],
        )
      ).rows[0];
      if (!row || row.release_version !== ACCESS_RELEASE_VERSION)
        throw new Error('Incompatible release capability');
      return row;
    };
    const state = await read();
    const imported = (
      await db.query<{ safe: boolean }>(
        `SELECT NOT EXISTS(
        SELECT 1 FROM turnstile.user_access old LEFT JOIN turnstile.access_member m ON m.tenant_id=old.tenant_id AND m.user_id=old.user_id
        LEFT JOIN turnstile.access_legacy_source l ON l.tenant_id=m.tenant_id AND l.member_id=m.id
        WHERE old.tenant_id=$1 AND (m.id IS NULL OR l.id IS NULL)) AS safe`,
        [tenant],
      )
    ).rows[0];
    const result = async (changed = false, replayed = false) => {
      const current = await read();
      return {
        action: `release-${operation}`,
        tenantId: tenant,
        applicationId: installation.application_id,
        releaseVersion: current.release_version,
        releaseId: current.release_id,
        publicWritesEnabled: current.public_writes_enabled,
        revision: current.revision,
        recoveryEpochBound: current.recovery_epoch !== null,
        ready: imported?.safe === true && (await canonicalAccessReady(db, tenant, environment)),
        changed,
        replayed,
      };
    };
    if (operation === 'verify') return result();
    if (operation === 'verify-login') {
      if (
        !proof ||
        !selected ||
        !imported?.safe ||
        proof.expiresAt <= Date.now() ||
        Date.now() - proof.checkedAt > 10000 ||
        !(await canonicalAccessReady(db, tenant, environment))
      )
        throw new Error('Current administrator identity required');
      const access = await readAccess(db, tenant, selected.administratorUserId);
      if (access.status !== 'active' || !access.protectedAdministrator)
        throw new Error('Protected administrator required');
      return { ...(await result()), administratorVerified: true };
    }
    const value = commandSchema(input);
    const receipt = {
      operatorId: value.operatorId,
      key: value.key,
      operation: `release.${operation}`,
      digest: commandDigest({
        operation,
        operatorId: value.operatorId,
        expectedRevision: value.expectedRevision,
        ...(open
          ? { releaseId: open.releaseId, administratorUserId: open.administratorUserId }
          : {}),
        ...(operation === 'recover' ? { recoveryEpoch: epoch } : {}),
      }),
    };
    if (await replayCommand(db, tenant, receipt)) return result(false, true);
    if (context.revision !== value.expectedRevision)
      throw new AccessInvariantError('ACCESS_CONFLICT');
    const ensureRevision = () => {
      if (context.revision >= 2147483647)
        throw new AccessInvariantError('ACCESS_REVISION_EXHAUSTED');
    };
    let changed = false;
    if (open) {
      if (!proof || proof.expiresAt <= Date.now() || Date.now() - proof.checkedAt > 10000)
        throw new Error('Administrator identity proof expired');
      if (!(await canonicalAccessReady(db, tenant, environment)))
        throw new Error('Release capability not ready');
      const access = await readAccess(db, tenant, open.administratorUserId);
      const counts = await accessCounts(db, tenant);
      if (
        access.status !== 'active' ||
        !access.protectedAdministrator ||
        counts.administrators < 1 ||
        counts.managers < 1
      )
        throw new Error('Verified protected administrator required');
      if (!imported?.safe) throw new Error('Incomplete legacy import');
      if (state.public_writes_enabled && state.release_id !== open.releaseId)
        throw new Error('Close incompatible processes before changing release');
      changed = !state.public_writes_enabled || state.release_id !== open.releaseId;
      if (changed) ensureRevision();
      if (changed)
        await db.query(
          `UPDATE turnstile.access_context SET public_writes_enabled=true,
        release_id=$2,recovery_epoch=$3,released_by=$4,released_at=statement_timestamp(),revision=revision+1 WHERE tenant_id=$1`,
          [tenant, open.releaseId, epoch, value.operatorId],
        );
    } else if (operation === 'close') {
      changed = state.public_writes_enabled;
      if (changed) ensureRevision();
      if (changed)
        await db.query(
          'UPDATE turnstile.access_context SET public_writes_enabled=false,revision=revision+1 WHERE tenant_id=$1',
          [tenant],
        );
    } else {
      if (
        state.recovery_epoch === epoch ||
        (
          await db.query(
            'SELECT 1 FROM turnstile.invitation_generation WHERE tenant_id=$1 AND recovery_epoch=$2 LIMIT 1',
            [tenant, epoch],
          )
        ).rowCount
      )
        throw new Error('Rotate the external recovery epoch before restore recovery');
      ensureRevision();
      await db.query(
        'UPDATE turnstile.access_context SET public_writes_enabled=false,recovery_epoch=$2,revision=revision+1 WHERE tenant_id=$1',
        [tenant, epoch],
      );
      // Preserve terminal memberships/history. Invalidate actionable approvals in
      // bounded batches and quarantine every restored queued/in-flight payload.
      while (true) {
        const pending = (
          await db.query<{ id: string }>(
            "SELECT id FROM turnstile.invitation WHERE tenant_id=$1 AND state='pending' ORDER BY id LIMIT 1000",
            [tenant],
          )
        ).rows;
        if (!pending.length) break;
        await db.query('SELECT turnstile.invalidate_invitations($1,$2::uuid[])', [
          tenant,
          pending.map((r) => r.id),
        ]);
      }
      await db.query(
        `WITH retired AS (UPDATE turnstile.invitation_delivery SET state='failed',payload=NULL,
        reason='stale_generation',outcome_at=statement_timestamp(),lease_id=NULL,lease_expires_at=NULL
        WHERE tenant_id=$1 AND state IN ('queued','sending') RETURNING invitation_id,generation)
        INSERT INTO turnstile.invitation_audit(tenant_id,id,invitation_id,generation,actor_kind,action)
        SELECT $1,gen_random_uuid(),invitation_id,generation,'system','delivery_failed' FROM retired`,
        [tenant],
      );
      changed = true;
    }
    if (changed)
      await db.query(
        `INSERT INTO turnstile.access_audit
      (tenant_id,id,actor_kind,actor_id,request_id,action,revision_before,revision_after)
      VALUES($1,$2,'operator',$3,$4,$5,$6,$6+1)`,
        [
          tenant,
          randomUUID(),
          value.operatorId,
          value.key,
          operation === 'open'
            ? 'release_opened'
            : operation === 'close'
              ? 'release_closed'
              : 'release_recovered',
          context.revision,
        ],
      );
    await saveCommand(db, tenant, receipt);
    return result(changed);
  });
}

function commandSchema(input: unknown) {
  return z.object(command).parse(input);
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
      JSON.stringify(await releaseOperator(operation as ReleaseOperation, JSON.parse(input))),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        code: error instanceof AccessInvariantError ? error.code : 'RELEASE_OPERATOR_FAILED',
      }),
    );
    process.exitCode = 1;
  }
}
