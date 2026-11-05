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
const canonicalAuthorityUrl = z.url().refine((value) => {
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
}, 'Use an exact canonical HTTP(S) URL without credentials, query or fragment');
const databaseUrl = z.url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const parsed = new URL(value);
  return (
    ['postgres:', 'postgresql:'].includes(parsed.protocol) &&
    !!parsed.username &&
    !!parsed.password &&
    parsed.pathname.length > 1 &&
    !parsed.hash
  );
}, 'Use a PostgreSQL connection URL with a database and credentials');
const clientId = z.string().regex(/^[A-Za-z0-9_-]{3,128}$/);

const loginClient = z
  .object({
    clientId,
    loginUrl: canonicalAuthorityUrl,
    consentUrl: canonicalAuthorityUrl,
    callbackUrl: canonicalAuthorityUrl,
    logoutUrl: canonicalAuthorityUrl,
    verificationUrl: canonicalAuthorityUrl,
    resetUrl: canonicalAuthorityUrl,
  })
  .strict();

const authorityEnvironment = z
  .object({
    INSTALLATION_TENANT_ID: z.uuid().toLowerCase(),
    INSTALLATION_CUSTOMER_KEY: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    AUTH_SMTP_HOST: z.string().regex(/^[a-zA-Z0-9.:-]+$/),
    AUTH_SMTP_PORT: z.coerce.number().int().min(1).max(65535),
    AUTH_SMTP_MODE: z.enum(['tls', 'starttls', 'plain']),
    AUTH_SMTP_USER: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
    AUTH_SMTP_PASSWORD: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
    AUTH_MAIL_FROM: z.email(),
    AUTH_DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
    AUTH_PROFILE: z.enum(['local', 'test', 'production']).default('local'),
    NODE_ENV: z.string().optional(),
    AUTH_MODE: z.enum(['combined', 'standalone']).default('combined'),
    AUTH_LOGIN_CLIENTS: z.preprocess((value) => {
      if (value === undefined || value === '') return [];
      try {
        return typeof value === 'string' ? JSON.parse(value) : value;
      } catch {
        return null;
      }
    }, z.array(loginClient).max(32).default([])),
    AUTH_PUBLIC_ORIGIN: canonicalAuthorityUrl,
    AUTH_ISSUER_URL: canonicalAuthorityUrl,
    AUTH_LOGIN_CALLBACK_URL: canonicalAuthorityUrl.optional().default('http://localhost/unused'),
    DMS_RESOURCE_URL: canonicalAuthorityUrl,
    AUTH_DATABASE_URL: databaseUrl,
    DMS_DATABASE_URL: databaseUrl,
    AUTH_SECRET: secret,
    AUTH_LOGIN_CLIENT_ID: clientId.optional().default('unused-login'),
    DMS_MACHINE_CLIENT_ID: clientId.optional().default('unused-machine'),
    IDENTITY_SERVICE_CLIENT_ID: z.preprocess(
      (v) => (v === '' ? undefined : v),
      clientId.optional(),
    ),
    IDENTITY_SERVICE_RESOURCE_URL: z.preprocess(
      (v) => (v === '' ? undefined : v),
      canonicalAuthorityUrl.optional(),
    ),
    AUTH_SIGNING_ALGORITHM: z.literal('RS256').default('RS256'),
  })
  .superRefine((config, ctx) => {
    const issue = (field: keyof typeof config) =>
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: 'Invalid authentication boundary',
      });
    if (
      ![
        config.AUTH_PUBLIC_ORIGIN,
        config.AUTH_ISSUER_URL,
        config.AUTH_LOGIN_CALLBACK_URL,
        config.DMS_RESOURCE_URL,
        config.AUTH_DATABASE_URL,
        config.DMS_DATABASE_URL,
      ].every((value) => URL.canParse(value))
    )
      return;
    if (config.AUTH_PROFILE === 'production' && config.AUTH_SMTP_MODE === 'plain')
      issue('AUTH_SMTP_MODE');
    if (!!config.AUTH_SMTP_USER !== !!config.AUTH_SMTP_PASSWORD) issue('AUTH_SMTP_PASSWORD');
    if (
      config.AUTH_PROFILE !== 'production' &&
      config.AUTH_SMTP_MODE === 'plain' &&
      !['localhost', '127.0.0.1', '::1'].includes(config.AUTH_SMTP_HOST)
    )
      issue('AUTH_SMTP_HOST');
    if (config.NODE_ENV === 'production' && config.AUTH_PROFILE !== 'production')
      issue('AUTH_PROFILE');
    if (config.AUTH_ISSUER_URL !== `${config.AUTH_PUBLIC_ORIGIN}/identity`)
      issue('AUTH_ISSUER_URL');
    if (
      config.AUTH_MODE === 'combined' &&
      config.AUTH_LOGIN_CALLBACK_URL !== `${config.AUTH_PUBLIC_ORIGIN}/api/auth/callback`
    )
      issue('AUTH_LOGIN_CALLBACK_URL');
    if (new URL(config.AUTH_PUBLIC_ORIGIN).pathname !== '/') issue('AUTH_PUBLIC_ORIGIN');
    if (new URL(config.DMS_RESOURCE_URL).pathname !== '/v1') issue('DMS_RESOURCE_URL');
    for (const field of ['AUTH_PUBLIC_ORIGIN', 'AUTH_ISSUER_URL', 'DMS_RESOURCE_URL'] as const) {
      const parsed = new URL(config[field]);
      if (
        config.AUTH_PROFILE === 'production'
          ? parsed.protocol !== 'https:'
          : !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
      )
        issue(field);
    }
    if (config.AUTH_LOGIN_CLIENT_ID === config.DMS_MACHINE_CLIENT_ID)
      issue('DMS_MACHINE_CLIENT_ID');
    if (!!config.IDENTITY_SERVICE_CLIENT_ID !== !!config.IDENTITY_SERVICE_RESOURCE_URL)
      issue('IDENTITY_SERVICE_RESOURCE_URL');
    if (
      config.IDENTITY_SERVICE_RESOURCE_URL &&
      config.IDENTITY_SERVICE_RESOURCE_URL !==
        `${config.AUTH_PUBLIC_ORIGIN}/identity/services/accounts`
    )
      issue('IDENTITY_SERVICE_RESOURCE_URL');
    if (
      config.IDENTITY_SERVICE_CLIENT_ID &&
      [config.AUTH_LOGIN_CLIENT_ID, config.DMS_MACHINE_CLIENT_ID].includes(
        config.IDENTITY_SERVICE_CLIENT_ID,
      )
    )
      issue('IDENTITY_SERVICE_CLIENT_ID');
    if (
      config.AUTH_MODE === 'combined' &&
      [config.AUTH_LOGIN_CLIENT_ID, config.DMS_MACHINE_CLIENT_ID].some((id) =>
        id.startsWith('unused-'),
      )
    )
      issue('AUTH_LOGIN_CLIENT_ID');
    const ids = config.AUTH_LOGIN_CLIENTS.map((client) => client.clientId);
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id) =>
        [
          config.AUTH_LOGIN_CLIENT_ID,
          config.DMS_MACHINE_CLIENT_ID,
          config.IDENTITY_SERVICE_CLIENT_ID,
        ].includes(id),
      )
    )
      issue('AUTH_LOGIN_CLIENTS');
    for (const client of config.AUTH_LOGIN_CLIENTS) {
      for (const [key, value] of Object.entries(client)) {
        if (key === 'clientId') continue;
        const parsed = new URL(value);
        if (
          config.AUTH_PROFILE === 'production'
            ? parsed.protocol !== 'https:'
            : !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
        )
          issue('AUTH_LOGIN_CLIENTS');
        // Consumer screens share the authority origin; deployments route their static
        // screens there. Credentials/cookies never cross an origin or backend proxy.
        if (
          ['loginUrl', 'consentUrl', 'verificationUrl', 'resetUrl'].includes(key) &&
          parsed.origin !== config.AUTH_PUBLIC_ORIGIN
        )
          issue('AUTH_LOGIN_CLIENTS');
      }
    }
    const authDb = new URL(config.AUTH_DATABASE_URL);
    const dmsDb = new URL(config.DMS_DATABASE_URL);
    if (authDb.username === dmsDb.username) issue('DMS_DATABASE_URL');
  });

