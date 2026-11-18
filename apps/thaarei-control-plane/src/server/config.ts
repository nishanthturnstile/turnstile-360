import 'server-only';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { MAX_DECISION_SECONDS } from '@thaarei/control-plane-contracts';
import { z } from 'zod';

const versions = z
  .string()
  .transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Invalid version policy' });
      return z.NEVER;
    }
  })
  .pipe(z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,99}$/)).max(20))
  .default([]);
const schema = z.object({
  CONTROL_PLANE_DECISION_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(MAX_DECISION_SECONDS)
    .default(MAX_DECISION_SECONDS),
  CONTROL_PLANE_DMS_SUPPORTED_VERSIONS: versions,
  CONTROL_PLANE_TURNSTILE_SUPPORTED_VERSIONS: versions,
  CONTROL_PLANE_PROFILE: z.enum(['development', 'test', 'production']).default('production'),
  CONTROL_PLANE_PUBLIC_ORIGIN: z.string().url(),
  CONTROL_PLANE_DATABASE_URL: z
    .string()
    .url()
    .regex(/^postgres(?:ql)?:/),
  CONTROL_PLANE_AUTH_SECRET_FILE: z.string(),
  CONTROL_PLANE_SMTP_URL: z.string().url(),
  CONTROL_PLANE_SMTP_FROM: z.email(),
  CONTROL_PLANE_MODULE_REFERENCE_DIRECTORY: z.string().optional(),
  CONTROL_PLANE_MODULE_RELEASE_TRUST_FILE: z.string().optional(),
  CONTROL_PLANE_SIGNING_KEY_FILE: z.string().optional(),
  CONTROL_PLANE_RECOVERY_MARKER_FILE: z.string().optional(),
  CONTROL_PLANE_TRUST_PROXY: z.enum(['true', 'false']).default('false'),
});
export function protectedSecret(path: string): string {
  if (!isAbsolute(path)) throw new Error('Secret file must be absolute');
  const stat = statSync(path);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 4096) {
    throw new Error('Secret file must be a bounded protected regular file');
  }
  const secret = readFileSync(path, 'utf8').trim();
  if (secret.length < 43) throw new Error('Secret must contain at least 32 random bytes');
  return secret;
}
export function parseConfig(env: Record<string, string | undefined>) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error('Control-plane configuration is invalid');
  const value = parsed.data;
  if (new URL(value.CONTROL_PLANE_DATABASE_URL).username !== 'control_plane_runtime')
    throw new Error('Central runtime role required');
  const origin = new URL(value.CONTROL_PLANE_PUBLIC_ORIGIN);
  if (
    origin.origin !== value.CONTROL_PLANE_PUBLIC_ORIGIN ||
    origin.username ||
    origin.password ||
    (origin.protocol !== 'https:' &&
      !(
        value.CONTROL_PLANE_PROFILE !== 'production' &&
        origin.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(origin.hostname)
      ))
  ) {
    throw new Error('Control-plane origin must be canonical HTTPS');
  }
  const smtp = new URL(value.CONTROL_PLANE_SMTP_URL);
  if (!['smtp:', 'smtps:'].includes(smtp.protocol)) throw new Error('Invalid SMTP transport');
  return {
    decisionSeconds: value.CONTROL_PLANE_DECISION_SECONDS,
    origin: origin.origin,
    supportedVersions: {
      dms: value.CONTROL_PLANE_DMS_SUPPORTED_VERSIONS,
      turnstile: value.CONTROL_PLANE_TURNSTILE_SUPPORTED_VERSIONS,
    },
    moduleReferenceDirectory: value.CONTROL_PLANE_MODULE_REFERENCE_DIRECTORY,
    moduleReleaseTrustFile: value.CONTROL_PLANE_MODULE_RELEASE_TRUST_FILE,
    signingKeyFile: value.CONTROL_PLANE_SIGNING_KEY_FILE,
    recoveryMarkerFile: value.CONTROL_PLANE_RECOVERY_MARKER_FILE,
    databaseUrl: value.CONTROL_PLANE_DATABASE_URL,
    secret: protectedSecret(value.CONTROL_PLANE_AUTH_SECRET_FILE),
    smtpUrl: smtp.href,
    smtpFrom: value.CONTROL_PLANE_SMTP_FROM,
    production: value.CONTROL_PLANE_PROFILE === 'production',
    trustProxy: value.CONTROL_PLANE_TRUST_PROXY === 'true',
  };
}
export type Configuration = ReturnType<typeof parseConfig>;
