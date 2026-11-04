import { randomBytes } from 'node:crypto';
import { MemoryStore } from '@fastify/session';
import Fastify, { type FastifyRequest, type Session } from 'fastify';
import { parseProductEnvironment } from '../../../infrastructure/auth-environment.js';
import type { EffectiveAccess } from '../../access/access-evaluator.js';
import type { AccessRepositoryService } from '../../access/access-repository/access-repository.service.js';
import type { PostgresSessionStore } from '../persistence/postgres-session-store.js';
import type { ProductDatabaseService } from '../product-database/product-database.service.js';
import { generation, type InvitationContinuation, type UserIdentity } from './bff-state.js';
import { BrowserAuthService } from './browser-auth.service.js';
import type { OidcService } from './oidc.service.js';
import { registerProductSession } from './session-plugin.js';

// Keep the pinned plugin's real generation CAS and cookie behavior. This adapter
// supplies only the synchronous atomic boundary normally provided by PostgreSQL.
class RecipientSessionStore extends MemoryStore {
  readonly sessions: Map<string, Session>;
  beforePromotedRead: ((session: Session) => void) | undefined;

  constructor() {
    const sessions = new Map<string, Session>();
    super(sessions);
    this.sessions = sessions;
  }

  override get(id: string, callback: Parameters<MemoryStore['get']>[1]) {
    const stored = this.sessions.get(id);
    if (stored?.bff?.kind === 'user' && this.beforePromotedRead) {
      this.beforePromotedRead(stored);
      this.beforePromotedRead = undefined;
    }
    super.get(id, callback);
  }

  async atomic<T>(id: string, expectedGeneration: string, change: (session: Session) => T) {
    const stored = this.sessions.get(id);
    if (!stored || generation(stored, id) !== expectedGeneration) return undefined;
    // Match the serialized storage boundary, without sharing mutable request state.
    const snapshot = JSON.parse(JSON.stringify(stored)) as Session;
    const result = change(snapshot);
    snapshot.bffRevision = (snapshot.bffRevision ?? 0) + 1;
    this.sessions.set(id, snapshot);
    return result;
  }
}

const origin = 'http://localhost:5173';
const restrictedLifetime = 20 * 60 * 1000;

