import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SessionStore } from '@fastify/session';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { createApplication } from '../src/bootstrap.js';
import { parseProductEnvironment } from '../src/infrastructure/auth-environment.js';
import { bootstrapInstallation } from '../src/infrastructure/database/migrate.js';
import { withTenant } from '../src/infrastructure/database/postgres.js';
import { PostgresSessionStore } from '../src/modules/auth/persistence/postgres-session-store.js';
import { ProductDatabaseService } from '../src/modules/auth/product-database/product-database.service.js';

describe('owned product persistence', () => {
  const config = parseProductEnvironment(process.env);
  const runtime = new Pool({ connectionString: config.TURNSTILE_DATABASE_URL, max: 1 });
  const owner = new Pool({ connectionString: process.env.TURNSTILE_MIGRATION_DATABASE_URL });
  const tenantId = config.INSTALLATION_TENANT_ID;
  const key = Buffer.from(config.TURNSTILE_TOKEN_ENCRYPTION_KEY, 'hex');
  let app: NestFastifyApplication;

  async function start() {
    app = await createApplication(false);
    const database = app.get(ProductDatabaseService);
    expect(await database.ready()).toBe(true);
    if (!database.store) throw new Error('PostgreSQL session store was not configured');
    const fastify = app.getHttpAdapter().getInstance();
    fastify.get('/session-fixture', async (request) => {
      if (!request.session.isPersisted()) {
        request.session.bff = { kind: 'consumed' };
        await request.session.save();
      }
      return { id: request.session.sessionId };
    });
    fastify.post('/logout-fixture', async (request) => {
      await request.session.destroy();
      return { status: 'ok' };
    });
    await app.init();
    await fastify.ready();
  }
  function set(store: SessionStore, id: string, value: Parameters<SessionStore['set']>[1]) {
    return new Promise<void>((resolve, reject) =>
      store.set(id, value, (error?: Error) => (error ? reject(error) : resolve())),
    );
  }
  function get(store: SessionStore, id: string) {
    return new Promise<unknown>((resolve, reject) =>
      store.get(id, (error: unknown, value) => (error ? reject(error) : resolve(value))),
    );
  }
  function destroy(store: SessionStore, id: string) {
    return new Promise<void>((resolve, reject) =>
      store.destroy(id, (error?: Error) => (error ? reject(error) : resolve())),
    );
  }
  function cas(
    store: SessionStore,
    id: string,
    generation: string,
    value: Parameters<SessionStore['set']>[1],
  ) {
    return new Promise<void>((resolve, reject) =>
      store.compareAndSet(id, generation, value, (error?: Error) =>
        error ? reject(error) : resolve(),
      ),
    );
  }
  function value(token = 'fixture-token') {
    return {
      cookie: { expires: new Date(Date.now() + 600000), originalMaxAge: 600000 },
      refreshToken: token,
      __fastifySessionMetadata: { generation: 'initial-generation' },
    } as unknown as Parameters<SessionStore['set']>[1];
  }

  beforeAll(start);
  afterAll(async () => {
    await app?.close();
    await runtime.end();
    await owner.end();
  });

  it('survives API restart through the real Fastify PostgreSQL store', async () => {
    const first = await app.inject({ method: 'GET', url: '/session-fixture' });
    expect(first.statusCode).toBe(200);
    const setCookie = first.headers['set-cookie'];
    const header = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';')[0];
    expect(typeof header).toBe('string');
    if (!header) throw new Error('Session cookie was not returned');
    await app.close();
    await start();
    const restored = await app.inject({
      method: 'GET',
      url: '/session-fixture',
      headers: { cookie: header },
    });
    expect(restored.json()).toEqual(first.json());
    const ended = await app.inject({
      method: 'POST',
      url: '/logout-fixture',
      headers: { cookie: header },
      payload: {},
    });
    expect(ended.statusCode).toBe(200);
    const after = await app.inject({
      method: 'GET',
      url: '/session-fixture',
      headers: { cookie: header },
    });
    expect(after.json().id === first.json().id).toBe(false);
    const readiness = await app.inject({ method: 'GET', url: '/health/ready/auth' });
    expect(readiness.statusCode).toBe(503);
    expect(readiness.json().reason).toBe('authority_unavailable');
  });

  it('encrypts recoverable tokens, hashes session IDs and rejects altered or transplanted ciphertext', async () => {
    const store = new PostgresSessionStore(runtime, tenantId, key);
    const id = randomBytes(32).toString('base64url');
    const token = randomBytes(32).toString('base64url');
    await set(store, id, value(token));
    const rows = await withTenant(
      runtime,
      tenantId,
      async (connection) =>
        (await connection.query('SELECT id_hash, ciphertext FROM turnstile.session')).rows,
    );
    expect(rows.every((row) => row.id_hash !== id && !row.ciphertext.includes(token))).toBe(true);
    expect(((await get(store, id)) as { refreshToken: string }).refreshToken === token).toBe(true);
    const wrongKey = new PostgresSessionStore(runtime, tenantId, randomBytes(32));
    await expect(get(wrongKey, id)).rejects.toThrow('Product session storage unavailable');
    const secondId = randomBytes(32).toString('base64url');
    await set(store, secondId, value());
    const hashes = [id, secondId].map((item) => createHash('sha256').update(item).digest('hex'));
    await withTenant(owner, tenantId, (connection) =>
      connection.query(
        'UPDATE turnstile.session SET ciphertext = (SELECT ciphertext FROM turnstile.session WHERE id_hash = $1) WHERE id_hash = $2',
        hashes,
      ),
    );
    await expect(get(store, secondId)).rejects.toThrow('Product session storage unavailable');
    await destroy(store, secondId);
    await destroy(store, id);
  });

  it('atomically rejects saves after logout or generation changes and removes expired entries', async () => {
    const store = new PostgresSessionStore(runtime, tenantId, key);
    const id = randomBytes(32).toString('base64url');
    await set(store, id, value());
    await cas(store, id, 'initial-generation', {
      ...value(),
      __fastifySessionMetadata: { generation: 'rotated-generation' },
    } as unknown as Parameters<SessionStore['set']>[1]);
    await expect(cas(store, id, 'initial-generation', value())).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await destroy(store, id);
    await expect(cas(store, id, 'rotated-generation', value())).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await get(store, id)).toBe(null);
    const revised = randomBytes(32).toString('base64url');
    await set(store, revised, value());
    await store.atomic(revised, 'initial-generation', (record) => {
      record.bff = { kind: 'consumed' };
    });
    await expect(cas(store, revised, 'initial-generation', value())).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await destroy(store, revised);
    const expired = randomBytes(32).toString('base64url');
    await set(store, expired, value());
    await withTenant(runtime, tenantId, (connection) =>
      connection.query("UPDATE turnstile.session SET expires_at = now() - interval '1 second'"),
    );
    expect(await get(store, expired)).toBe(null);
  });

  it('enforces installation identity, tenant constraints and operator-owned user access', async () => {
    await bootstrapInstallation();
    for (const replacement of [
      { INSTALLATION_TENANT_ID: randomUUID() },
      { INSTALLATION_CUSTOMER_KEY: 'another-customer' },
      { TURNSTILE_APPLICATION_ID: randomUUID() },
    ]) {
      await expect(bootstrapInstallation({ ...process.env, ...replacement })).rejects.toThrow(
        'Installation identity cannot be replaced',
      );
    }
    await withTenant(owner, tenantId, (connection) =>
      connection.query(
        'INSERT INTO turnstile.user_access (tenant_id, user_id, enabled) VALUES ($1, $2, true)',
        [tenantId, 'fixture-user'],
      ),
    );
    expect((await runtime.query('SELECT * FROM turnstile.user_access')).rows).toHaveLength(0);
    await withTenant(runtime, tenantId, async (connection) => {
      expect((await connection.query('SELECT * FROM turnstile.user_access')).rows).toHaveLength(1);
    });
    await withTenant(runtime, randomUUID(), async (connection) => {
      expect((await connection.query('SELECT * FROM turnstile.user_access')).rows).toHaveLength(0);
    });
    await expect(
      withTenant(runtime, tenantId, (connection) =>
        connection.query('UPDATE turnstile.user_access SET enabled = true'),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(runtime.query('DELETE FROM turnstile.installation')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      runtime.query('ALTER TABLE turnstile.session DISABLE ROW LEVEL SECURITY'),
    ).rejects.toMatchObject({ code: '42501' });
    expect((await runtime.query('SELECT * FROM turnstile.user_access')).rows).toHaveLength(0);
  });
});
