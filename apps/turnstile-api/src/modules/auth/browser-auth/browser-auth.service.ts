import { HttpException, Injectable } from '@nestjs/common';
import {
  type LogoutDto,
  TURNSTILE_PERMISSIONS,
  type TurnstilePermission,
  type UserSessionDto,
} from '@thaarei/turnstile-contracts';
import type { FastifyReply, FastifyRequest, Session } from 'fastify';
import { productCookiePolicy } from '../../../infrastructure/auth-environment.js';
import { withTenant } from '../../../infrastructure/database/postgres.js';
import { ProductDatabaseService } from '../product-database/product-database.service.js';
import { authError } from './auth-errors.js';
import {
  type BffState,
  equal,
  IDLE_MS,
  opaque,
  REFRESH_LEASE_MS,
  TRANSACTION_MS,
  type UserIdentity,
} from './bff-state.js';
import { verifyProductCsrf } from './csrf.js';
import { authorityCookies, loginFailure, OidcService } from './oidc.service.js';

@Injectable()
export class BrowserAuthService {
  constructor(
    private readonly database: ProductDatabaseService,
    private readonly oidc: OidcService,
  ) {}

  private get store() {
    if (!this.database.store) return authError(503, 'AUTH_UNAVAILABLE');
    return this.database.store;
  }
  private async ready() {
    if (!(await this.database.ready())) authError(503, 'AUTH_UNAVAILABLE');
  }
  private atomic<T>(request: FastifyRequest, change: Parameters<typeof this.store.atomic<T>>[2]) {
    return this.store.atomic(request.session.sessionStoreId, request.session.sessionId, change);
  }
  private canonical(request: FastifyRequest) {
    const url = new URL(request.url, this.oidc.config.AUTH_PUBLIC_ORIGIN);
    for (const key of url.searchParams.keys())
      if (url.searchParams.getAll(key).length !== 1) authError(400, 'INVALID_AUTH_REQUEST');
    return url;
  }
  private localPath(value: string | null) {
    if (!value) return '/';
    // A small, literal local-path surface prevents encoded redirects and auth loops.
    if (
      !/^\/(?:[A-Za-z0-9_-]+\/?)*$/.test(value) ||
      value.startsWith('/api') ||
      value.startsWith('/identity')
    )
      return authError(400, 'INVALID_AUTH_REQUEST');
    return value;
  }
  private async access(userId: string): Promise<TurnstilePermission[]> {
    const pool = this.database.pool;
    if (!pool) return authError(503, 'AUTH_UNAVAILABLE');
    const { rows } = await withTenant(pool, this.oidc.config.INSTALLATION_TENANT_ID, (connection) =>
      connection.query(
        'SELECT enabled, permissions FROM turnstile.user_access WHERE user_id = $1',
        [userId],
      ),
    );
    const row = rows[0];
    if (
      !row?.enabled ||
      !Array.isArray(row.permissions) ||
      !row.permissions.includes('turnstile:access')
    )
      return authError(403, 'PRODUCT_ACCESS_DENIED');
    return TURNSTILE_PERMISSIONS.filter((permission) => row.permissions.includes(permission));
  }

  async login(request: FastifyRequest, reply: FastifyReply) {
    await this.ready();
    if (
      request.headers['sec-fetch-site'] === 'cross-site' ||
      (request.headers.origin && request.headers.origin !== this.oidc.config.AUTH_PUBLIC_ORIGIN)
    )
      return authError(403, 'CSRF_REJECTED');
    const url = this.canonical(request);
    if ([...url.searchParams.keys()].some((key) => key !== 'returnTo'))
      authError(400, 'INVALID_AUTH_REQUEST');
    const transaction: Extract<BffState, { kind: 'login' }> = {
      kind: 'login',
      issuer: this.oidc.config.AUTH_ISSUER_URL,
      redirect: this.oidc.config.AUTH_LOGIN_CALLBACK_URL,
      state: opaque(),
      nonce: opaque(),
      verifier: opaque(),
      returnTo: this.localPath(url.searchParams.get('returnTo')),
      expiresAt: Date.now() + TRANSACTION_MS,
    };
    const destination = await this.oidc.authorization(transaction);
    // Regeneration preserves the store ID but rotates its fenced cookie generation.
    if (request.session.isPersisted()) {
      await request.session.reload();
      await request.session.regenerate(['bffRevision']);
    }
    request.session.options({ maxAge: TRANSACTION_MS });
    request.session.bff = transaction;
    await request.session.save();
    reply.code(302).redirect(destination);
  }