export type AuthorityConfiguration = z.infer<typeof authorityEnvironment>;

export function parseAuthorityEnvironment(environment: NodeJS.ProcessEnv): AuthorityConfiguration {
  const result = authorityEnvironment.safeParse(environment);
  if (!result.success) {
    // Zod URL errors can contain input. Report field names only, never connection strings or secrets.
    throw new Error(
      `Invalid DMS auth configuration: ${[...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', ')}`,
    );
  }
  return result.data;
}

export function loginPolicy(config: AuthorityConfiguration, id: string, combinedAlias = false) {
  const registered = config.AUTH_LOGIN_CLIENTS.find((client) => client.clientId === id);
  if (registered) return registered;
  if (config.AUTH_MODE === 'combined' && (id === config.AUTH_LOGIN_CLIENT_ID || combinedAlias))
    return {
      clientId: id,
      loginUrl: `${config.AUTH_PUBLIC_ORIGIN}/sign-in`,
      consentUrl: `${config.AUTH_PUBLIC_ORIGIN}/sign-in`,
      callbackUrl: config.AUTH_LOGIN_CALLBACK_URL,
      logoutUrl: `${config.AUTH_PUBLIC_ORIGIN}/sign-in`,
      verificationUrl: `${config.AUTH_PUBLIC_ORIGIN}/sign-in`,
      resetUrl: `${config.AUTH_PUBLIC_ORIGIN}/reset-password`,
    };
  return undefined;
}
