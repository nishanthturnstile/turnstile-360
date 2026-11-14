import 'server-only';
import { randomUUID } from 'node:crypto';
import { sameActiveBasis, validateDeliveryRequest } from '@thaarei/module-catalog';
import { assignmentEntry } from '../contracts/module-assignments.ts';
import { catalogueReceipt } from '../contracts/module-catalogues.ts';
import { moduleActivationCommand } from '../contracts/module-transitions.ts';
import { AccessError, identity, STAFF_LOCK, staffContext, transaction } from './access.ts';
import { assertAuthority, digest } from './machine-signing.ts';
import { moduleAuthorityDocument } from './module-decision-policy.ts';
import { findDelivery } from './module-delivery-service.ts';

/** Staff approval is separate from product approval, desired assignment and inventory. */
export async function activateModules(headers: Headers, id: string, raw: unknown) {
  const input = moduleActivationCommand.parse(raw);
  const session = await identity(headers);
  if (!session) throw new AccessError(401, 'Sign in required');
  return transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock($1)', [STAFF_LOCK]);
    const actor = await staffContext(session.session.id, db);
    if (!['admin', 'operator'].includes(actor.role) || !actor.recent)
      throw new AccessError(403, 'Current staff MFA required');
    await assertAuthority(db);
    const hash = digest(JSON.stringify({ id, ...input }));
    const prior = (
      await db.query(
        'SELECT actor_id,digest,result FROM control_plane.module_receipt WHERE request_id=$1',
        [input.operationId],
      )
    ).rows[0];
    if (prior) {
      if (prior.actor_id !== actor.id || prior.digest !== hash)
        throw new AccessError(409, 'Request identifier conflict');
      return catalogueReceipt.parse(prior.result);
    }
    const p = (
      await db.query(
        `SELECT p.*,c.archived,i.local_installation_id,i.tenant_id FROM control_plane.registry_product p JOIN control_plane.registry_client c ON c.id=p.client_id JOIN control_plane.registry_installation i ON i.id=p.installation_id WHERE p.id=$1 FOR UPDATE OF p`,
        [id],
      )
    ).rows[0];
    const machine = (
      await db.query('SELECT * FROM control_plane.machine WHERE product_id=$1 FOR UPDATE', [id])
    ).rows[0];
    if (!p) throw new AccessError(404, 'Product not found');
    if (
      p.product !== 'turnstile' ||
      p.archived ||
      p.policy_state !== 'approved' ||
      !p.licence_expires_at ||
      new Date(p.licence_expires_at).getTime() <= Date.now() ||
      !p.pairing_verified_at ||
      p.revision !== input.expectedRevision ||
      input.expectedRevision >= 2147483647 ||
      !machine ||
      machine.revoked_at ||
      machine.epoch !== input.epoch
    )
      throw new AccessError(409, 'Current approved product, revision and pairing required');
    const old = (
      await db.query('SELECT document FROM control_plane.module_authority WHERE product_id=$1', [
        id,
      ])
    ).rows[0];
    if (!old) throw new AccessError(409, 'Reviewed v2 enforcement required');
    const authority = old.document === null ? null : moduleAuthorityDocument.parse(old.document);
    const basis = authority ? { ...authority.policy.active, policyRevision: p.revision } : null;
    if (
      (basis === null) !== (input.activeBasis === null) ||
      (basis && !sameActiveBasis(basis, input.activeBasis))
    )
      throw new AccessError(409, 'Active authority changed; review again');
    const desiredRow = (
      await db.query(
        `SELECT e.* FROM control_plane.module_assignment_state s JOIN control_plane.module_assignment_entry e ON e.id=s.desired_id AND e.product_id=s.product_id WHERE s.product_id=$1`,
        [id],
      )
    ).rows[0];
    if (!desiredRow || desiredRow.revision !== input.desiredRevision)
      throw new AccessError(409, 'Desired assignment changed');
    const desired = assignmentEntry.parse({
      id: desiredRow.id,
      kind: desiredRow.kind,
      revision: desiredRow.revision,
      document: desiredRow.document,
      actorId: desiredRow.actor_id,
      createdAt: new Date(desiredRow.created_at).toISOString(),
    });
    const bound = desired.document.command.binding;
    if (
      bound.productId !== id ||
      bound.clientId !== p.client_id ||
      bound.installationId !== p.installation_id ||
      bound.applicationId !== p.application_id ||
      bound.localInstallationId !== p.local_installation_id ||
      bound.tenantId !== p.tenant_id
    )
      throw new AccessError(409, 'Desired assignment binding changed');
    const delivery = await findDelivery(desired.document);
    if (!delivery) throw new AccessError(409, 'Verified matching package required');
    const observed = (
      await db.query('SELECT * FROM control_plane.module_observation WHERE product_id=$1', [id])
    ).rows[0];
    const expected = {
      catalogueDigest: delivery.inventory.catalogueDigest,
      profileDigest: delivery.inventory.profileDigest,
      releaseId: delivery.inventory.releaseId,
    };
    if (
      !observed ||
      observed.epoch !== machine.epoch ||
      Date.now() - new Date(observed.observed_at).getTime() > 900000 ||
      new Date(observed.observed_at).getTime() > Date.now() ||
      Object.entries(input.installed).some(([k, v]) => observed.installed[k] !== v) ||
      Object.entries(expected).some(([k, v]) => observed.installed[k] !== v)
    )
      throw new AccessError(409, 'Fresh matching installed observation required');
    const source = (
      await db.query(
        "SELECT document FROM control_plane.module_catalogue WHERE digest=$1 AND status='released'",
        [desired.document.profile.catalogueDigest],
      )
    ).rows[0];
    if (!source) throw new AccessError(409, 'Published catalogue required');
    const request = await validateDeliveryRequest({
      version: 1,
      catalogue: source.document,
      profile: desired.document.profile,
      profileDigest: desired.document.profileDigest,
    });
    const revision = p.revision + 1;
    const next = moduleAuthorityDocument.parse({
      version: 1,
      epoch: machine.epoch,
      request,
      policy: {
        active: { ...expected, assignmentRevision: desired.revision, policyRevision: revision },
        desired: {
          catalogueDigest: expected.catalogueDigest,
          profileDigest: expected.profileDigest,
          assignmentRevision: desired.revision,
        },
        changeAssignmentRevision: desired.revision,
        allowedModuleIds: request.profile.modules.map((m) => m.id),
      },
    });
    await db.query('SELECT control_plane.commit_module_authority($1,$2,$3,$4,$5)', [
      session.session.id,
      id,
      p.revision,
      'activate',
      JSON.stringify(next),
    ]);
    await db.query('UPDATE control_plane.registry_product SET revision=revision+1 WHERE id=$1', [
      id,
    ]);
    const committedAt = (
      await db.query('SELECT clock_timestamp() AS time')
    ).rows[0].time.toISOString();
    const result = catalogueReceipt.parse({
      requestId: input.operationId,
      resourceId: id,
      revision,
      committedAt,
    });
    await db.query(
      'INSERT INTO control_plane.module_receipt(request_id,actor_id,digest,result) VALUES($1,$2,$3,$4)',
      [input.operationId, actor.id, hash, JSON.stringify(result)],
    );
    await db.query(
      `INSERT INTO control_plane.registry_audit(id,client_id,resource_id,actor_id,actor_role,action,reason,"before","after") VALUES($1,$2,$3,$4,$5,'module.activate',$6,$7,$8)`,
      [
        randomUUID(),
        p.client_id,
        id,
        actor.id,
        actor.role,
        input.reason,
        JSON.stringify(authority),
        JSON.stringify(next),
      ],
    );
    return result;
  });
}
