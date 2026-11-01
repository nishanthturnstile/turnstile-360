import { z } from 'zod';

const secret = z
  .string()
  .min(32)
  .max(512)
  .refine(
    (value) =>
      new Set(value).size >= 16 && !/example|placeholder|change.?me|development-only/i.test(value),
    'Use an independently generated secret',
  );
const url = z.url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const parsed = new URL(value);
  return (
    ['http:', 'https:'].includes(parsed.protocol) &&
    !parsed.username &&
    !parsed.password &&
    !parsed.search &&
    !parsed.hash &&
    !value.includes('*') &&
    value === `${parsed.origin}${parsed.pathname === '/' ? '' : parsed.pathname}`
  );
}, 'Use an exact canonical HTTP(S) URL');
const clientId = z.string().regex(/^[A-Za-z0-9_-]{3,128}$/);

const productEnvironment = z
  .object({
    INSTALLATION_TENANT_ID: z.uuid().toLowerCase(),
    INSTALLATION_CUSTOMER_KEY: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    TURNSTILE_APPLICATION_ID: z.uuid().toLowerCase(),
    TURNSTILE_DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
    AUTH_PROFILE: z.enum(['local', 'test', 'production']).default('local'),
    NODE_ENV: z.string().optional(),
    AUTH_PUBLIC_ORIGIN: url,
    AUTH_ISSUER_URL: url,
    AUTH_LOGIN_CALLBACK_URL: url,
    AUTH_LOGIN_CLIENT_ID: clientId,
    AUTH_LOGIN_CLIENT_SECRET: secret,
    DMS_MACHINE_CLIENT_ID: clientId,
    TURNSTILE_DATABASE_URL: z.url().refine((value) => {
      if (!URL.canParse(value)) return false;
      const parsed = new URL(value);
      return (
        ['postgres:', 'postgresql:'].includes(parsed.protocol) &&
        !!parsed.username &&
        !!parsed.password &&
        parsed.pathname.length > 1 &&
        !parsed.hash
      );
    }, 'Use a PostgreSQL connection URL with a database and credentials'),
    TURNSTILE_COOKIE_SECRET: secret,
    TURNSTILE_TOKEN_ENCRYPTION_KEY: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .refine((value) => new Set(value.toLowerCase()).size >= 12),
  })
  .superRefine((config, ctx) => {
    const issue = (field: keyof typeof config) =>
      ctx.addIssue({ code: 'custom', path: [field], message: 'Invalid authentication boundary' });
    if (
      ![config.AUTH_PUBLIC_ORIGIN, config.AUTH_ISSUER_URL, config.AUTH_LOGIN_CALLBACK_URL].every(
        (value) => URL.canParse(value),
      )
    )
      return;
    if (config.NODE_ENV === 'production' && config.AUTH_PROFILE !== 'production')
      issue('AUTH_PROFILE');
    if (new URL(config.AUTH_PUBLIC_ORIGIN).pathname !== '/') issue('AUTH_PUBLIC_ORIGIN');
    if (config.AUTH_ISSUER_URL !== `${config.AUTH_PUBLIC_ORIGIN}/identity`)
      issue('AUTH_ISSUER_URL');
    if (config.AUTH_LOGIN_CALLBACK_URL !== `${config.AUTH_PUBLIC_ORIGIN}/api/auth/callback`)
      issue('AUTH_LOGIN_CALLBACK_URL');
    const publicUrl = new URL(config.AUTH_PUBLIC_ORIGIN);
    if (
      config.AUTH_PROFILE === 'production'
        ? publicUrl.protocol !== 'https:'
        : !['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname)
    )
      issue('AUTH_PUBLIC_ORIGIN');
    if (config.AUTH_LOGIN_CLIENT_ID === config.DMS_MACHINE_CLIENT_ID)
      issue('DMS_MACHINE_CLIENT_ID');
    if (
      config.AUTH_LOGIN_CLIENT_SECRET === config.TURNSTILE_COOKIE_SECRET ||
      config.TURNSTILE_COOKIE_SECRET === config.TURNSTILE_TOKEN_ENCRYPTION_KEY ||
      config.AUTH_LOGIN_CLIENT_SECRET === config.TURNSTILE_TOKEN_ENCRYPTION_KEY
    )
      issue('TURNSTILE_COOKIE_SECRET');
  });

const machineEnvironment = z
  .object({
    AUTH_ISSUER_URL: url,
    INSTALLATION_TENANT_ID: z.uuid().toLowerCase(),
    TURNSTILE_APPLICATION_ID: z.uuid().toLowerCase(),
    AUTH_PROFILE: z.enum(['local', 'test', 'production']).default('local'),
    NODE_ENV: z.string().optional(),
    DMS_MACHINE_CLIENT_ID: clientId,
    DMS_MACHINE_CLIENT_SECRET: secret,
    AUTH_LOGIN_CLIENT_ID: clientId,
    AUTH_LOGIN_CLIENT_SECRET: secret,
    TURNSTILE_COOKIE_SECRET: secret,
    TURNSTILE_TOKEN_ENCRYPTION_KEY: z.string(),
    DMS_RESOURCE_URL: url,
    DMS_API_URL: url,
  })
  .superRefine((config, ctx) => {
    const issue = (field: keyof typeof config) =>
      ctx.addIssue({ code: 'custom', path: [field], message: 'Invalid machine boundary' });
    if (
      ![config.AUTH_ISSUER_URL, config.DMS_RESOURCE_URL, config.DMS_API_URL].every((value) =>
        URL.canParse(value),
      )
    )
      return;
    if (config.NODE_ENV === 'production' && config.AUTH_PROFILE !== 'production')
      issue('AUTH_PROFILE');
    const issuer = new URL(config.AUTH_ISSUER_URL);
    if (
      issuer.pathname !== '/identity' ||
      (config.AUTH_PROFILE === 'production'
        ? issuer.protocol !== 'https:'
        : !['localhost', '127.0.0.1', '[::1]'].includes(issuer.hostname))
    )
      issue('AUTH_ISSUER_URL');
    for (const field of ['DMS_RESOURCE_URL', 'DMS_API_URL'] as const) {
      const parsed = new URL(config[field]);
      if (parsed.pathname !== '/v1') issue(field);
      if (
        config.AUTH_PROFILE !== 'production' &&
        !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
      )
        issue(field);
    }
    if (
      config.AUTH_PROFILE === 'production' &&
      new URL(config.DMS_RESOURCE_URL).protocol !== 'https:'
    )
      issue('DMS_RESOURCE_URL');
    if (config.AUTH_LOGIN_CLIENT_ID === config.DMS_MACHINE_CLIENT_ID)
      issue('DMS_MACHINE_CLIENT_ID');
    if (
      [
        config.AUTH_LOGIN_CLIENT_SECRET,
        config.TURNSTILE_COOKIE_SECRET,
        config.TURNSTILE_TOKEN_ENCRYPTION_KEY,
      ].includes(config.DMS_MACHINE_CLIENT_SECRET)
    )
      issue('DMS_MACHINE_CLIENT_SECRET');
  });

function parseEnvironment<T>(
  schema: z.ZodType<T>,
  environment: NodeJS.ProcessEnv,
  owner: string,
): T {
  const result = schema.safeParse(environment);
  if (!result.success)
    throw new Error(
      `Invalid ${owner} configuration: ${[...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', ')}`,
    );
  return result.data;
}

export function parseProductEnvironment(environment: NodeJS.ProcessEnv) {
  return parseEnvironment(productEnvironment, environment, 'Turnstile auth');
}

export function parseMachineEnvironment(environment: NodeJS.ProcessEnv) {
  return parseEnvironment(machineEnvironment, environment, 'Turnstile DMS');
}

export function productCookiePolicy(config: ReturnType<typeof parseProductEnvironment>) {
  const secure = new URL(config.AUTH_PUBLIC_ORIGIN).protocol === 'https:';
  return {
    cookieName: secure ? '__Host-turnstile' : 'turnstile',
    secure,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  } as const;
}