async function recipientFixture(
  identityLifetime: number,
  beforeSessionLoad?: (request: FastifyRequest) => Promise<void>,
) {
  const now = Date.now();
  const identity: UserIdentity = {
    user: { id: 'recipient-subject', name: 'Recipient', email: 'recipient@example.test' },
    sid: 'verified-parent-session',
    accessToken: 'fixture-access-token',
    refreshToken: 'fixture-refresh-token',
    idToken: 'fixture-id-token',
    accessExpiresAt: now + 300_000,
    absoluteExpiresAt: now + identityLifetime,
    idleExpiresAt: now + Math.min(identityLifetime, 30 * 60 * 1000),
    permissions: [],
  };
  const continuation: InvitationContinuation = {
    id: 'continuation',
    invitationId: '20000000-0000-4000-8000-000000000001',
    generation: 1,
    credentialDigest: 'fixture-digest',
    recoveryEpoch: 'fixture-epoch',
    csrf: 'fixture-csrf',
    expiresAt: now + restrictedLifetime,
    setupOperationId: '20000000-0000-4000-8000-000000000002',
    accepted: true,
    identity: {
      kind: 'invitation',
      issuer: `${origin}/identity`,
      value: identity,
      expiresAt: Math.min(now + 600_000, identity.absoluteExpiresAt),
    },
  };
  const access: EffectiveAccess = {
    memberId: '20000000-0000-4000-8000-000000000003',
    status: 'active',
    memberVersion: 1,
    workspaceComplete: true,
    protectedAdministrator: false,
    units: new Map(),
    context: {
      catalogVersion: 1,
      accessRevision: 1,
      fingerprint: 'a'.repeat(64),
      grants: [
        {
          sourceId: '20000000-0000-4000-8000-000000000004',
          permissions: ['turnstile:access'],
          scope: { kind: 'company' },
        },
      ],
    },
  };
  const config = parseProductEnvironment({
    AUTH_PROFILE: 'test',
    AUTH_PUBLIC_ORIGIN: origin,
    AUTH_ISSUER_URL: `${origin}/identity`,
    AUTH_LOGIN_CALLBACK_URL: `${origin}/api/auth/callback`,
    AUTH_LOGIN_CLIENT_ID: 'fixture-login',
    AUTH_LOGIN_CLIENT_SECRET: randomBytes(48).toString('base64url'),
    DMS_MACHINE_CLIENT_ID: 'fixture-machine',
    TURNSTILE_COOKIE_SECRET: randomBytes(48).toString('base64url'),
    TURNSTILE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    TURNSTILE_DATABASE_URL: 'postgresql://unused:unused@localhost/unused',
    INSTALLATION_TENANT_ID: '20000000-0000-4000-8000-000000000005',
    INSTALLATION_CUSTOMER_KEY: 'recipient-fixture',
    TURNSTILE_APPLICATION_ID: '20000000-0000-4000-8000-000000000006',
  });
  const store = new RecipientSessionStore();
  // Network identity verification and canonical access reads are separate owning
  // boundaries; the service's continuation checks and transitions remain real.
  const auth = new BrowserAuthService(
    { store, ready: async () => true } as unknown as ProductDatabaseService,
    {
      config,
      recipientActive: async () => identity.user.email,
      active: async () => {},
    } as unknown as OidcService,
    { read: async () => access } as unknown as AccessRepositoryService,
  );
  const app = Fastify();
  if (beforeSessionLoad) app.addHook('onRequest', beforeSessionLoad);
  await registerProductSession(app, config, store as unknown as PostgresSessionStore);
  app.post('/api/fixture/recipient', async (request) => {
    request.session.options({ maxAge: restrictedLifetime });
    request.session.bff = { kind: 'restricted' };
    request.session.invitation = continuation;
    await request.session.save();
    return {};
  });
  app.post('/api/fixture/accept', async (request) => {
    await auth.establishInvitation(request, continuation);
    return {};
  });
  app.get('/api/fixture/session', async (request) => {
    await auth.authenticate(request);
    return auth.session(request);
  });
  app.post('/api/fixture/change-context', async (request) => {
    await auth.authenticate(request);
    return {};
  });
  const seeded = await app.inject({ method: 'POST', url: '/api/fixture/recipient' });
  const cookie = seeded.cookies.find((value) => value.name === 'turnstile');
  if (!cookie) throw new Error('Restricted cookie missing');
  return { app, store, identity, access, cookie: `turnstile=${cookie.value}` };
}

function deferred() {
  let complete: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    complete = resolve;
  });
  return { promise, resolve: () => complete() };
}

