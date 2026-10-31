import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { assertRuntimeRole, createPool } from '../../infrastructure/database/postgres.js';
import { captureAuthorityEvent } from '../audit/security-event.js';
import { parseAuthorityEnvironment } from './authority-configuration.js';
import { type Authority, createAuthority } from './authority-instance.js';
import { createRecoveryDelivery } from './recovery-delivery.js';

const provisionInput = z
  .object({
    email: z.email(),
    name: z.string().trim().min(1).max(200),
    role: z.enum(['admin', 'user']),
    password: z.string().min(15).max(128).optional(),
  })
  .strict();

export async function provisionUser(auth: Authority, input: unknown, origin: string) {
  const body = provisionInput.parse(input);
  // Server API only: no request/headers, no public admin route and no automatic verification bypass.
  const { user } = await auth.api.createUser({ body });
  await auth.api.sendVerificationEmail({
    body: { email: body.email, callbackURL: `${origin}/sign-in` },
  });
  return { id: user.id };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const config = parseAuthorityEnvironment(process.env);
  const pool = createPool(config.AUTH_DATABASE_URL, 1);
  try {
    if (process.stdin.isTTY) throw new Error('Supply a private JSON input stream');
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 4096) throw new Error('Input too large');
    }
    await assertRuntimeRole(pool, 'auth');
    const auth = createAuthority(config, pool, createRecoveryDelivery(config));
    const event = {
      action: 'authority.account.provision',
      actorKind: 'operator' as const,
      actorId: 'private-account-provisioner',
    };
    await captureAuthorityEvent(config, { ...event, subjectId: randomUUID(), outcome: 'pending' });
    const user = await provisionUser(auth, JSON.parse(input), config.AUTH_PUBLIC_ORIGIN);
    await captureAuthorityEvent(config, { ...event, subjectId: user.id, outcome: 'success' });
    console.log('Account provisioned; email verification is required before login');
  } catch {
    console.error(
      'Account provisioning or verification delivery failed; inspect account state before retrying',
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
