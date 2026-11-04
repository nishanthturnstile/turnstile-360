import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseProductEnvironment } from '../../infrastructure/auth-environment.js';

export function parseInvitationEnvironment(environment: NodeJS.ProcessEnv) {
  const product = parseProductEnvironment(environment);
  const result = z
    .object({
      TURNSTILE_INVITATION_ENCRYPTION_KEY: z
        .string()
        .regex(/^[a-f0-9]{64}$/i)
        .refine((v) => new Set(v.toLowerCase()).size >= 12),
      TURNSTILE_INVITATION_RECOVERY_EPOCH: z
        .string()
        .regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/)
        .refine((v) => new Set(v).size >= 16),
      TURNSTILE_SMTP_HOST: z.enum(['localhost', '127.0.0.1', '::1', 'mailpit']),
      TURNSTILE_SMTP_PORT: z.coerce.number().int().min(1).max(65535),
      TURNSTILE_MAIL_FROM: z.email(),
    })
    .safeParse(environment);
  if (!result.success) throw new Error('Invitation configuration unavailable');
  const config = { ...product, ...result.data };
  const keys = [
    config.TURNSTILE_INVITATION_ENCRYPTION_KEY,
    config.TURNSTILE_INVITATION_RECOVERY_EPOCH,
    config.TURNSTILE_TOKEN_ENCRYPTION_KEY,
    config.TURNSTILE_COOKIE_SECRET,
    config.AUTH_LOGIN_CLIENT_SECRET,
    environment.DMS_MACHINE_CLIENT_SECRET,
    environment.IDENTITY_SERVICE_CLIENT_SECRET,
  ].filter((v) => v !== undefined);
  if (new Set(keys.map((v) => v.toLowerCase())).size !== keys.length)
    throw new Error('Dedicated invitation secrets required');
  return {
    ...config,
    recoveryEpoch: createHash('sha256')
      .update(config.TURNSTILE_INVITATION_RECOVERY_EPOCH)
      .digest('hex'),
  };
}
