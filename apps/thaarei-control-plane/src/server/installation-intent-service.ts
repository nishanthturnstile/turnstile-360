import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { INTENT_AUDIENCE, installationIntent } from '@thaarei/module-catalog';
import { z } from 'zod';
import { assignmentDocument } from '../contracts/module-assignments.ts';
import { AccessError, identity, STAFF_LOCK, staffContext, transaction } from './access.ts';
import {
  assertAuthority,
  signInstallationIntent,
  verifyOwnInstallationIntent,
} from './machine-signing.ts';
import { readAssignment } from './module-assignment-service.ts';
import { findDelivery } from './module-delivery-service.ts';
import { runtime } from './runtime.ts';

export const intentCommand = z
  .object({
    operationId: z.uuid(),
    expectedRevision: z.number().int().positive(),
    reason: z.string().trim().min(1).max(300),
  })
  .strict();
/** A current intent is metadata only. No pairing code, credential, shell or activation is issued here. */
export async function issueInstallationIntent(headers: Headers, rawId: string, raw: unknown) {
  const id = z.uuid().parse(rawId),
    command = intentCommand.parse(raw),
    session = await identity(headers);
  if (!session) throw new AccessError(401, 'Sign in required');
  const prepared = await readAssignment(headers, id);
  const digest = createHash('sha256')
    .update(JSON.stringify({ kind: 'installation.intent', id, command }))
    .digest('hex');
  const payload = await transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock($1)', [STAFF_LOCK]);
    const actor = await staffContext(session.session.id, db);
    if (!['admin', 'operator'].includes(actor.role) || !actor.recent)
      throw new AccessError(403, 'Current Admin or Operator MFA required');
    await assertAuthority(db);
    const prior = (
      await db.query(
        'SELECT actor_id,digest,result FROM control_plane.module_receipt WHERE request_id=$1',
        [command.operationId],
      )
    ).rows[0];
    if (prior) {
      if (prior.actor_id !== actor.id || prior.digest !== digest)
        throw new AccessError(409, 'Operation identifier already used');
      return installationIntent.parse(prior.result);
    }
    const row = (
      await db.query(
        `SELECT p.*,i.local_installation_id,i.tenant_id,i.environment,c.code,c.archived,
   d.id AS dms_id,e.revision AS assignment_revision,e.document
   FROM control_plane.registry_product p JOIN control_plane.registry_installation i ON i.id=p.installation_id AND i.client_id=p.client_id
   JOIN control_plane.registry_client c ON c.id=p.client_id
   JOIN control_plane.registry_product d ON d.installation_id=i.id AND d.product='dms'
   JOIN control_plane.module_assignment_state s ON s.product_id=p.id JOIN control_plane.module_assignment_entry e ON e.id=s.desired_id AND e.product_id=p.id
   WHERE p.id=$1 AND p.product='turnstile' FOR UPDATE OF p`,
        [id],
      )
    ).rows[0];
    if (!row || row.archived || row.revision !== command.expectedRevision)
      throw new AccessError(409, 'Current approved desired assignment required');
    const reserved = (
      await db.query(
        "SELECT 1 FROM control_plane.registry_audit WHERE resource_id=$1 AND action='installation.reserved' LIMIT 1",
        [row.installation_id],
      )
    ).rowCount;
    if (!reserved)
      throw new AccessError(
        409,
        'Fresh central reservation required; use owning export for adoption',
      );
    const desired = assignmentDocument.parse(row.document),
      delivery = prepared.delivery;
    if (
      prepared.productRevision !== row.revision ||
      prepared.desired?.document.profileDigest !== desired.profileDigest
    )
      throw new AccessError(409, 'Assignment changed during preparation');
    if (!delivery) throw new AccessError(409, 'Verified matching package required');
    const now = Math.floor(Date.now() / 1000);
    const result = installationIntent.parse({
      version: 1,
      iss: runtime().config.origin,
      aud: INTENT_AUDIENCE,
      intentId: id,
      intentRevision: row.revision,
      mode: 'fresh',
      binding: {
        clientId: row.client_id,
        installationId: row.installation_id,
        productId: id,
        localInstallationId: row.local_installation_id,
        tenantId: row.tenant_id,
        product: 'turnstile',
        applicationId: row.application_id,
      },
      dmsProductId: row.dms_id,
      desired: {
        catalogueDigest: desired.profile.catalogueDigest,
        profileDigest: desired.profileDigest,
        assignmentRevision: row.assignment_revision,
      },
      releaseId: delivery.inventory.releaseId,
      environment: row.environment,
      customerKey: String(row.code).toLowerCase().replaceAll('_', '-'),
      iat: now,
      nbf: now,
      exp: now + 86400,
    });
    await db.query(
      'INSERT INTO control_plane.module_receipt(request_id,actor_id,digest,result) VALUES($1,$2,$3,$4)',
      [command.operationId, actor.id, digest, JSON.stringify(result)],
    );
    await db.query(
      `INSERT INTO control_plane.registry_audit(id,client_id,resource_id,actor_id,actor_role,action,reason,"after") VALUES($1,$2,$3,$4,$5,'installation.intent',$6,$7)`,
      [
        randomUUID(),
        row.client_id,
        id,
        actor.id,
        actor.role,
        command.reason,
        JSON.stringify({
          intentId: id,
          revision: row.revision,
          profileDigest: desired.profileDigest,
          releaseId: result.releaseId,
        }),
      ],
    );
    return result;
  });
  return { intent: await signInstallationIntent(payload) };
}

/** A valid public intent can check freshness only; this creates no credential or artifact access. */
export async function installationIntentStatus(raw: unknown) {
  const { intent } = z
    .object({ intent: z.string().min(1).max(16384) })
    .strict()
    .parse(raw);
  let value: Awaited<ReturnType<typeof verifyOwnInstallationIntent>>;
  try {
    value = await verifyOwnInstallationIntent(intent);
  } catch {
    throw new AccessError(400, 'Invalid or expired installation intent');
  }
  await assertAuthority(runtime().pool);
  const row = (
    await runtime().pool.query(
      `SELECT p.revision,c.archived,e.revision AS assignment_revision,e.document
 FROM control_plane.registry_product p JOIN control_plane.registry_client c ON c.id=p.client_id
 JOIN control_plane.module_assignment_state s ON s.product_id=p.id JOIN control_plane.module_assignment_entry e ON e.id=s.desired_id AND e.product_id=p.id
 WHERE p.id=$1 AND p.installation_id=$2 AND p.client_id=$3`,
      [value.binding.productId, value.binding.installationId, value.binding.clientId],
    )
  ).rows[0];
  if (
    !row ||
    row.archived ||
    row.revision < value.intentRevision ||
    row.assignment_revision !== value.desired.assignmentRevision
  )
    return { current: false };
  const document = assignmentDocument.parse(row.document);
  if (
    document.profileDigest !== value.desired.profileDigest ||
    document.profile.catalogueDigest !== value.desired.catalogueDigest
  )
    return { current: false };
  const delivery = await findDelivery(document);
  return { current: delivery?.inventory.releaseId === value.releaseId };
}