  async callback(request: FastifyRequest, reply: FastifyReply) {
    await this.ready();
    const url = this.canonical(request);
    if (
      url.origin + url.pathname !== this.oidc.config.AUTH_LOGIN_CALLBACK_URL ||
      [...url.searchParams.keys()].some(
        (key) => !['code', 'state', 'iss', 'error', 'error_description'].includes(key),
      )
    )
      return authError(400, 'LOGIN_TRANSACTION_INVALID');
    const transaction = await this.atomic(request, (session) => {
      const pending = session.bff;
      if (pending?.kind !== 'login' || !equal(url.searchParams.get('state'), pending.state))
        return undefined;
      session.bff = { kind: 'consumed' };
      return pending;
    });
    if (
      !transaction ||
      transaction.expiresAt <= Date.now() ||
      transaction.issuer !== this.oidc.config.AUTH_ISSUER_URL ||
      transaction.redirect !== this.oidc.config.AUTH_LOGIN_CALLBACK_URL ||
      url.searchParams.has('error') ||
      (url.searchParams.has('iss') && url.searchParams.get('iss') !== transaction.issuer)
    )
      return authError(400, 'LOGIN_TRANSACTION_INVALID');
    let identity: UserIdentity | undefined;
    try {
      identity = await this.oidc.exchange(url, transaction, authorityCookies(request));
      await this.oidc.active(identity);
      identity.permissions = await this.access(identity.user.id);
      await request.session.reload();
      await request.session.regenerate(['bffRevision']);
      request.session.options({ maxAge: identity.absoluteExpiresAt - Date.now() });
      request.session.bff = { kind: 'user', identity, csrf: opaque() };
      await request.session.save();
    } catch (error) {
      if (identity) await this.oidc.revoke(identity).catch(() => {});
      return loginFailure(error);
    }
    reply.clearCookie(`${productCookiePolicy(this.oidc.config).cookieName}-logout`, { path: '/' });
    reply.code(302).redirect(transaction.returnTo);
  }

  csrf(request: FastifyRequest, expected: string) {
    verifyProductCsrf(request, expected, this.oidc.config.AUTH_PUBLIC_ORIGIN);
  }

  private retire(session: Session) {
    const state = session.bff;
    if (state?.kind !== 'user') return;
    const receipt: Extract<BffState, { kind: 'logout' }> = {
      kind: 'logout',
      csrf: state.csrf,
      sid: state.identity.sid,
      identity: state.identity,
      complete: false,
      expiresAt: Date.now() + TRANSACTION_MS,
    };
    session.bff = receipt;
    session.cookie.expires = new Date(receipt.expiresAt);
  }

  private async invalidate(request: FastifyRequest) {
    await this.atomic(request, (session) => {
      this.retire(session);
      return true;
    });
  }

