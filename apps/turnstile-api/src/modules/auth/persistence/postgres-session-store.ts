import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { SessionStore } from '@fastify/session';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from '../../../infrastructure/database/postgres.js';
import { generation } from '../browser-auth/bff-state.js';

type StoredSession = Parameters<SessionStore['set']>[1];
type Callback = Parameters<SessionStore['set']>[2];
type GetCallback = Parameters<SessionStore['get']>[1];

class SessionGoneError extends Error {
  readonly code = 'ENOENT';
}

// Compatible with the pinned plugin's atomic generation check; stale saves cannot undo logout.
export class PostgresSessionStore implements SessionStore {
  constructor(
    private readonly pool: Pool,
    private readonly tenantId: string,
    private readonly key: Buffer,
  ) {}

  private digest(id: string) {
    return createHash('sha256').update(id).digest('hex');
  }
  private aad(idHash: string) {
    return Buffer.from(`${this.tenantId}:${idHash}`);
  }
  private encode(idHash: string, value: StoredSession) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(this.aad(idHash));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
  }
  private decode(idHash: string, value: string): StoredSession {
    const [version, iv, tag, ciphertext, extra] = value.split('.');
    if (version !== 'v1' || !iv || !tag || !ciphertext || extra)
      throw new Error('Invalid session envelope');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(this.aad(idHash));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8'),
    ) as StoredSession;
  }
  private expires(session: StoredSession) {
    const expires = new Date(session.cookie.expires ?? 0).getTime();
    if (!Number.isFinite(expires) || expires <= Date.now())
      throw new Error('A bounded session expiry is required');
    return new Date(Math.min(expires, Date.now() + 8 * 60 * 60 * 1000));
  }
  private failure(callback: Callback, error: unknown) {
    if (error instanceof SessionGoneError) callback(error);
    else callback(new Error('Product session storage unavailable'));
  }
  private stale(): never {
    throw new SessionGoneError('Session no longer exists or changed');
  }

  set(id: string, session: StoredSession, callback: Callback) {
    const hash = this.digest(id);
    void withTenant(this.pool, this.tenantId, async (client) => {
      const result = await client.query(
        'INSERT INTO turnstile.session (id_hash, tenant_id, ciphertext, expires_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id_hash) DO NOTHING RETURNING id_hash',
        [hash, this.tenantId, this.encode(hash, session), this.expires(session)],
      );
      if (!result.rowCount) this.stale();
    }).then(
      () => callback(),
      (error: unknown) => this.failure(callback, error),
    );
  }

  get(id: string, callback: GetCallback) {
    const hash = this.digest(id);
    void withTenant(this.pool, this.tenantId, async (client) => {
      const { rows } = await client.query(
        'SELECT ciphertext FROM turnstile.session WHERE id_hash = $1 AND expires_at > now()',
        [hash],
      );
      if (rows[0]) return this.decode(hash, rows[0].ciphertext);
      await client.query(
        'DELETE FROM turnstile.session WHERE id_hash = $1 AND expires_at <= now()',
        [hash],
      );
      return null;
    }).then(
      (value) => callback(null, value),
      () => callback(new Error('Product session storage unavailable')),
    );
  }

  compareAndSet(
    id: string,
    expectedGeneration: string,
    session: StoredSession,
    callback: Callback,
  ) {
    const hash = this.digest(id);
    void withTenant(this.pool, this.tenantId, async (client) => {
      const { rows } = await client.query(
        'SELECT ciphertext FROM turnstile.session WHERE id_hash = $1 AND expires_at > now() FOR UPDATE',
        [hash],
      );
      if (!rows[0]) this.stale();
      const previous = this.decode(hash, rows[0].ciphertext);
      if (
        generation(previous, id) !== expectedGeneration ||
        (previous.bffRevision ?? 0) !== (session.bffRevision ?? 0)
      )
        this.stale();
      await client.query(
        'UPDATE turnstile.session SET ciphertext = $2, expires_at = $3 WHERE id_hash = $1',
        [hash, this.encode(hash, session), this.expires(session)],
      );
    }).then(
      () => callback(),
      (error: unknown) => this.failure(callback, error),
    );
  }

  // The callback is synchronous: no network I/O may run while holding this row lock.
  async atomic<T>(
    id: string,
    expectedGeneration: string,
    change: (session: StoredSession) => T,
  ): Promise<T | undefined> {
    const hash = this.digest(id);
    return withTenant(this.pool, this.tenantId, async (client) => {
      const { rows } = await client.query(
        'SELECT ciphertext FROM turnstile.session WHERE id_hash = $1 AND expires_at > now() FOR UPDATE',
        [hash],
      );
      if (!rows[0]) return undefined;
      const session = this.decode(hash, rows[0].ciphertext);
      if (generation(session, id) !== expectedGeneration) return undefined;
      const result = change(session);
      session.bffRevision = (session.bffRevision ?? 0) + 1;
      await client.query(
        'UPDATE turnstile.session SET ciphertext = $2, expires_at = $3 WHERE id_hash = $1',
        [hash, this.encode(hash, session), this.expires(session)],
      );
      return result;
    });
  }

  // Called after installation/access locking. The row remains locked through the
  // owning acceptance transaction, fencing concurrent callback, switch and logout.
  async invitationFence(
    client: PoolClient,
    id: string,
    expectedGeneration: string,
    continuationId: string,
    csrf: string,
    sid?: string,
  ) {
    const hash = this.digest(id);
    const row = (
      await client.query(
        'SELECT ciphertext FROM turnstile.session WHERE tenant_id=$1 AND id_hash=$2 AND expires_at>clock_timestamp() FOR UPDATE',
        [this.tenantId, hash],
      )
    ).rows[0];
    if (!row) return false;
    const session = this.decode(hash, row.ciphertext);
    const flow = session.invitation;
    return (
      generation(session, id) === expectedGeneration &&
      !!flow &&
      flow.id === continuationId &&
      flow.csrf === csrf &&
      flow.expiresAt > Date.now() &&
      (!sid || (flow.identity?.value.sid === sid && flow.identity.expiresAt > Date.now()))
    );
  }

  async markInvitationAccepted(
    client: PoolClient,
    id: string,
    expectedGeneration: string,
    continuationId: string,
  ) {
    const hash = this.digest(id);
    const row = (
      await client.query(
        'SELECT ciphertext FROM turnstile.session WHERE tenant_id=$1 AND id_hash=$2 FOR UPDATE',
        [this.tenantId, hash],
      )
    ).rows[0];
    if (!row) this.stale();
    const session = this.decode(hash, row.ciphertext);
    if (generation(session, id) !== expectedGeneration || session.invitation?.id !== continuationId)
      this.stale();
    session.invitation.accepted = true;
    session.bffRevision = (session.bffRevision ?? 0) + 1;
    await client.query(
      'UPDATE turnstile.session SET ciphertext=$2 WHERE tenant_id=$1 AND id_hash=$3',
      [this.tenantId, this.encode(hash, session), hash],
    );
  }

  destroy(id: string, callback: Callback) {
    void withTenant(this.pool, this.tenantId, async (client) => {
      await client.query('DELETE FROM turnstile.session WHERE id_hash = $1', [this.digest(id)]);
    }).then(
      () => callback(),
      (error: unknown) => this.failure(callback, error),
    );
  }
}
