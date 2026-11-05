import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AuthorityService } from './authority/authority.service.js';
import { loginPolicy } from './authority-configuration.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const proof = (secret: string, client: string, query: string) =>
  createHmac('sha256', secret)
    .update(JSON.stringify([client, query]))
    .digest('hex');
const cookieName = 'thaarei-authorization';

/** Bounded namespace-only cleanup; provider verification/reset records stay untouched. */
export async function pruneContinuations(pool: NonNullable<AuthorityService['pool']>) {
  const result = await pool.query(
    `DELETE FROM auth.verification WHERE id IN (
      SELECT id FROM auth.verification WHERE identifier LIKE 'dms-continuation:%'
      AND expires_at <= now() ORDER BY expires_at, id LIMIT 100 FOR UPDATE SKIP LOCKED
    )`,
  );
  return result.rowCount ?? 0;
}

// The signed provider query stays in authority persistence. Only an opaque reference
// goes to the consumer screen. Consumption is atomic and bound to this browser.
export async function captureContinuation(authority: AuthorityService, location: string) {
  const config = authority.config;
  if (!config || !authority.pool) throw new Error('Authority unavailable');
  const target = new URL(location, config.AUTH_PUBLIC_ORIGIN);
  if (
    target.origin !== config.AUTH_PUBLIC_ORIGIN ||
    !['/identity/interaction/login', '/identity/interaction/consent'].includes(target.pathname)
  )
    return;
  const client = target.searchParams.get('client_id');
  const policy = client ? loginPolicy(config, client, true) : undefined;
  if (!policy || !target.searchParams.has('sig')) throw new Error('Invalid continuation');
  const screen = target.pathname.endsWith('/consent') ? policy.consentUrl : policy.loginUrl;
  if (
    config.AUTH_MODE === 'combined' &&
    !config.AUTH_LOGIN_CLIENTS.some((policy) => policy.clientId === client)
  )
    return { location: `${screen}${target.search}`, cookie: undefined };
  await pruneContinuations(authority.pool);
  const transaction = randomBytes(32).toString('base64url');
  const binding = randomBytes(32).toString('base64url');
  await authority.pool.query(
    "INSERT INTO auth.verification (id, identifier, value, expires_at) VALUES ($1,$2,$3,now()+interval '5 minutes')",
    [
      randomUUID(),
      `dms-continuation:${digest(transaction)}:${digest(binding)}`,
      JSON.stringify({
        client,
        query: target.search,
        proof: proof(config.AUTH_SECRET, client ?? '', target.search),
      }),
    ],
  );
  const destination = new URL(screen);
  destination.searchParams.set('transaction', transaction);
  return {
    location: destination.href,
    cookie: `${cookieName}=${binding}; HttpOnly; SameSite=Lax; Path=/identity; Max-Age=300${new URL(config.AUTH_PUBLIC_ORIGIN).protocol === 'https:' ? '; Secure' : ''}`,
  };
}

export async function consumeContinuation(authority: AuthorityService, url: URL, cookie: string) {
  const transaction = url.searchParams.get('transaction') ?? '';
  const binding =
    cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1) ?? '';
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(transaction) ||
    !/^[A-Za-z0-9_-]{43}$/.test(binding) ||
    [...url.searchParams.keys()].length !== 1 ||
    !authority.pool ||
    !authority.config
  )
    throw new Error('Invalid continuation');
  const { rows } = await authority.pool.query<{ value: string }>(
    `DELETE FROM auth.verification WHERE identifier=$1 AND expires_at>now()  RETURNING value`,
    [`dms-continuation:${digest(transaction)}:${digest(binding)}`],
  );
  if (rows.length !== 1 || !rows[0]) throw new Error('Expired or consumed continuation');
  const value = JSON.parse(rows[0].value) as { client: string; query: string; proof: string };
  const expected = proof(authority.config.AUTH_SECRET, value.client, value.query);
  if (
    !/^[0-9a-f]{64}$/.test(value.proof) ||
    !timingSafeEqual(Buffer.from(value.proof, 'hex'), Buffer.from(expected, 'hex'))
  )
    throw new Error('Invalid transaction proof');
  if (!loginPolicy(authority.config, value.client)) throw new Error('Client policy unavailable');
  return `/identity/oauth2/authorize${value.query}`;
}
