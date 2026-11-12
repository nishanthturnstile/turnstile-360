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

export async function provisionUser(
  auth: Authority,
  input: unknown,
  origin: string,
  verificationUrl = `${origin}/sign-in`,
) {
  const body = provisionInput.parse(input);
  // Server API only: no request/headers, no public admin route and no automatic verification bypass.
  const { user } = await auth.api.createUser({ body });
  await auth.api.sendVerificationEmail({
    body: { email: body.email, callbackURL: verificationUrl },
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
    const parsed = z
      .object({ verificationUrl: z.string().optional() })
      .passthrough()
      .parse(JSON.parse(input));
    const { verificationUrl, ...account } = parsed;
    const returnUrl =
      verificationUrl ??
      config.AUTH_SETUP_COMPLETION_URL ??
      (config.AUTH_MODE === 'standalone' ? `${config.AUTH_PUBLIC_ORIGIN}/identity/ok` : undefined);
    if (
      verificationUrl &&
      verificationUrl !== config.AUTH_SETUP_COMPLETION_URL &&
      !config.AUTH_LOGIN_CLIENTS.some((client) => client.verificationUrl === verificationUrl)
    )
      throw new Error('Unapproved verification screen');
    if (process.argv[2] === '--resend-verification') {
      const request = z.object({ email: z.email() }).strict().parse(account);
      await auth.api.sendVerificationEmail({
        body: {
          email: request.email,
          callbackURL: returnUrl ?? `${config.AUTH_PUBLIC_ORIGIN}/sign-in`,
        },
      });
      console.log('Verification email requested; complete the real email flow before login');
      await captureAuthorityEvent(config, {
        ...event,
        action: 'authority.account.verification-resend',
        subjectId: randomUUID(),
        outcome: 'success',
      });
    } else {
      if (process.argv.length !== 2) throw new Error('Unknown account operation');
      const user = await provisionUser(auth, account, config.AUTH_PUBLIC_ORIGIN, returnUrl);
      await captureAuthorityEvent(config, { ...event, subjectId: user.id, outcome: 'success' });
      console.log('Account provisioned; email verification is required before login');
      console.log(JSON.stringify({ userId: user.id, verificationRequired: true }));
    }
  } catch {
    console.error(
      'Account provisioning or verification delivery failed; inspect account state before retrying',
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
