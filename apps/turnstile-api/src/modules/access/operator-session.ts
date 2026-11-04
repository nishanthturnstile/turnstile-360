import Fastify, { type FastifyRequest } from 'fastify';
import {
  parseProductEnvironment,
  productCookiePolicy,
} from '../../infrastructure/auth-environment.js';
import { createPool } from '../../infrastructure/database/postgres.js';
import { registerProductSession } from '../auth/browser-auth/session-plugin.js';
import { PostgresSessionStore } from '../auth/persistence/postgres-session-store.js';

// Private CLI only: recover the server-held userinfo token from a real signed,
// generation-fenced normal session. No token is requested from or returned to the browser.
export async function operatorSession(
  userId: string,
  cookie: string,
  environment: NodeJS.ProcessEnv,
) {
  const config = parseProductEnvironment(environment);
  const name = productCookiePolicy(config).cookieName;
  if (!cookie.startsWith(`${name}=`) || cookie.includes(';') || cookie.length > 8192)
    throw new Error('One normal product cookie required');
  const pool = createPool(config.TURNSTILE_DATABASE_URL, 1);
  const app = Fastify();
  try {
    const store = new PostgresSessionStore(
      pool,
      config.INSTALLATION_TENANT_ID,
      Buffer.from(config.TURNSTILE_TOKEN_ENCRYPTION_KEY, 'hex'),
    );
    await registerProductSession(app, config, store);
    await app.ready();
    const request = { protocol: 'http' } as FastifyRequest;
    await new Promise<void>((resolve, reject) =>
      app.decryptSession(decodeURIComponent(cookie.slice(name.length + 1)), request, (error) =>
        error ? reject(error) : resolve(),
      ),
    );
    const state = request.session.bff;
    if (
      state?.kind !== 'user' ||
      state.identity.user.id !== userId ||
      state.identity.absoluteExpiresAt <= Date.now() ||
      state.identity.idleExpiresAt <= Date.now()
    )
      throw new Error('A current normal administrator login is required');
    return state.identity.accessToken;
  } finally {
    await app.close();
    await pool.end();
  }
}