describe('ordinary session after invitation acceptance', () => {
  it.each([
    { label: 'shortened authority parent', lifetime: 60_000 },
    { label: 'ordinary eight-hour identity', lifetime: 8 * 60 * 60 * 1000 },
  ])('binds emitted and persisted expiry to the $label', async ({ lifetime }) => {
    const fixture = await recipientFixture(lifetime);
    try {
      const restricted = [...fixture.store.sessions.values()][0];
      expect(restricted?.cookie.originalMaxAge).toBe(restrictedLifetime);
      const accepted = await fixture.app.inject({
        method: 'POST',
        url: '/api/fixture/accept',
        headers: { cookie: fixture.cookie },
      });
      expect(accepted.statusCode).toBe(200);
      const cookie = accepted.cookies.find((value) => value.name === 'turnstile');
      expect(cookie?.value).not.toBe(fixture.cookie.slice('turnstile='.length));
      // HTTP cookie dates have second precision; persisted expiry retains milliseconds.
      const emittedExpiry = Date.parse(String(cookie?.expires));
      expect(emittedExpiry).toBeLessThanOrEqual(fixture.identity.absoluteExpiresAt);
      expect(emittedExpiry).toBeGreaterThan(fixture.identity.absoluteExpiresAt - 1000);
      const normal = [...fixture.store.sessions.values()][0];
      expect(normal?.bff?.kind).toBe('user');
      expect(
        Math.abs(
          new Date(normal?.cookie.expires ?? 0).getTime() - fixture.identity.absoluteExpiresAt,
        ),
      ).toBeLessThan(1000);
    } finally {
      await fixture.app.close();
    }
  });

  it('rejects a promotion replaced before its reload without issuing a normal cookie', async () => {
    const fixture = await recipientFixture(60_000);
    fixture.store.beforePromotedRead = (session) => {
      session.bff = { kind: 'restricted' };
      delete session.invitation;
    };
    try {
      const accepted = await fixture.app.inject({
        method: 'POST',
        url: '/api/fixture/accept',
        headers: { cookie: fixture.cookie },
      });
      expect(accepted.statusCode).toBe(401);
      expect(accepted.cookies).toHaveLength(0);
      expect([...fixture.store.sessions.values()][0]?.bff?.kind).toBe('restricted');
    } finally {
      await fixture.app.close();
    }
  });

  it('keeps a rotated cookie when a concurrent old-generation read responds later', async () => {
    const started = deferred();
    const resume = deferred();
    const fixture = await recipientFixture(8 * 60 * 60 * 1000, async (request) => {
      if (request.url === '/api/fixture/session?delayed') {
        started.resolve();
        await resume.promise;
      }
    });
    try {
      const accepted = await fixture.app.inject({
        method: 'POST',
        url: '/api/fixture/accept',
        headers: { cookie: fixture.cookie },
      });
      expect(accepted.statusCode).toBe(200);
      const oldCookie = `turnstile=${accepted.cookies.find((value) => value.name === 'turnstile')?.value}`;
      const before = await fixture.app.inject({
        url: '/api/fixture/session',
        headers: { cookie: oldCookie },
      });
      expect(before.statusCode).toBe(200);

      // Both requests carry the old cookie. Network/store scheduling lets this
      // read load its generation after the other response has installed a new one.
      const lateRead = fixture.app
        .inject({
          url: '/api/fixture/session?delayed',
          headers: { cookie: oldCookie },
        })
        .then((response) => response);
      await started.promise;
      fixture.access.context = { ...fixture.access.context, fingerprint: 'b'.repeat(64) };
      const rotated = await fixture.app.inject({
        method: 'POST',
        url: '/api/fixture/change-context',
        headers: {
          cookie: oldCookie,
          origin,
          'x-csrf-token': before.json().csrfToken,
        },
      });
      expect(rotated.statusCode).toBe(409);
      const issued = rotated.cookies.find((value) => value.name === 'turnstile');
      expect(issued?.value).toBeTruthy();
      const newCookie = `turnstile=${issued?.value}`;
      expect(newCookie).not.toBe(oldCookie);

      resume.resolve();
      const stale = await lateRead;
      expect(stale.statusCode).toBe(401);
      expect(stale.headers['set-cookie']).toBeUndefined();

      const current = await fixture.app.inject({
        url: '/api/fixture/session',
        headers: { cookie: newCookie },
      });
      expect(current.statusCode).toBe(200);
      expect(current.json().user.id).toBe(fixture.identity.user.id);
      expect(current.json().access.fingerprint).toBe('b'.repeat(64));
      const old = await fixture.app.inject({
        url: '/api/fixture/session',
        headers: { cookie: oldCookie },
      });
      expect(old.statusCode).toBe(401);
      expect(old.headers['set-cookie']).toBeUndefined();
      const invalid = await fixture.app.inject({
        url: '/api/fixture/session',
        headers: { cookie: 'turnstile=invalid-signature' },
      });
      expect(invalid.statusCode).toBe(401);
      expect(invalid.headers['set-cookie']).toBeUndefined();
    } finally {
      resume.resolve();
      await fixture.app.close();
    }
  });
});
