import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { Pool } from 'pg';
import { z } from 'zod';
import { audit, STAFF_LOCK } from './access.ts';
import { runtime } from './runtime.ts';
import { createStaff } from './staff-service.ts';

const inputSchema = z
  .object({
    action: z.enum(['bootstrap', 'recover']),
    email: z
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    name: z.string().trim().min(1).max(100),
    password: z.string().min(15).max(128),
    reason: z.string().trim().min(1).max(300),
  })
  .strict();
let text = '';
for await (const chunk of process.stdin) {
  text += chunk;
  if (text.length > 8192) throw new Error('Input too large');
}
let data: unknown;
try {
  data = JSON.parse(text);
} catch {
  throw new Error('Invalid private operator input');
}
const parsed = inputSchema.safeParse(data);
if (!parsed.success) throw new Error('Invalid private operator input');
const input = parsed.data;
const url = process.env.CONTROL_PLANE_MIGRATION_DATABASE_URL;
if (!url || new URL(url).username !== 'control_plane_migrator')
  throw new Error('Owning maintenance authority required');
const pool = new Pool({ connectionString: url, max: 1 });
const passwordHash = input.action === 'bootstrap' ? await hashPassword(input.password) : null;
const proof =
  input.action === 'recover'
    ? await pool.query(
        `SELECT u.id,a.password FROM control_plane."user" u JOIN control_plane.account a ON a.user_id=u.id
  WHERE u.email=$1 AND u.email_verified AND a.provider_id='credential'`,
        [input.email],
      )
    : null;
if (
  input.action === 'recover' &&
  (!proof?.rows[0]?.password ||
    !(await verifyPassword({ password: input.password, hash: proof.rows[0].password })))
) {
  await pool.end();
  throw new Error('Recovery proof failed');
}
const client = await pool.connect();
let id: string;
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock($1)', [STAFF_LOCK]);
  if (input.action === 'bootstrap') {
    if ((await client.query('SELECT 1 FROM control_plane.staff LIMIT 1')).rowCount)
      throw new Error('Bootstrap already completed');
    id = await createStaff(
      client,
      { ...input, role: 'admin' },
      passwordHash as string,
      'maintenance:bootstrap',
    );
  } else {
    id = proof?.rows[0].id as string;
    // Fence the proof against concurrent password reset/change before granting recovery.
    const current = await client.query(
      'SELECT 1 FROM control_plane.account WHERE user_id=$1 AND password=$2 FOR UPDATE',
      [id, proof?.rows[0].password],
    );
    if (!current.rowCount) throw new Error('Recovery proof changed');
    const target = await client.query(
      "UPDATE control_plane.staff SET role='admin',active=true,revision=revision+1 WHERE user_id=$1 RETURNING user_id",
      [id],
    );
    if (!target.rowCount) throw new Error('Recovery requires an existing admitted staff account');
    await client.query('DELETE FROM control_plane.session WHERE user_id=$1', [id]);
    await client.query('DELETE FROM control_plane.two_factor WHERE user_id=$1', [id]);
    await client.query('UPDATE control_plane."user" SET two_factor_enabled=false WHERE id=$1', [
      id,
    ]);
    await audit(client, `maintenance:${randomUUID()}`, id, 'staff.recovered', input.reason);
  }
  await client.query('COMMIT');
} catch {
  await client.query('ROLLBACK');
  throw new Error('Private staff operation failed; no changes committed');
} finally {
  client.release();
  await pool.end();
}
if (input.action === 'bootstrap') {
  let deliveryRuntime: ReturnType<typeof runtime> | undefined;
  try {
    deliveryRuntime = runtime();
    await deliveryRuntime.auth.api.sendVerificationEmail({
      body: { email: input.email, callbackURL: `${deliveryRuntime.config.origin}/access` },
    });
  } catch {
    console.log(
      'Account created; verification delivery pending. Retry from the verification screen.',
    );
  } finally {
    await deliveryRuntime?.pool.end();
  }
}
console.log(
  JSON.stringify({
    id,
    status: input.action === 'bootstrap' ? 'verification-required' : 'mfa-enrollment-required',
  }),
);