  async authenticate(request: FastifyRequest): Promise<{ identity: UserIdentity; csrf: string }> {
    await this.ready();
    const snapshot = await this.atomic(request, (session) => {
      const state = session.bff;
      if (state?.kind !== 'user') return undefined;
      if (Math.min(state.identity.absoluteExpiresAt, state.identity.idleExpiresAt) <= Date.now()) {
        this.retire(session);
        return undefined;
      }
      return state;
    });
    if (!snapshot) return authError(401, 'IDENTITY_REQUIRED');
    let identity = snapshot.identity;
    if (identity.accessExpiresAt - Date.now() < 30_000 || snapshot.refresh) {
      const fence = opaque();
      const claim = await this.atomic(request, (session) => {
        const state = session.bff;
        if (state?.kind !== 'user') return 'gone' as const;
        if (state.refresh) {
          if (Date.now() - state.refresh.startedAt < REFRESH_LEASE_MS) return 'busy' as const;
          this.retire(session);
          return 'lost' as const;
        }
        if (state.identity.accessExpiresAt - Date.now() >= 30_000) return 'updated' as const;
        state.refresh = { fence, startedAt: Date.now() };
        return state.identity;
      });
      if (claim === 'busy') return authError(503, 'REFRESH_IN_PROGRESS');
      if (!claim || claim === 'gone' || claim === 'lost') return authError(401, 'LOGIN_REQUIRED');
      if (claim === 'updated') return this.authenticate(request);
      let refreshed: UserIdentity;
      try {
        refreshed = await this.oidc.refresh(claim);
      } catch {
        // The authority may already have rotated the token. Never retry an uncertain grant.
        await this.invalidate(request);
        return authError(401, 'LOGIN_REQUIRED');
      }
      const committed = await this.atomic(request, (session) => {
        const state = session.bff;
        if (
          state?.kind !== 'user' ||
          state.refresh?.fence !== fence ||
          Date.now() - state.refresh.startedAt >= REFRESH_LEASE_MS ||
          Math.min(state.identity.absoluteExpiresAt, state.identity.idleExpiresAt) <= Date.now()
        )
          return false;
        state.identity = refreshed;
        delete state.refresh;
        return true;
      });
      if (!committed) {
        await this.oidc.revoke(refreshed).catch(() => {});
        return authError(401, 'LOGIN_REQUIRED');
      }
      identity = refreshed;
    }
    try {
      await this.oidc.active(identity);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 401)
        await this.invalidate(request);
      throw error;
    }
    let permissions: TurnstilePermission[];
    try {
      permissions = await this.access(identity.user.id);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 403)
        await this.invalidate(request);
      throw error;
    }
    if (JSON.stringify(permissions) !== JSON.stringify(identity.permissions)) {
      await request.session.reload();
      const state = request.session.bff;
      if (state?.kind !== 'user' || state.refresh) return authError(503, 'REFRESH_IN_PROGRESS');
      state.identity.permissions = permissions;
      state.csrf = opaque();
      await request.session.regenerate(['bff', 'bffRevision']);
    }
    const current = await this.atomic(request, (session) => {
      const state = session.bff;
      if (
        state?.kind !== 'user' ||
        Math.min(state.identity.absoluteExpiresAt, state.identity.idleExpiresAt) <= Date.now()
      )
        return undefined;
      // A concurrent refresh can start or commit while introspection is in flight.
      // Retry with the current token before authorizing; logout and expiry still deny above.
      if (state.refresh || state.identity.accessToken !== identity.accessToken)
        return 'changed' as const;
      state.identity.idleExpiresAt = Math.min(
        Date.now() + IDLE_MS,
        state.identity.absoluteExpiresAt,
      );
      return { identity: state.identity, csrf: state.csrf };
    });
    if (current === 'changed') return authError(503, 'REFRESH_IN_PROGRESS');
    if (!current) return authError(401, 'IDENTITY_REQUIRED');
    request.productUser = current;
    return current;
  }

  session(request: FastifyRequest): UserSessionDto {
    const current = request.productUser;
    if (!current) return authError(401, 'IDENTITY_REQUIRED');
    return {
      user: current.identity.user,
      permissions: current.identity.permissions,
      session: {
        expiresAt: new Date(current.identity.absoluteExpiresAt).toISOString(),
        idleExpiresAt: new Date(current.identity.idleExpiresAt).toISOString(),
      },
      csrfToken: current.csrf,
    };
  }

  async logout(request: FastifyRequest, reply: FastifyReply): Promise<LogoutDto> {
    await this.ready();
    if (new URL(request.url, this.oidc.config.AUTH_PUBLIC_ORIGIN).search)
      authError(400, 'INVALID_AUTH_REQUEST');
    const { cookieName, ...policy } = productCookiePolicy(this.oidc.config);
    const retryName = `${cookieName}-logout`;
    let context = request;
    if (!context.session.isPersisted() && request.cookies[retryName]) {
      // Public plugin API validates the signed, generation-bound retry cookie.
      context = { protocol: request.protocol } as FastifyRequest;
      await new Promise<void>((resolve, reject) =>
        request.server.decryptSession(
          request.cookies[retryName] as string,
          context,
          (error?: Error) => (error ? reject(error) : resolve()),
        ),
      );
    }
    const receipt = await this.atomic(context, (session) => {
      const state = session.bff;
      if (state?.kind !== 'user' && state?.kind !== 'logout') return undefined;
      this.csrf(request, state.csrf);
      if (state.kind === 'logout') return state.expiresAt > Date.now() ? state : undefined;
      this.retire(session);
      return session.bff as Extract<BffState, { kind: 'logout' }>;
    });
    if (!receipt) return authError(401, 'IDENTITY_REQUIRED');
    // Product authorization is already gone before any authority HTTP calls.
    reply.clearCookie(cookieName, policy);
    reply.setCookie(retryName, context.session.encryptedSessionId, {
      ...policy,
      expires: new Date(receipt.expiresAt),
    });
    let complete = receipt.complete;
    if (complete || receipt.identity) {
      try {
        const cookies = complete
          ? await this.oidc.clearBrowserSession(authorityCookies(request), receipt.sid)
          : receipt.identity
            ? await this.oidc.logout(receipt.identity, authorityCookies(request))
            : [];
        const previous = reply.getHeader('set-cookie');
        reply.header('set-cookie', [
          ...(Array.isArray(previous) ? previous : typeof previous === 'string' ? [previous] : []),
          ...cookies,
        ]);
        complete = true;
        await this.atomic(context, (session) => {
          if (session.bff?.kind === 'logout') {
            session.bff.complete = true;
            delete session.bff.identity;
          }
          return true;
        });
      } catch {
        /* Local logout is complete; retain bounded credentials for explicit retry. */
        complete = false;
      }
    }
    return {
      local: 'complete',
      authority: complete ? 'complete' : 'pending',
      ...(!complete ? { retryUntil: new Date(receipt.expiresAt).toISOString() } : {}),
    };
  }
}
