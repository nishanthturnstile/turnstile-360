import 'server-only';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { runtime } from './runtime.ts';
export type StaffRole = 'admin' | 'operator' | 'viewer';
export class AccessError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export type StaffContext = {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  revision: number;
  recent: boolean;
};
export async function identity(headers: Headers) {
  return runtime().auth.api.getSession({ headers });
}
export async function staffContext(sessionId: string, client?: PoolClient): Promise<StaffContext> {
  const db = client ?? runtime().pool;
  const result = await db.query(
    `UPDATE control_plane.staff_session proof SET last_seen_at=now()
    FROM control_plane.session s, control_plane."user" u, control_plane.staff m
    WHERE proof.session_id=$1 AND s.id=proof.session_id AND s.user_id=u.id AND m.user_id=u.id
    AND m.active AND u.email_verified AND u.two_factor_enabled
    AND s.expires_at>now() AND s.created_at>now()-interval '8 hours'
    AND proof.last_seen_at>now()-interval '30 minutes' AND proof.mfa_at<=now()
    RETURNING u.id,u.email,u.name,m.role,m.revision,proof.mfa_at>now()-interval '10 minutes' AS recent`,
    [sessionId],
  );
  const row = result.rows[0] as StaffContext | undefined;
  if (!row || !['admin', 'operator', 'viewer'].includes(row.role))
    throw new AccessError(403, 'Staff access requires an active account and MFA');
  return row;
}
export async function requireStaff(headers: Headers) {
  const session = await identity(headers);
  if (!session) throw new AccessError(401, 'Sign in required');
  return staffContext(session.session.id);
}
export function requireAdmin(staff: StaffContext, recent = true) {
  if (staff.role !== 'admin') throw new AccessError(403, 'Administrator required');
  if (recent && !staff.recent) throw new AccessError(403, 'Verify MFA again to continue');
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await runtime().pool.connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function audit(
  client: PoolClient,
  actor: string,
  subject: string,
  action: string,
  reason: string,
  details: Record<string, string | number | boolean> = {},
) {
  await client.query(
    'INSERT INTO control_plane.staff_audit(id,actor_id,subject_id,action,reason,details) VALUES ($1,$2,$3,$4,$5,$6)',
    [randomUUID(), actor, subject, action, reason, JSON.stringify(details)],
  );
}
export const STAFF_LOCK = 860021;
