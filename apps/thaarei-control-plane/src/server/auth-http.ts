import 'server-only';
import { z } from 'zod';
import { AccessError, identity } from './access.ts';
import { authHeaders, body, checkOrigin, endpoint, json } from './http.ts';
import { runtime } from './runtime.ts';

const routes: Record<string, z.ZodType> = {
  'sign-in/email': z
    .object({ email: z.email().max(254), password: z.string().min(1).max(128) })
    .strict(),
  'sign-out': z.object({}).strict(),
  'request-password-reset': z.object({ email: z.email().max(254) }).strict(),
  'send-verification-email': z.object({ email: z.email().max(254) }).strict(),
  'reset-password': z
    .object({ token: z.string().min(1).max(1024), newPassword: z.string().min(15).max(128) })
    .strict(),
  'two-factor/enable': z.object({ password: z.string().max(128) }).strict(),
  'two-factor/verify-totp': z.object({ code: z.string().regex(/^\d{6}$/) }).strict(),
  'two-factor/verify-backup-code': z.object({ code: z.string().min(1).max(128) }).strict(),
  'two-factor/generate-backup-codes': z.object({ password: z.string().max(128) }).strict(),
};
function responseCookies(input: Headers, output: Headers) {
  const values = new Map(
    (input.get('cookie') ?? '')
      .split(';')
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return [part.slice(0, index).trim(), part.slice(index + 1)];
      }),
  );
  for (const cookie of output.getSetCookie()) {
    const part = cookie.split(';')[0];
    if (!part) continue;
    const index = part.indexOf('=');
    values.set(part.slice(0, index), part.slice(index + 1));
  }
  const headers = new Headers(input);
  headers.set('cookie', [...values].map(([key, value]) => `${key}=${value}`).join('; '));
  return headers;
}
export function handleAuth(request: Request, path: string) {
  return endpoint(async () => {
    const { auth, pool, config } = runtime();
    const headers = authHeaders(request.headers);
    const read =
      request.method === 'GET' &&
      (path === 'verify-email' || /^reset-password\/[A-Za-z0-9_-]{1,1024}$/.test(path));
    if (!read && (request.method !== 'POST' || !routes[path]))
      return json({ error: 'Not found' }, 404);
    let input: Record<string, unknown> | undefined;
    if (!read) {
      checkOrigin(headers);
      input = routes[path]?.parse(await body(request)) as Record<string, unknown>;
      const active = await identity(headers);
      if (active && path !== 'sign-out') {
        const check = await pool.query(
          `SELECT s.id FROM control_plane.session s LEFT JOIN control_plane.staff_session p ON p.session_id=s.id
          WHERE s.id=$1 AND s.created_at>now()-interval '8 hours'
          AND COALESCE(p.last_seen_at,s.created_at)>now()-interval '30 minutes'`,
          [active.session.id],
        );
        if (!check.rowCount) {
          await pool.query('DELETE FROM control_plane.session WHERE id=$1', [active.session.id]);
          throw new AccessError(401, 'Sign in again');
        }
      }
      if (path === 'two-factor/generate-backup-codes') {
        const { requireStaff } = await import('./access.ts');
        const staff = await requireStaff(headers);
        if (!staff.recent) throw new AccessError(403, 'Verify MFA again to continue');
      }
      if (path === 'request-password-reset')
        input.redirectTo = `${config.origin}/access?flow=reset`;
      if (path === 'send-verification-email') input.callbackURL = `${config.origin}/access`;
    }
    const url = new URL(`/api/auth/${path}`, config.origin);
    if (read) url.search = new URL(request.url).search;
    const response = await auth.handler(
      new Request(url, {
        method: request.method,
        headers,
        ...(input ? { body: JSON.stringify(input) } : {}),
      }),
    );
    const output = new Headers();
    for (const cookie of response.headers.getSetCookie()) output.append('set-cookie', cookie);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || new URL(location, config.origin).origin !== config.origin)
        throw new AccessError(403, 'Redirect denied');
      output.set('location', location);
      output.set('cache-control', 'no-store');
      return new Response(null, { status: response.status, headers: output });
    }
    const retryAfter = response.headers.get('x-retry-after') ?? response.headers.get('retry-after');
    if (retryAfter && /^\d{1,4}$/.test(retryAfter)) output.set('retry-after', retryAfter);
    if (!response.ok)
      return json({ error: 'Unable to complete authentication' }, response.status, output);
    const data = (await response.json()) as Record<string, unknown>;
    if (['two-factor/verify-totp', 'two-factor/verify-backup-code'].includes(path)) {
      const session = await identity(responseCookies(headers, response.headers));
      if (!session) throw new AccessError(401, 'Sign in again');
      const result = await pool.query(
        `INSERT INTO control_plane.staff_session(session_id,mfa_at,last_seen_at)
        SELECT s.id,now(),now() FROM control_plane.session s JOIN control_plane.staff m ON m.user_id=s.user_id
        JOIN control_plane."user" u ON u.id=m.user_id JOIN control_plane.two_factor f ON f.user_id=u.id
        WHERE s.id=$1 AND m.active AND u.email_verified AND u.two_factor_enabled AND f.verified
        ON CONFLICT(session_id) DO UPDATE SET mfa_at=now(),last_seen_at=now() RETURNING session_id`,
        [session.session.id],
      );
      if (!result.rowCount) throw new AccessError(403, 'Staff access unavailable');
    }
    if (path === 'two-factor/enable')
      return json({ totpURI: data.totpURI, backupCodes: data.backupCodes }, 200, output);
    if (path === 'two-factor/generate-backup-codes')
      return json({ backupCodes: data.backupCodes }, 200, output);
    return json(
      { ok: true, ...(data.twoFactorRedirect === true ? { twoFactorRedirect: true } : {}) },
      200,
      output,
    );
  });
}
