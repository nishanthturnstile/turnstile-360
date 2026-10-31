import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance } from 'fastify';
import type { AuthorityService } from './authority/authority.service.js';

const getPaths = new Set([
  '/identity/ok',
  '/identity/get-session',
  '/identity/list-sessions',
  '/identity/verify-email',
  '/identity/jwks',
  '/identity/.well-known/openid-configuration',
  '/identity/.well-known/oauth-authorization-server',
  '/.well-known/oauth-authorization-server/identity',
  '/identity/oauth2/authorize',
  '/identity/oauth2/userinfo',
]);
const postPaths = new Set([
  '/identity/sign-in/email',
  '/identity/sign-out',
  '/identity/get-session',
  '/identity/revoke-sessions',
  '/identity/revoke-other-sessions',
  '/identity/request-password-reset',
  '/identity/reset-password',
  '/identity/send-verification-email',
  '/identity/oauth2/token',
  '/identity/oauth2/introspect',
  '/identity/oauth2/revoke',
  '/identity/oauth2/userinfo',
  '/identity/oauth2/end-session',
]);

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function fields(value: unknown, names: readonly string[]) {
  const record = object(value);
  return Object.fromEntries(
    names.filter((name) => record[name] !== undefined).map((name) => [name, record[name]]),
  );
}
function safeUser(value: unknown) {
  return fields(value, ['id', 'name', 'email', 'emailVerified', 'image', 'createdAt', 'updatedAt']);
}
function safeSession(value: unknown) {
  return fields(value, ['id', 'userId', 'createdAt', 'updatedAt', 'expiresAt']);
}

export function projectPublicAuthResponse(path: string, value: unknown): unknown {
  if (value === null) return null;
  if (path === '/identity/sign-in/email') {
    const result = fields(value, ['redirect', 'url']);
    if (object(value).user) result.user = safeUser(object(value).user);
    return result;
  }
  if (path === '/identity/get-session')
    return { user: safeUser(object(value).user), session: safeSession(object(value).session) };
  if (path === '/identity/list-sessions') return Array.isArray(value) ? value.map(safeSession) : [];
  if (path === '/identity/verify-email')
    return {
      status: object(value).status,
      ...(object(value).user ? { user: safeUser(object(value).user) } : {}),
    };
  // Authenticated OAuth token/introspection responses retain their protocol credentials.
  return value;
}

export async function mountAuthorityHandler(server: FastifyInstance, authority: AuthorityService) {
  await server.register(async (scope) => {
    scope.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_request, body, done) => done(null, body),
    );
    scope.setErrorHandler((error, _request, reply) => {
      const code = object(error).statusCode;
      return reply
        .code(typeof code === 'number' && code >= 400 && code < 500 ? code : 503)
        .header('cache-control', 'no-store')
        .send({ code: 'INVALID_AUTH_REQUEST' });
    });
    scope.route({
      method: ['GET', 'POST'],
      url: '/identity/*',
      bodyLimit: 16384,
      handler: handle,
    });
    scope.route({
      method: 'GET',
      url: '/.well-known/oauth-authorization-server/identity',
      handler: handle,
    });

    async function handle(
      request: import('fastify').FastifyRequest,
      reply: import('fastify').FastifyReply,
    ) {
      reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
      const origin = authority.config?.AUTH_PUBLIC_ORIGIN ?? 'http://localhost';
      const incoming = new URL(request.url, origin);
      const url = new URL(origin);
      url.pathname = incoming.pathname;
      url.search = incoming.search;
      const path = url.pathname;
      const resetLink = /^\/identity\/reset-password\/[A-Za-z0-9_-]+$/.test(path);
      if (request.method === 'GET' ? !getPaths.has(path) && !resetLink : !postPaths.has(path)) {
        return reply.code(404).send({ code: 'NOT_FOUND' });
      }
      if (path.startsWith('/identity/oauth2/')) {
        if (request.method === 'POST' && url.search)
          return reply.code(400).send({ error: 'invalid_request' });
        const keys = [...url.searchParams.keys()];
        if (keys.length !== new Set(keys).size)
          return reply.code(400).send({ error: 'invalid_request' });
      }
      if (!authority.auth || !authority.config || !(await authority.ready()))
        return reply.code(503).send({ code: 'AUTH_UNAVAILABLE' });
      try {
        const headers = fromNodeHeaders(request.headers);
        for (const key of [...headers.keys()])
          if (
            ['host', 'connection', 'content-length', 'x-real-ip'].includes(key) ||
            key.startsWith('x-forwarded-')
          )
            headers.delete(key);
        headers.set('x-forwarded-for', request.ip);
        let body = request.body;
        const form =
          headers.get('content-type')?.split(';')[0] === 'application/x-www-form-urlencoded';
        if (form) {
          const keys = [...new URLSearchParams(String(body)).keys()];
          if (keys.length !== new Set(keys).size)
            return reply.code(400).send({ error: 'invalid_request' });
        }
        const payload = form
          ? Object.fromEntries(new URLSearchParams(String(body)))
          : { ...object(body) };
        // Recovery redirects are fixed destinations, never arbitrary same-origin paths.
        const destination =
          path === '/identity/request-password-reset'
            ? ['redirectTo', `${origin}/reset-password`]
            : path === '/identity/send-verification-email'
              ? ['callbackURL', `${origin}/sign-in`]
              : undefined;
        if (destination) {
          const [key, expected] = destination as [string, string];
          if (payload[key] !== undefined && payload[key] !== expected)
            return reply.code(400).send({ code: 'INVALID_CALLBACK' });
          payload[key] = expected;
        }
        if (path === '/identity/verify-email' || resetLink) {
          const expected = `${origin}/${resetLink ? 'reset-password' : 'sign-in'}`;
          if (
            url.searchParams.has('callbackURL') &&
            url.searchParams.get('callbackURL') !== expected
          )
            return reply.code(400).send({ code: 'INVALID_CALLBACK' });
          url.searchParams.set('callbackURL', expected);
        }
        if (request.method === 'POST')
          body = form
            ? new URLSearchParams(payload as Record<string, string>).toString()
            : JSON.stringify(payload);
        const response = await authority.handle(
          new Request(url, {
            method: request.method,
            headers,
            ...(request.method === 'POST' && body !== undefined ? { body: String(body) } : {}),
          }),
        );
        if (response.status >= 500) return reply.code(503).send({ code: 'AUTH_UNAVAILABLE' });
        let content = await response.text();
        if (
          content &&
          response.ok &&
          response.headers.get('content-type')?.includes('application/json')
        )
          content = JSON.stringify(projectPublicAuthResponse(path, JSON.parse(content)));
        reply.code(response.status);
        for (const [key, value] of response.headers)
          if (!['set-cookie', 'content-length', 'cache-control', 'referrer-policy'].includes(key))
            reply.header(key, value);
        const cookies = response.headers.getSetCookie();
        if (cookies.length) reply.header('set-cookie', cookies);
        return content ? reply.send(content) : reply.send();
      } catch {
        // No raw library/SQL/SMTP errors, request bodies, cookies or token-bearing URLs in logs.
        return reply.code(503).send({ code: 'AUTH_UNAVAILABLE' });
      }
    }
  });
}
