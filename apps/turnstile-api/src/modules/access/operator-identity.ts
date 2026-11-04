import { z } from 'zod';
import { parseProductEnvironment } from '../../infrastructure/auth-environment.js';

const tokenSchema = z
  .string()
  .min(1)
  .max(8192)
  .regex(/^[\x21-\x7e]+$/);
const live = z.object({
  active: z.literal(true),
  sub: z.string(),
  client_id: z.string(),
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  token_type: z.string(),
  exp: z.number().int(),
});
const profile = z.object({ sub: z.string(), email_verified: z.literal(true) });

// Explicit subject + its live, userinfo-bound login token. The authority performs
// its live eligibility checks. No database peeking or locally asserted verified flag.
// HTTP finishes before installation/configuration/access locks are acquired.
export async function verifyOperatorSubject(
  userId: string,
  token: string,
  environment: NodeJS.ProcessEnv,
) {
  tokenSchema.parse(token);
  const config = parseProductEnvironment(environment);
  const issuer = config.AUTH_ISSUER_URL;
  const resource = `${issuer}/oauth2/userinfo`;
  const response = await fetch(`${issuer}/oauth2/introspect`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${encodeURIComponent(config.AUTH_LOGIN_CLIENT_ID)}:${encodeURIComponent(config.AUTH_LOGIN_CLIENT_SECRET)}`).toString('base64')}`,
    },
    body: new URLSearchParams({ token, token_type_hint: 'access_token' }),
  });
  if (!response.ok) throw new Error('Identity proof unavailable');
  const value = live.parse(await response.json());
  const audience = Array.isArray(value.aud) ? value.aud : [value.aud];
  if (
    value.sub !== userId ||
    value.client_id !== config.AUTH_LOGIN_CLIENT_ID ||
    value.iss !== issuer ||
    value.token_type.toLowerCase() !== 'bearer' ||
    audience.length !== 1 ||
    audience[0] !== resource ||
    value.exp * 1000 <= Date.now()
  )
    throw new Error('Identity proof rejected');
  const user = await fetch(resource, {
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
  });
  if (!user.ok || profile.parse(await user.json()).sub !== userId)
    throw new Error('Identity proof rejected');
  return { expiresAt: value.exp * 1000, checkedAt: Date.now() };
}
