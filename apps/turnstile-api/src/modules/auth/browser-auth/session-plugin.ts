import cookie from '@fastify/cookie';
import session from '@fastify/session';
import type { FastifyInstance } from 'fastify';
import type { parseProductEnvironment } from '../../../infrastructure/auth-environment.js';
import { productCookiePolicy } from '../../../infrastructure/auth-environment.js';
import type { PostgresSessionStore } from '../persistence/postgres-session-store.js';
import { ABSOLUTE_MS } from './bff-state.js';

export async function registerProductSession(
  server: FastifyInstance,
  config: ReturnType<typeof parseProductEnvironment>,
  store: PostgresSessionStore,
) {
  const { cookieName, ...policy } = productCookiePolicy(config);
  await server.register(cookie);
  server.addHook('onRequest', async (request) => {
    if (
      ['/api', '/api/', '/health/live', '/health/ready/auth'].includes(
        request.url.split('?')[0] ?? '',
      )
    )
      delete request.cookies[cookieName];
  });
  server.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/'))
      reply.header('cache-control', 'private, no-store').header('referrer-policy', 'no-referrer');
    const current = request.session;
    const loaded = typeof current?.isSaved === 'function';
    // All product writes are explicit saves or atomic store operations. Issue only
    // a successfully saved cookie, using the canonical TLS policy behind ingress.
    // This does not trust Host/X-Forwarded-Proto or enable broad proxy trust.
    if (loaded && current.isSaved())
      reply.setCookie(cookieName, current.encryptedSessionId, {
        ...policy,
        ...(current.cookie.expires ? { expires: current.cookie.expires } : {}),
      });
    else if (loaded && request.cookies[cookieName] && !current.isPersisted())
      reply.clearCookie(cookieName, policy);
    // Suppress the plugin's implicit save/cookie hook, which would use transport
    // protocol at the internal HTTP listener and could overwrite fenced state.
    request.session = null as unknown as typeof request.session;
    return payload;
  });
  await server.register(session, {
    secret: config.TURNSTILE_COOKIE_SECRET,
    store,
    cookieName,
    cookie: { ...policy, maxAge: ABSOLUTE_MS },
    saveUninitialized: false,
    rolling: false,
  });
}
