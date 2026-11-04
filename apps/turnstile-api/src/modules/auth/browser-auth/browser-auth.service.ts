import { HttpException, Injectable } from '@nestjs/common';
import { type LogoutDto, type UserSessionDto } from '@thaarei/turnstile-contracts';
import type { FastifyReply, FastifyRequest, Session } from 'fastify';
import type { PoolClient } from 'pg';
import { AccessContextChangedException } from '../../../infrastructure/access-context-exception.js';
import { productCookiePolicy } from '../../../infrastructure/auth-environment.js';
import {
  type EffectiveAccess,
  hasShell,
  impliedPermissions,
} from '../../access/access-evaluator.js';
import { AccessRepositoryService } from '../../access/access-repository/access-repository.service.js';
import { ProductDatabaseService } from '../product-database/product-database.service.js';
import { authError } from './auth-errors.js';
import {
  type BffState,
  equal,
  IDLE_MS,
  type InvitationContinuation,
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
    private readonly accessRepository: AccessRepositoryService,
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
  private async access(userId: string): Promise<EffectiveAccess> {
    const access = await this.accessRepository.read(userId);
    if (!hasShell(access)) return authError(403, 'PRODUCT_ACCESS_DENIED');
    return access;
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
    if (request.session.isPersisted()) await request.session.reload();
    const continuation = request.session.invitation;
    const invitation =
      continuation && !continuation.accepted && continuation.expiresAt > Date.now()
        ? {
            id: continuation.id,
            invitationId: continuation.invitationId,
            generation: continuation.generation,
          }
        : undefined;
    const transaction: Extract<BffState, { kind: 'login' }> = {
      kind: 'login',
      issuer: this.oidc.config.AUTH_ISSUER_URL,
      redirect: this.oidc.config.AUTH_LOGIN_CALLBACK_URL,
      state: opaque(),
      nonce: opaque(),
      verifier: opaque(),
      returnTo: invitation ? '/invitations/join' : this.localPath(url.searchParams.get('returnTo')),
      ...(invitation ? { invitation } : {}),
      expiresAt: Date.now() + TRANSACTION_MS,
    };
    const destination = await this.oidc.authorization(transaction);
    // Regeneration preserves the store ID but rotates its fenced cookie generation.
    if (request.session.isPersisted()) {
      await request.session.reload();
      await request.session.regenerate(['bffRevision', 'invitation']);
    }
    request.session.options({
      maxAge: invitation && continuation ? continuation.expiresAt - Date.now() : TRANSACTION_MS,
    });
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
      if (transaction.invitation) {
        await request.session.reload();
        const current = request.session.invitation;
        if (
          !current ||
          current.accepted ||
          request.session.bff?.kind !== 'consumed' ||
          current.expiresAt <= Date.now() ||
          current.id !== transaction.invitation.id ||
          current.invitationId !== transaction.invitation.invitationId ||
          current.generation !== transaction.invitation.generation
        )
          return authError(400, 'LOGIN_TRANSACTION_INVALID');
        current.identity = {
          kind: 'invitation',
          issuer: transaction.issuer,
          value: identity,
          expiresAt: Math.min(Date.now() + 600000, current.expiresAt, identity.absoluteExpiresAt),
        };
        delete current.logout;
        await request.session.regenerate(['bffRevision', 'invitation']);
        request.session.options({ maxAge: current.expiresAt - Date.now() });
        request.session.bff = { kind: 'restricted' };
        await request.session.save();
        return reply.code(302).redirect('/invitations/join');
      }
      const access = await this.access(identity.user.id);
      identity.permissions = impliedPermissions(
        access.context.grants.flatMap((grant) => grant.permissions),
      );
      identity.access = access.context;
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

  async installInvitation(
    request: FastifyRequest,
    binding: Omit<InvitationContinuation, 'parent'>,
  ) {
    await this.ready();
    if (request.session.isPersisted()) await request.session.reload();
    const previous = request.session.bff;
    const parent =
      previous?.kind === 'user'
        ? previous.identity
        : (request.session.invitation?.identity?.value ?? request.session.invitation?.parent);
    if (request.session.isPersisted()) await request.session.regenerate(['bffRevision']);
    request.session.invitation = { ...binding, ...(parent ? { parent } : {}) };
    request.session.bff = { kind: 'restricted' };
    request.session.options({ maxAge: binding.expiresAt - Date.now() });
    await request.session.save();
  }

  async invitation(request: FastifyRequest, mutation = false): Promise<InvitationContinuation> {
    await this.ready();
    const current = await this.atomic(request, (session) => {
      const current = session.invitation;
      if (!current || current.expiresAt <= Date.now()) return undefined;
      if (mutation) this.csrf(request, current.csrf);
      if (current.logout && current.logout.expiresAt <= Date.now()) delete current.logout;
      return current;
    });
    if (!current) throw new HttpException({ code: 'INVITATION_IDENTITY_REQUIRED' }, 401);
    return current;
  }

  async invitationIdentity(request: FastifyRequest, current: InvitationContinuation) {
    const identity = current.identity;
    if (
      identity?.kind !== 'invitation' ||
      identity.issuer !== this.oidc.config.AUTH_ISSUER_URL ||
      identity.expiresAt <= Date.now() ||
      identity.value.absoluteExpiresAt <= Date.now()
    )
      throw new HttpException({ code: 'INVITATION_IDENTITY_REQUIRED' }, 401);
    // Short-lived restricted identities require a new purpose login when their access
    // token expires. Never retry an uncertain refresh grant in the recipient bridge.
    const email = await this.oidc.recipientActive(identity.value, authorityCookies(request));
    const unchanged = await this.atomic(
      request,
      (session) =>
        session.invitation?.id === current.id &&
        session.invitation.csrf === current.csrf &&
        session.invitation.identity?.value.sid === identity.value.sid &&
        session.invitation.identity.expiresAt > Date.now(),
    );
    if (!unchanged) throw new HttpException({ code: 'INVITATION_IDENTITY_REQUIRED' }, 401);
    return { ...identity.value, user: { ...identity.value.user, email } };
  }

  async fenceInvitation(
    db: PoolClient,
    request: FastifyRequest,
    current: InvitationContinuation,
    sid?: string,
  ) {
    if (
      !(await this.store.invitationFence(
        db,
        request.session.sessionStoreId,
        request.session.sessionId,
        current.id,
        current.csrf,
        sid,
      ))
    )
      throw new HttpException({ code: 'INVITATION_IDENTITY_REQUIRED' }, 401);
  }

  async markInvitationAccepted(
    db: PoolClient,
    request: FastifyRequest,
    current: InvitationContinuation,
  ) {
    await this.store.markInvitationAccepted(
      db,
      request.session.sessionStoreId,
      request.session.sessionId,
      current.id,
    );
  }

  async establishInvitation(request: FastifyRequest, current: InvitationContinuation) {
    const identity = await this.invitationIdentity(request, current);
    const access = await this.access(identity.user.id);
    const committed = await this.atomic(request, (session) => {
      if (
        session.invitation?.id !== current.id ||
        session.invitation.csrf !== current.csrf ||
        session.invitation.identity?.value.sid !== identity.sid
      )
        return false;
      identity.permissions = impliedPermissions(
        access.context.grants.flatMap((g) => g.permissions),
      );
      identity.access = access.context;
      session.bff = { kind: 'user', identity, csrf: opaque() };
      session.cookie.expires = new Date(identity.absoluteExpiresAt);
      return true;
    });
    if (!committed) throw new HttpException({ code: 'INVITATION_IDENTITY_REQUIRED' }, 401);
    await request.session.reload();
    const promoted = request.session.bff;
    if (
      promoted?.kind !== 'user' ||
      promoted.identity.sid !== identity.sid ||
      promoted.identity.user.id !== identity.user.id ||
      promoted.identity.absoluteExpiresAt <= Date.now()
    )
      throw new HttpException({ code: 'INVITATION_IDENTITY_REQUIRED' }, 401);
    // Regeneration otherwise restores the restricted cookie's originalMaxAge.
    request.session.options({ maxAge: promoted.identity.absoluteExpiresAt - Date.now() });
    await request.session.regenerate(['bff', 'bffRevision', 'invitation']);
    await request.session.save();
  }

  async cancelInvitation(request: FastifyRequest, current: InvitationContinuation) {
    await this.atomic(request, (session) => {
      if (session.invitation?.id !== current.id || session.invitation.csrf !== current.csrf)
        throw new HttpException({ code: 'INVITATION_IDENTITY_REQUIRED' }, 401);
      delete session.invitation;
      if (session.bff?.kind !== 'user') session.bff = { kind: 'consumed' };
      return true;
    });
  }

  async endInvitationParent(
    request: FastifyRequest,
    reply: FastifyReply,
    current: InvitationContinuation,
  ) {
    const receipt = await this.atomic(request, (session) => {
      const flow = session.invitation;
      if (!flow || flow.id !== current.id || flow.csrf !== current.csrf)
        throw new HttpException({ code: 'INVITATION_IDENTITY_REQUIRED' }, 401);
      if (!flow.logout) {
        const identity = flow.identity?.value ?? flow.parent;
        if (!identity) throw new HttpException({ code: 'INVITATION_IDENTITY_REQUIRED' }, 401);
        flow.logout = {
          sid: identity.sid,
          identity,
          expiresAt: Date.now() + TRANSACTION_MS,
          complete: false,
        };
      }
      delete flow.identity;
      delete flow.parent;
      session.bff = { kind: 'restricted' };
      return flow.logout;
    });
    if (!receipt || receipt.expiresAt <= Date.now())
      throw new HttpException({ code: 'INVITATION_IDENTITY_REQUIRED' }, 401);
    try {
      const cookies = receipt.complete
        ? await this.oidc.clearBrowserSession(authorityCookies(request), receipt.sid)
        : receipt.identity
          ? await this.oidc.logout(receipt.identity, authorityCookies(request))
          : [];
      const previous = reply.getHeader('set-cookie');
      reply.header('set-cookie', [
        ...(Array.isArray(previous) ? previous : typeof previous === 'string' ? [previous] : []),
        ...cookies,
      ]);
      await this.atomic(request, (session) => {
        if (
          session.invitation?.id === current.id &&
          session.invitation.logout?.sid === receipt.sid
        ) {
          session.invitation.logout.complete = true;
          delete session.invitation.logout.identity;
        }
        return true;
      });
      return { local: 'complete' as const, authority: 'complete' as const };
    } catch {
      return {
        local: 'complete' as const,
        authority: 'pending' as const,
        retryUntil: new Date(receipt.expiresAt).toISOString(),
      };
    }
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

  async authenticate(request: FastifyRequest): Promise<NonNullable<FastifyRequest['productUser']>> {
    await this.ready();
    const snapshot = await this.atomic(request, (session) => {
      const state = session.bff;
      if (state?.kind !== 'user') return undefined;
      if (Math.min(state.identity.absoluteExpiresAt, state.identity.idleExpiresAt) <= Date.now()) {
        this.retire(session);
        return undefined;
      }
      // Validate the incoming request against its incoming generation/token, before
      // refresh or access-context regeneration can replace either one.
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) this.csrf(request, state.csrf);
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
    let access: EffectiveAccess;
    try {
      access = await this.access(identity.user.id);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 403)
        await this.invalidate(request);
      throw error;
    }
    const permissions = impliedPermissions(
      access.context.grants.flatMap((grant) => grant.permissions),
    );
    if (
      identity.access?.fingerprint !== access.context.fingerprint ||
      JSON.stringify(permissions) !== JSON.stringify(identity.permissions)
    ) {
      try {
        await request.session.reload();
        const state = request.session.bff;
        if (state?.kind !== 'user') return authError(401, 'IDENTITY_REQUIRED');
        if (
          Math.min(state.identity.absoluteExpiresAt, state.identity.idleExpiresAt) <= Date.now()
        ) {
          await this.invalidate(request);
          return authError(401, 'IDENTITY_REQUIRED');
        }
        if (state.refresh || state.identity.accessToken !== identity.accessToken)
          return authError(503, 'REFRESH_IN_PROGRESS');
        if (state.csrf !== snapshot.csrf)
          throw new AccessContextChangedException(request.id, access.context.accessRevision);
        state.identity.access = access.context;
        state.identity.permissions = permissions;
        state.csrf = opaque();
        request.session.options({ maxAge: state.identity.absoluteExpiresAt - Date.now() });
        // The plugin's generation/revision CAS prevents a stale reload from
        // overwriting concurrent refresh, logout or another context transition.
        await request.session.regenerate(['bff', 'bffRevision']);
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
          throw new AccessContextChangedException(request.id, access.context.accessRevision);
        throw error;
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method))
        throw new AccessContextChangedException(request.id, access.context.accessRevision);
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
      if (
        state.identity.access?.fingerprint !== access.context.fingerprint ||
        (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && state.csrf !== snapshot.csrf)
      )
        return 'access-changed' as const;
      state.identity.access = access.context;
      state.identity.idleExpiresAt = Math.min(
        Date.now() + IDLE_MS,
        state.identity.absoluteExpiresAt,
      );
      return { identity: state.identity, csrf: state.csrf, access };
    });
    if (current === 'changed') return authError(503, 'REFRESH_IN_PROGRESS');
    if (current === 'access-changed')
      throw new AccessContextChangedException(request.id, access.context.accessRevision);
    if (!current) return authError(401, 'IDENTITY_REQUIRED');
    request.productUser = current;
    return current;
  }

  session(request: FastifyRequest): UserSessionDto {
    const current = request.productUser;
    if (!current) return authError(401, 'IDENTITY_REQUIRED');
    if (!current.identity.access) return authError(503, 'AUTH_UNAVAILABLE');
    return {
      user: current.identity.user,
      permissions: current.identity.permissions,
      session: {
        expiresAt: new Date(current.identity.absoluteExpiresAt).toISOString(),
        idleExpiresAt: new Date(current.identity.idleExpiresAt).toISOString(),
      },
      csrfToken: current.csrf,
      access: current.identity.access,
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
