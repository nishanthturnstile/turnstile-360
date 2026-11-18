import 'server-only';
import { z } from 'zod';
import { enforcementCommand } from '../contracts/module-transitions.ts';
import {
  AccessError,
  identity,
  requireAdmin,
  STAFF_LOCK,
  staffContext,
  transaction,
} from './access.ts';
import { assertAuthority, digest } from './machine-signing.ts';

/** Restrictive, irreversible protocol floor. This operation never activates a module. */
export async function enforceModuleVersion(headers: Headers, rawId: string, raw: unknown) {
  const id = z.uuid().parse(rawId),
    input = enforcementCommand.parse(raw);
  const session = await identity(headers);
  if (!session) throw new AccessError(401, 'Sign in required');
  return transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock($1)', [STAFF_LOCK]);
    const actor = await staffContext(session.session.id, db);
    requireAdmin(actor);
    await assertAuthority(db);
    const hash = digest(JSON.stringify({ id, ...input }));
    const previous = (
      await db.query(
        'SELECT actor_id,digest,result FROM control_plane.module_receipt WHERE request_id=$1',
        [input.operationId],
      )
    ).rows[0];
    if (previous) {
      if (previous.actor_id !== actor.id || previous.digest !== hash)
        throw new AccessError(409, 'Request identifier conflict');
      return previous.result;
    }
    const p = (
      await db.query(
        'SELECT product,revision FROM control_plane.registry_product WHERE id=$1 FOR UPDATE',
        [id],
      )
    ).rows[0];
    if (!p) throw new AccessError(404, 'Product not found');
    if (p.product !== 'turnstile')
      throw new AccessError(409, 'Only Turnstile supports module decisions');
    if (p.revision !== input.expectedRevision)
      throw new AccessError(409, 'Product revision changed');
    const inserted = await db.query(
      'INSERT INTO control_plane.module_authority(product_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING product_id',
      [id],
    );
    if (!inserted.rowCount)
      throw new AccessError(409, 'Product already requires v2; recover the original receipt');
    await db.query('UPDATE control_plane.registry_product SET revision=revision+1 WHERE id=$1', [
      id,
    ]);
    const result = {
      version: 1,
      productId: id,
      minimumDecisionVersion: 2,
      revision: input.expectedRevision + 1,
      operationId: input.operationId,
    };
    await db.query(
      'INSERT INTO control_plane.module_receipt(request_id,actor_id,digest,result) VALUES($1,$2,$3,$4)',
      [input.operationId, actor.id, hash, JSON.stringify(result)],
    );
    await db.query(
      "INSERT INTO control_plane.module_audit(id,resource_id,actor_id,action,reason,before,after) VALUES($1,$2,$3,'module.enforce-v2',$4,$5,$6)",
      [
        input.operationId,
        id,
        actor.id,
        input.reason,
        JSON.stringify({ minimumDecisionVersion: 1 }),
        JSON.stringify(result),
      ],
    );
    return result;
  });
}
