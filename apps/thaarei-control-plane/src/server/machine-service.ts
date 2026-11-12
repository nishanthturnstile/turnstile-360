import { ingestReport } from './report-ingestion.ts';
import 'server-only';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  activateRequest,
  audience,
  type Binding,
  binding,
  type Decision,
  MAX_DECISION_SECONDS,
  machineReceipt,
  machineStatusRequest,
  machineStatusResponse,
  pairingCommand,
  RENEW_BELOW_SECONDS,
  rotateRequest,
  sameBinding,
} from '@thaarei/control-plane-contracts';
import {
  type VersionedDecision,
  versionedDecision,
  versionedSyncRequest,
  versionedSyncResponse,
} from '@thaarei/module-catalog';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import type { PoolClient } from 'pg';
import {
  AccessError,
  transaction as dbTransaction,
  identity,
  requireStaff,
  STAFF_LOCK,
  staffContext,
} from './access.ts';
import { assertAuthority, digest, signDecision, signingKeyId } from './machine-signing.ts';
import { moduleDecisionPolicy } from './module-decision-policy.ts';
import { moduleHandover } from './module-handover-service.ts';
import { runtime } from './runtime.ts';

async function transaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  try {
    return await dbTransaction(fn);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
      throw new AccessError(409, 'Protocol identifier conflict; reconcile the existing operation');
    throw error;
  }
}
const productSelect = `SELECT p.*,i.local_installation_id,i.tenant_id,a.minimum_version,a.document AS module_authority FROM control_plane.registry_product p JOIN control_plane.registry_installation i ON i.id=p.installation_id AND i.client_id=p.client_id LEFT JOIN control_plane.module_authority a ON a.product_id=p.id`;
async function product(db: PoolClient, id: string) {
  const row = (await db.query(`${productSelect} WHERE p.id=$1 FOR UPDATE OF p`, [id])).rows[0];
  if (!row) throw new AccessError(404, 'Product not found');
  const expected = binding.parse({
    clientId: row.client_id,
    installationId: row.installation_id,
    productId: row.id,
    localInstallationId: row.local_installation_id,
    tenantId: row.tenant_id,
    product: row.product,
    applicationId: row.application_id,
  });
  return {
    expected,
    policyState: row.policy_state as Decision['state'],
    revision: Number(row.revision),
    paired: !!row.pairing_verified_at,
    minimumVersion: Number(row.minimum_version ?? 1),
    moduleAuthority: row.module_authority ?? null,
  };
}
function exact(expected: Binding, submitted: Binding) {
  if (!sameBinding(expected, submitted)) throw new AccessError(409, 'Product binding mismatch');
}
function credential(headers: Headers) {
  // Staff sessions and customer JWTs never enter a machine authentication adapter.
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(headers.get('authorization') ?? '');
  if (!match?.[1]) throw new AccessError(401, 'Product machine credential required');
  return digest(match[1]);
}
async function credentialProduct(db: PoolClient, keyDigest: string) {
  const row = (
    await db.query(
      'SELECT product_id FROM control_plane.machine WHERE secret_digest=$1 AND revoked_at IS NULL',
      [keyDigest],
    )
  ).rows[0];
  if (!row) throw new AccessError(401, 'Invalid product machine credential');
  return String(row.product_id);
}
async function authenticate(db: PoolClient, productId: string, keyDigest: string) {
  const row = (
    await db.query('SELECT * FROM control_plane.machine WHERE product_id=$1 FOR UPDATE', [
      productId,
    ])
  ).rows[0];
  if (
    !row ||
    row.revoked_at ||
    !timingSafeEqual(Buffer.from(row.secret_digest), Buffer.from(keyDigest))
  )
    throw new AccessError(401, 'Invalid product machine credential');
  return {
    epoch: String(row.epoch),
    generation: Number(row.generation),
    operationId: String(row.operation_id),
    sequence: Number(row.sequence),
  };
}
export async function setupExport(headers: Headers, id: string) {
  await requireStaff(headers);
  return transaction(async (db) => {
    const { expected } = await product(db, id);
    return { version: 1 as const, origin: runtime().config.origin, binding: expected };
  });
}
export async function executePairing(headers: Headers, raw: unknown) {
  const command = pairingCommand.parse(raw);
  const session = await identity(headers);
  if (!session) throw new AccessError(401, 'Sign in required');
  return transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock($1)', [STAFF_LOCK]);
    const actor = await staffContext(session.session.id, db);
    if (
      !actor.recent ||
      !['admin', 'operator'].includes(actor.role) ||
      (['replace', 'revoke-credential'].includes(command.action) && actor.role !== 'admin')
    )
      throw new AccessError(403, 'Recent MFA and authorized staff role required');
    await assertAuthority(db);
    const hash = digest(JSON.stringify(command));
    const previous = (
      await db.query(
        'SELECT actor_id,digest,result FROM control_plane.registry_receipt WHERE request_id=$1',
        [command.requestId],
      )
    ).rows[0];
    if (previous) {
      if (previous.actor_id !== actor.id || previous.digest !== hash)
        throw new AccessError(409, 'Request identifier conflict');
      return previous.result;
    }
    const p = await product(db, command.productId);
    if (p.revision !== command.revision) throw new AccessError(409, 'Product changed; reload');
    const live = (
      await db.query('SELECT * FROM control_plane.machine WHERE product_id=$1 FOR UPDATE', [
        command.productId,
      ])
    ).rows[0];
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 86400000);
    if (command.action === 'issue' && live)
      throw new AccessError(409, 'Existing machine requires Administrator replacement');
    if (command.action === 'replace' || command.action === 'revoke-credential') {
      if (!live) throw new AccessError(409, 'No machine to replace or revoke');
      await db.query(
        'UPDATE control_plane.machine SET revoked_at=$2,current_acknowledged_at=NULL WHERE product_id=$1',
        [command.productId, now],
      );
      await db.query(
        `UPDATE control_plane.registry_product SET pairing_verified_at=NULL,policy_state=CASE WHEN policy_state='approved' THEN 'suspended' ELSE policy_state END,revision=revision+1,policy_reason=$2,policy_changed_by=$3,policy_changed_at=$4 WHERE id=$1`,
        [command.productId, command.reason, actor.id, now],
      );
    }
    if (command.action === 'revoke') {
      const result = await db.query(
        'UPDATE control_plane.pairing SET revoked_at=$3 WHERE id=$1 AND product_id=$2 AND consumed_at IS NULL AND revoked_at IS NULL',
        [command.pairingId, command.productId, now],
      );
      if (!result.rowCount) throw new AccessError(409, 'Pairing code is unavailable');
    } else {
      await db.query(
        'UPDATE control_plane.pairing SET revoked_at=$2 WHERE product_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL',
        [command.productId, now],
      );
      if (command.action !== 'revoke-credential')
        await db.query(
          'INSERT INTO control_plane.pairing(id,product_id,code_digest,issued_at,expires_at) VALUES($1,$2,$3,$4,$5)',
          [command.pairingId, command.productId, digest(command.code ?? ''), now, expiresAt],
        );
    }
    const result = {
      requestId: command.requestId,
      pairingId: command.pairingId,
      productId: command.productId,
      revision: p.revision + (['replace', 'revoke-credential'].includes(command.action) ? 1 : 0),
      expiresAt: expiresAt.toISOString(),
      binding: p.expected,
      origin: runtime().config.origin,
    };
    await db.query(
      'INSERT INTO control_plane.registry_receipt(request_id,actor_id,digest,result,committed_at) VALUES($1,$2,$3,$4,$5)',
      [command.requestId, actor.id, hash, JSON.stringify(result), now],
    );
    await db.query(
      `INSERT INTO control_plane.registry_audit(id,client_id,resource_id,actor_id,actor_role,action,reason,before,after,committed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        randomUUID(),
        p.expected.clientId,
        command.productId,
        actor.id,
        actor.role,
        `pairing.${command.action}`,
        command.reason,
        JSON.stringify({ policyState: p.policyState, revision: p.revision }),
        JSON.stringify({ pairingId: command.pairingId, revision: result.revision }),
        now,
      ],
    );
    return result;
  });
}
export async function activate(raw: unknown) {
  const input = activateRequest.parse(raw);
  const hash = digest(JSON.stringify(input));
  return transaction(async (db) => {
    await assertAuthority(db);
    const p = await product(db, input.binding.productId);
    exact(p.expected, input.binding);
    const code = (
      await db.query(
        'SELECT * FROM control_plane.pairing WHERE id=$1 AND product_id=$2 FOR UPDATE',
        [input.pairingId, p.expected.productId],
      )
    ).rows[0];
    const now = new Date();
    if (!code || code.revoked_at || code.code_digest !== digest(input.code))
      throw new AccessError(401, 'Invalid pairing code');
    if (code.consumed_at) {
      const current = await authenticate(db, p.expected.productId, digest(input.candidateSecret));
      if (
        code.request_id !== input.requestId ||
        code.input_digest !== hash ||
        now.getTime() - new Date(code.consumed_at).getTime() > 86400000 ||
        current.operationId !== input.requestId
      )
        throw new AccessError(
          409,
          'Pairing receipt unavailable; use candidate sync or reviewed repair',
        );
      return machineReceipt.parse(code.receipt);
    }
    if (new Date(code.expires_at).getTime() <= now.getTime())
      throw new AccessError(409, 'Pairing expired');
    const existing = (
      await db.query('SELECT * FROM control_plane.machine WHERE product_id=$1 FOR UPDATE', [
        p.expected.productId,
      ])
    ).rows[0];
    if (existing && !existing.revoked_at) throw new AccessError(409, 'Product is already paired');
    const epoch = randomUUID();
    const generation = existing ? Number(existing.generation) + 1 : 1;
    const result = machineReceipt.parse({
      version: 1,
      requestId: input.requestId,
      binding: p.expected,
      epoch,
      generation,
      operationId: input.requestId,
    });
    await db.query(
      `INSERT INTO control_plane.machine(product_id,epoch,generation,secret_digest,operation_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(product_id) DO UPDATE SET epoch=$2,generation=$3,secret_digest=$4,operation_id=$5,revoked_at=NULL,sequence=0,current_acknowledged_at=NULL`,
      [p.expected.productId, epoch, generation, digest(input.candidateSecret), input.requestId],
    );
    await db.query('UPDATE control_plane.registry_product SET pairing_verified_at=$2 WHERE id=$1', [
      p.expected.productId,
      now,
    ]);
    await db.query(
      'UPDATE control_plane.pairing SET consumed_at=$2,request_id=$3,input_digest=$4,receipt=$5 WHERE id=$1',
      [input.pairingId, now, input.requestId, hash, JSON.stringify(result)],
    );
    return result;
  });
}
export async function rotate(headers: Headers, raw: unknown) {
  const keyDigest = credential(headers);
  const input = rotateRequest.parse(raw);
  const hash = digest(JSON.stringify(input));
  return transaction(async (db) => {
    await assertAuthority(db);
    const p = await product(db, await credentialProduct(db, keyDigest));
    exact(p.expected, input.binding);
    const current = await authenticate(db, p.expected.productId, keyDigest);
    if (current.epoch !== input.epoch || current.generation !== input.expectedGeneration)
      throw new AccessError(409, 'Rotation generation changed; confirm durable candidate');
    if (digest(input.candidateSecret) === keyDigest)
      throw new AccessError(400, 'Rotation requires a fresh credential');
    const previous = (
      await db.query('SELECT id FROM control_plane.machine_receipt WHERE id=$1', [
        input.operationId,
      ])
    ).rows[0];
    if (previous) throw new AccessError(409, 'Operation identifier was already used');
    const result = machineReceipt.parse({
      version: 1,
      requestId: input.operationId,
      binding: p.expected,
      epoch: current.epoch,
      generation: current.generation + 1,
      operationId: input.operationId,
    });
    await db.query(
      'UPDATE control_plane.machine SET generation=generation+1,secret_digest=$2,operation_id=$3 WHERE product_id=$1',
      [p.expected.productId, digest(input.candidateSecret), input.operationId],
    );
    await db.query(
      "INSERT INTO control_plane.machine_receipt(id,product_id,kind,digest,result) VALUES($1,$2,'rotate',$3,$4)",
      [input.operationId, p.expected.productId, hash, JSON.stringify(result)],
    );
    return result;
  });
}
export async function sync(headers: Headers, raw: unknown) {
  const keyDigest = credential(headers);
  const input = versionedSyncRequest.parse(raw);
  const hash = digest(JSON.stringify(input));
  const kid = signingKeyId();
  // Record authenticated candidate inventory independently. A wrong active-profile sync
  // stays a conflict (never a different policy at the same revision), while staff can
  // review the candidate observation for an explicit, newer activation.
  if (input.version === 2)
    await transaction(async (db) => {
      await assertAuthority(db);
      const p = await product(db, await credentialProduct(db, keyDigest));
      exact(p.expected, input.binding);
      const current = await authenticate(db, p.expected.productId, keyDigest);
      if (p.minimumVersion !== 2 || (input.epoch !== null && input.epoch !== current.epoch))
        throw new AccessError(409, 'Current v2 pairing required');
      await db.query(
        `INSERT INTO control_plane.module_observation(product_id,epoch,installed) VALUES($1,$2,$3)
      ON CONFLICT(product_id) DO UPDATE SET epoch=EXCLUDED.epoch,installed=EXCLUDED.installed,observed_at=clock_timestamp()`,
        [p.expected.productId, current.epoch, JSON.stringify(input.installed)],
      );
    });
  const reserved = await transaction(async (db) => {
    await assertAuthority(db);
    const p = await product(db, await credentialProduct(db, keyDigest));
    exact(p.expected, input.binding);
    const current = await authenticate(db, p.expected.productId, keyDigest);
    if (input.version < p.minimumVersion)
      throw new AccessError(409, 'Product permanently requires v2 module decisions');
    if (input.version === 2 && p.minimumVersion !== 2)
      throw new AccessError(409, 'Reviewed v2 enforcement is required before module sync');
    const policy =
      input.version === 2
        ? await moduleDecisionPolicy(
            { binding: p.expected, epoch: current.epoch, policyRevision: p.revision },
            p.policyState,
            p.moduleAuthority,
            input.installed,
          ).catch(() => {
            throw new AccessError(409, 'Module authority context requires reconciliation');
          })
        : p.policyState === 'approved'
          ? { state: 'approved' as const, entitlement: 'product-business' as const }
          : { state: p.policyState };
    if (input.epoch !== null && current.epoch !== input.epoch)
      throw new AccessError(409, 'Binding epoch changed; reviewed rebind required');
    const previous = (
      await db.query('SELECT * FROM control_plane.machine_receipt WHERE id=$1', [input.reportId])
    ).rows[0];
    if (
      previous &&
      (previous.product_id !== p.expected.productId ||
        previous.kind !== 'sync' ||
        previous.digest !== hash)
    )
      throw new AccessError(409, 'Report identifier conflict');
    if (
      !previous &&
      input.report?.sequence !== undefined &&
      (
        await db.query(
          "SELECT 1 FROM control_plane.machine_receipt WHERE product_id=$1 AND kind='sync' AND result ? 'reportSequence' AND result->>'reportEpoch'=$2 AND (result->>'reportSequence')::bigint=$3",
          [p.expected.productId, current.epoch, input.report.sequence],
        )
      ).rowCount
    )
      throw new AccessError(409, 'Report sequence reused');
    if (!previous)
      await db.query(
        "INSERT INTO control_plane.machine_receipt(id,product_id,kind,digest,result) VALUES($1,$2,'sync',$3,$4)",
        [
          input.reportId,
          p.expected.productId,
          hash,
          JSON.stringify({
            receiptId: input.reportId,
            ...(input.report?.sequence !== undefined
              ? { reportEpoch: current.epoch, reportSequence: input.report.sequence }
              : {}),
          }),
        ],
      );
    if (!previous && input.report)
      await ingestReport(db, p.expected.productId, current.epoch, input.reportId, input.report);
    if (input.applied) {
      const proof = (
        await db.query(
          `SELECT issued_at,expires_at FROM control_plane.machine_decision WHERE id=$1 AND product_id=$2 AND epoch=$3 AND revision=$4 AND sequence=$5 AND state='approved'`,
          [
            input.applied.decisionId,
            p.expected.productId,
            current.epoch,
            input.applied.policyRevision,
            input.applied.decisionSequence,
          ],
        )
      ).rows[0];
      // Acknowledgement is product-reported application evidence, never server-measured uptime.
      if (
        proof &&
        input.applied.appliedAt >= new Date(proof.issued_at).getTime() / 1000 &&
        input.applied.appliedAt < new Date(proof.expires_at).getTime() / 1000 &&
        input.applied.appliedAt <= Date.now() / 1000
      ) {
        await db.query(
          `INSERT INTO control_plane.machine_application(product_id,epoch,decision_id,applied_at)
           VALUES($1,$2,$3,to_timestamp($4))
           ON CONFLICT(product_id) DO UPDATE SET epoch=EXCLUDED.epoch,decision_id=EXCLUDED.decision_id,
             applied_at=EXCLUDED.applied_at,received_at=clock_timestamp()
           WHERE machine_application.epoch<>EXCLUDED.epoch OR EXISTS(
             SELECT 1 FROM control_plane.machine_decision incoming,control_plane.machine_decision prior
             WHERE incoming.id=EXCLUDED.decision_id AND prior.id=machine_application.decision_id
               AND (incoming.revision,incoming.sequence)>(prior.revision,prior.sequence))`,
          [p.expected.productId, current.epoch, input.applied.decisionId, input.applied.appliedAt],
        );
        await db.query(
          'UPDATE control_plane.machine SET first_acknowledged_at=COALESCE(first_acknowledged_at,clock_timestamp()),current_acknowledged_at=COALESCE(current_acknowledged_at,clock_timestamp()) WHERE product_id=$1',
          [p.expected.productId],
        );
      }
    }
    await db.query(
      'UPDATE control_plane.machine SET last_contact_at=clock_timestamp() WHERE product_id=$1',
      [p.expected.productId],
    );
    const cached = (
      await db.query(
        'SELECT * FROM control_plane.machine_decision WHERE product_id=$1 AND epoch=$2 AND revision=$3 ORDER BY sequence DESC LIMIT 1',
        [p.expected.productId, current.epoch, p.revision],
      )
    ).rows[0];
    const now = Math.floor(Date.now() / 1000);
    if (
      cached &&
      decodeJwt(cached.token).version === input.version &&
      decodeProtectedHeader(cached.token).kid === kid &&
      new Date(cached.expires_at).getTime() / 1000 - now >= RENEW_BELOW_SECONDS
    )
      return { p, current, cached: String(cached.token), claims: null };
    const seq = current.sequence + 1;
    await db.query('UPDATE control_plane.machine SET sequence=$2 WHERE product_id=$1', [
      p.expected.productId,
      seq,
    ]);
    const claims = versionedDecision.parse({
      version: input.version,
      iss: runtime().config.origin,
      aud: audience(p.expected),
      binding: p.expected,
      epoch: current.epoch,
      policyRevision: p.revision,
      decisionSequence: seq,
      decisionId: randomUUID(),
      iat: now,
      nbf: now,
      exp: now + MAX_DECISION_SECONDS,
      ...policy,
    });
    return { p, current, cached: null, claims };
  });
  // Signing/network work never runs inside a transaction. Recheck policy/epoch/generation
  // after signing so a concurrent suspension/replacement fences this response.
  const token = reserved.cached ?? (await signDecision(reserved.claims as VersionedDecision));
  return transaction(async (db) => {
    await assertAuthority(db);
    const p = await product(db, await credentialProduct(db, keyDigest));
    const current = await authenticate(db, p.expected.productId, keyDigest);
    if (
      signingKeyId() !== kid ||
      decodeProtectedHeader(token).kid !== kid ||
      p.revision !== reserved.p.revision ||
      p.minimumVersion !== reserved.p.minimumVersion ||
      JSON.stringify(p.moduleAuthority) !== JSON.stringify(reserved.p.moduleAuthority) ||
      p.policyState !== reserved.p.policyState ||
      current.epoch !== reserved.current.epoch ||
      current.generation !== reserved.current.generation ||
      (reserved.claims && current.sequence !== reserved.claims.decisionSequence)
    )
      throw new AccessError(409, 'Decision changed during issuance; retry current sync');
    if (reserved.claims) {
      const c = reserved.claims;
      await db.query(
        'INSERT INTO control_plane.machine_decision(id,product_id,epoch,revision,sequence,state,token,issued_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          c.decisionId,
          p.expected.productId,
          c.epoch,
          c.policyRevision,
          c.decisionSequence,
          c.state,
          token,
          new Date(c.iat * 1000),
          new Date(c.exp * 1000),
        ],
      );
      if (c.state === 'approved')
        await db.query(
          'UPDATE control_plane.machine SET first_issued_at=COALESCE(first_issued_at,clock_timestamp()) WHERE product_id=$1',
          [p.expected.productId],
        );
    }
    return versionedSyncResponse.parse({
      version: input.version,
      receiptId: input.reportId,
      binding: p.expected,
      epoch: current.epoch,
      generation: current.generation,
      operationId: current.operationId,
      decision: token,
    });
  });
}

/** Authenticated own-product readback; never issues credentials, decisions or grants. */
export async function machineStatus(headers: Headers, raw: unknown) {
  const input = machineStatusRequest.parse(raw),
    keyDigest = credential(headers);
  return transaction(async (db) => {
    await assertAuthority(db);
    const p = await product(db, await credentialProduct(db, keyDigest));
    exact(p.expected, input.binding);
    const current = await authenticate(db, p.expected.productId, keyDigest);
    if (current.epoch !== input.epoch) throw new AccessError(409, 'Current pairing epoch required');
    const projection = await moduleHandover(db, p.expected.installationId);
    const own = projection.handover.products.find((v) => v.productId === p.expected.productId);
    if (!own) throw new AccessError(409, 'Current product unavailable');
    const desired =
      p.expected.product === 'turnstile'
        ? (
            await db.query(
              `SELECT e.revision,e.document FROM control_plane.module_assignment_state s JOIN control_plane.module_assignment_entry e ON e.id=s.desired_id AND e.product_id=s.product_id WHERE s.product_id=$1`,
              [p.expected.productId],
            )
          ).rows[0]
        : null;
    return machineStatusResponse.parse({
      version: 1,
      binding: p.expected,
      epoch: current.epoch,
      policyRevision: own.revision,
      policyState: own.policyState,
      paired: own.paired,
      activationAcknowledged: own.acknowledged,
      moduleDesired: desired
        ? {
            catalogueDigest: desired.document.profile.catalogueDigest,
            profileDigest: desired.document.profileDigest,
            assignmentRevision: desired.revision,
          }
        : null,
      lastContactAt: own.lastContactAt,
      reportReceivedAt: own.reportReceivedAt,
      reportFreshness: own.reportFreshness,
    });
  });
}
