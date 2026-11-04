import { z } from 'zod';
import { parseProductEnvironment } from '../../infrastructure/auth-environment.js';

export function parseIdentityEnvironment(environment: NodeJS.ProcessEnv) {
  const product = parseProductEnvironment(environment);
  const result = z
    .object({
      IDENTITY_SERVICE_CLIENT_ID: z.string().regex(/^[A-Za-z0-9_-]{3,128}$/),
      IDENTITY_SERVICE_CLIENT_SECRET: z
        .string()
        .min(32)
        .max(512)
        .refine(
          (v) =>
            new Set(v).size >= 16 && !/example|placeholder|change.?me|development-only/i.test(v),
        ),
      IDENTITY_SERVICE_RESOURCE_URL: z.url(),
      IDENTITY_SERVICE_API_URL: z.url(),
    })
    .safeParse(environment);
  if (!result.success) throw new Error('Invalid identity service configuration');
  const config = { ...product, ...result.data };
  const api = new URL(config.IDENTITY_SERVICE_API_URL);
  if (
    [config.AUTH_LOGIN_CLIENT_ID, config.DMS_MACHINE_CLIENT_ID].includes(
      config.IDENTITY_SERVICE_CLIENT_ID,
    ) ||
    [
      config.AUTH_LOGIN_CLIENT_SECRET,
      environment.DMS_MACHINE_CLIENT_SECRET,
      config.TURNSTILE_COOKIE_SECRET,
      config.TURNSTILE_TOKEN_ENCRYPTION_KEY,
    ].includes(config.IDENTITY_SERVICE_CLIENT_SECRET) ||
    config.IDENTITY_SERVICE_RESOURCE_URL !==
      `${config.AUTH_PUBLIC_ORIGIN}/identity/services/accounts` ||
    !['http:', 'https:'].includes(api.protocol) ||
    api.username ||
    api.password ||
    api.search ||
    api.hash ||
    config.IDENTITY_SERVICE_API_URL !== api.origin ||
    (config.AUTH_PROFILE !== 'production' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(api.hostname))
  )
    throw new Error('Invalid identity service boundary');
  return config;
}
