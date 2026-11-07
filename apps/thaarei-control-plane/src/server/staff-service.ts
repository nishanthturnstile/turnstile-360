import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { StaffRole } from './access.ts';
import {
  AccessError,
  audit,
  identity,
  requireAdmin,
  STAFF_LOCK,
  staffContext,
  transaction,
} from './access.ts';
import { runtime } from './runtime.ts';
export const admission = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    name: z.string().trim().min(1).max(100),
    role: z.enum(['admin', 'operator', 'viewer']),
    reason: z.string().trim().min(1).max(300),
  })
  .strict();
export const change = z
  .object({
    id: z.string().min(1).max(128),
    revision: z.number().int().positive(),
    role: z.enum(['admin', 'operator', 'viewer']),
    active: z.boolean(),
    reason: z.string().trim().min(1).max(300),
  })
  .strict();
export async function createStaff(
  client: PoolClient,
  input: z.infer<typeof admission>,
  passwordHash: string,
  actor: string,
) {
  const id = randomUUID();
  await client.query(`INSERT INTO control_plane."user"(id,email,name) VALUES($1,$2,$3)`, [
    id,
    input.email,
    input.name,
  ]);
  await client.query(
    `INSERT INTO control_plane.account(id,account_id,provider_id,user_id,password,updated_at) VALUES($1,$2,'credential',$2,$3,now())`,
    [randomUUID(), id, passwordHash],
  );
  await client.query('INSERT INTO control_plane.staff(user_id,role) VALUES($1,$2)', [
    id,
    input.role,
  ]);
  await audit(client, actor, id, 'staff.admitted', input.reason, {
    role: input.role,
    active: true,
    revision: 1,
  });
  return id;
}
export async function admitStaff(headers: Headers, raw: unknown) {
  const input = admission.parse(raw);
  const { requireStaff } = await import('./access.ts');
  requireAdmin(await requireStaff(headers));
  // Hash before taking transaction/advisory lock. No email/HTTP inside the transaction.
  const passwordHash = await hashPassword(randomBytes(48).toString('base64url'));
  const session = await identity(headers);
  if (!session) throw new AccessError(401, 'Sign in required');
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [STAFF_LOCK]);
    const actor = await staffContext(session.session.id, client);
    requireAdmin(actor);
    if (
      (await client.query('SELECT 1 FROM control_plane."user" WHERE email=$1', [input.email]))
        .rowCount
    )
      throw new AccessError(409, 'Staff account already exists');
    if (
      (await client.query('SELECT count(*)::int AS count FROM control_plane.staff')).rows[0]
        .count >= 200
    )
      throw new AccessError(409, 'Staff limit reached');
    const id = await createStaff(client, input, passwordHash, actor.id);
    // Delivery is explicit/retryable after commit via ordinary verification/recovery entry.
    return {
      id,
      email: input.email,
      name: input.name,
      role: input.role,
      active: true,
      revision: 1,
    };
  });
}
export async function changeStaff(headers: Headers, raw: unknown) {
  const input = change.parse(raw);
  const session = await identity(headers);
  if (!session) throw new AccessError(401, 'Sign in required');
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [STAFF_LOCK]);
    const actor = await staffContext(session.session.id, client);
    requireAdmin(actor);
    const result = await client.query(
      'SELECT * FROM control_plane.staff WHERE user_id=$1 FOR UPDATE',
      [input.id],
    );
    const target = result.rows[0] as
      | { role: StaffRole; active: boolean; revision: number }
      | undefined;
    if (!target) throw new AccessError(404, 'Staff account not found');
    if (target.revision !== input.revision)
      throw new AccessError(409, 'Staff account changed; reload');
    if (target.role === input.role && target.active === input.active)
      return { ...input, revision: target.revision };
    if (target.role === 'admin' && target.active && (input.role !== 'admin' || !input.active)) {
      const admins = await client.query(
        `SELECT 1 FROM control_plane.staff m JOIN control_plane."user" u ON u.id=m.user_id
        JOIN control_plane.two_factor f ON f.user_id=u.id WHERE m.role='admin' AND m.active AND m.user_id<>$1
        AND u.email_verified AND u.two_factor_enabled AND f.verified`,
        [input.id],
      );
      if (!admins.rowCount)
        throw new AccessError(409, 'Cannot remove the last verified MFA administrator');
    }
    await client.query(
      'UPDATE control_plane.staff SET role=$2,active=$3,revision=revision+1 WHERE user_id=$1',
      [input.id, input.role, input.active],
    );
    await client.query('DELETE FROM control_plane.session WHERE user_id=$1', [input.id]);
    await audit(client, actor.id, input.id, 'staff.changed', input.reason, {
      beforeRole: target.role,
      beforeActive: target.active,
      beforeRevision: target.revision,
      role: input.role,
      active: input.active,
      revision: input.revision + 1,
    });
    return { id: input.id, role: input.role, active: input.active, revision: input.revision + 1 };
  });
}
export async function listStaff(headers: Headers) {
  const { requireStaff } = await import('./access.ts');
  const actor = await requireStaff(headers);
  requireAdmin(actor, false);
  const result =
    await runtime().pool.query(`SELECT u.id,u.name,u.email,u.email_verified AS verified,u.two_factor_enabled AS "mfaEnabled",m.role,m.active,m.revision
    FROM control_plane.staff m JOIN control_plane."user" u ON u.id=m.user_id ORDER BY u.email LIMIT 200`);
  return result.rows;
}
