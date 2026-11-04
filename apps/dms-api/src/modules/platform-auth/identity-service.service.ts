import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  IDENTITY_SERVICE_SCOPES,
  type IdentityPreparation,
  type IdentityPreparationRequest,
  type IdentityProjectionRequest,
  type IdentitySetupComplete,
  identityPreparationSchema,
  identityProjectionResponseSchema,
} from '@thaarei/dms-contracts';
import { createLocalJWKSet, decodeProtectedHeader, type JWTPayload, jwtVerify } from 'jose';
import type { PoolClient } from 'pg';
import { withTenant } from '../../infrastructure/database/postgres.js';
import { AuthorityService } from './authority/authority.service.js';
import { clientApproval } from './oauth-policy.js';

export class IdentityServiceError extends Error {
  constructor(
    readonly code:
      | 'IDENTITY_SERVICE_INVALID'
      | 'IDENTITY_SERVICE_IDENTITY_REQUIRED'
      | 'IDENTITY_SERVICE_DENIED'
      | 'CSRF_REJECTED'
      | 'IDENTITY_SERVICE_NOT_FOUND'
      | 'IDENTITY_SERVICE_CONFLICT'
      | 'IDENTITY_SETUP_UNAVAILABLE'
      | 'IDENTITY_SERVICE_RATE_LIMITED'
      | 'IDENTITY_SERVICE_UNAVAILABLE',
  ) {
    super(code);
  }
}
const fail = (code: IdentityServiceError['code']): never => {
  throw new IdentityServiceError(code);
};
function creationConflict(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4; depth++) {
    if (!current || typeof current !== 'object') return false;
    if ('code' in current && current.code === '23505') return true;
    if (
      'body' in current &&
      current.body &&
      typeof current.body === 'object' &&
      'code' in current.body &&
      current.body.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'
    )
      return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const opaque = () => randomBytes(32).toString('base64url');
type Principal = { clientId: string; applicationId: string; scopes: string[] };
type Preparation = {
  tenant_id: string;
  application_id: string;
  client_id: string;
  id: string;
  invitation_id: string;
  generation: number;
  email: string;
  request_hash: string;
  receipt_hash: string;
  sealed_receipt: string;
  exchanged_at: Date | null;
  expires_at: Date;
  retained_until: Date;
  user_id: string | null;
};
type Account = {
  id: string;
  email_verified: boolean;
  banned: boolean | null;
  ban_expires: Date | null;
};
const blocked = (user: Account) =>
  user.banned && (!user.ban_expires || user.ban_expires.getTime() > Date.now());

@Injectable()
export class IdentityServiceService {
  constructor(private readonly authority: AuthorityService) {}
  private configuration() {
    const config = this.authority.config;
    if (
      !config?.IDENTITY_SERVICE_CLIENT_ID ||
      !config.IDENTITY_SERVICE_RESOURCE_URL ||
      !this.authority.pool ||
      !this.authority.auth
    )
      return fail('IDENTITY_SERVICE_UNAVAILABLE');
    return {
      ...config,
      IDENTITY_SERVICE_CLIENT_ID: config.IDENTITY_SERVICE_CLIENT_ID,
      IDENTITY_SERVICE_RESOURCE_URL: config.IDENTITY_SERVICE_RESOURCE_URL,
      pool: this.authority.pool,
      auth: this.authority.auth,
    };
  }
  get cookie() {
    const secure = this.configuration().AUTH_PUBLIC_ORIGIN.startsWith('https:');
    return { name: secure ? '__Host-identity-setup' : 'identity-setup', secure };
  }
  get origin() {
    return this.configuration().AUTH_PUBLIC_ORIGIN;
  }
  async ensureReady() {
    if (!(await this.authority.ready())) return fail('IDENTITY_SERVICE_UNAVAILABLE');
    const result = await this.configuration().pool.query<{ safe: boolean }>(
      `SELECT count(*)=6 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='thaarei_auth_migrator' AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND NOT has_table_privilege(current_user,c.oid,'TRUNCATE') AND (c.relname<>'identity_audit' OR (NOT has_table_privilege(current_user,c.oid,'DELETE') AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE')))) AS safe FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relname=ANY($1)`,
      [
        [
          'identity_epoch',
          'identity_preparation',
          'identity_setup',
          'identity_subject',
          'identity_limit',
          'identity_audit',
        ],
      ],
    );
    if (!result.rows[0]?.safe) return fail('IDENTITY_SERVICE_UNAVAILABLE');
  }
  private key() {
    return createHash('sha256')
      .update(`identity-receipt:v1:${this.configuration().AUTH_SECRET}`)
      .digest();
  }
  private seal(value: string, binding: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    cipher.setAAD(Buffer.from(binding));
    return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]).toString(
      'base64url',
    );
  }
  private unseal(value: string, binding: string) {
    const bytes = Buffer.from(value, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', this.key(), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(binding));
    decipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString();
  }
  csrf(cookie: string) {
    return createHmac('sha256', this.key()).update(`csrf:${cookie}`).digest('base64url');
  }
  checkCsrf(cookie: string, value: unknown) {
    const expected = Buffer.from(this.csrf(cookie));
    const supplied = Buffer.from(typeof value === 'string' ? value : '');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
      fail('CSRF_REJECTED');
  }
  private async transaction<T>(work: (db: PoolClient) => Promise<T>) {
    const config = this.configuration();
    return withTenant(this.configuration().pool, config.INSTALLATION_TENANT_ID, work);
  }
  private async live(
    db: PoolClient,
    scope: string,
    clientId: string,
    scopes?: string[],
  ): Promise<Principal> {
    const config = this.configuration();
    // Client row lock orders feature operations with suspension/scope changes in the provider.
    const { rows } = await db.query<{
      client_id: string;
      metadata: unknown;
      reference_id: string;
      disabled: boolean;
      grant_types: string[];
      scopes: string[];
      client_credentials_scopes: string[];
      redirect_uris: string[];
      token_endpoint_auth_method: string;
    }>('SELECT * FROM auth.oauth_client WHERE client_id=$1 FOR UPDATE', [clientId]);
    const row = rows[0];
    let metadata: unknown = row?.metadata;
    if (typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata);
      } catch {
        return fail('IDENTITY_SERVICE_DENIED');
      }
    }
    const approval = clientApproval.safeParse(
      (metadata as { thaarei?: unknown } | undefined)?.thaarei,
    );
    if (
      !row ||
      !approval.success ||
      row.disabled ||
      clientId !== config.IDENTITY_SERVICE_CLIENT_ID ||
      row.reference_id !== config.INSTALLATION_TENANT_ID ||
      approval.data.kind !== 'identity_service' ||
      approval.data.tenantId !== config.INSTALLATION_TENANT_ID ||
      approval.data.resource !== config.IDENTITY_SERVICE_RESOURCE_URL ||
      row.token_endpoint_auth_method !== 'client_secret_basic' ||
      row.grant_types?.length !== 1 ||
      row.grant_types[0] !== 'client_credentials' ||
      row.redirect_uris?.length ||
      !row.scopes?.includes(scope) ||
      !row.client_credentials_scopes?.includes(scope) ||
      (scopes && !scopes.includes(scope)) ||
      row.scopes.some((s) => !(IDENTITY_SERVICE_SCOPES as readonly string[]).includes(s))
    )
      return fail('IDENTITY_SERVICE_DENIED');
    const resource = await db.query<{ safe: boolean }>(
      `SELECT NOT r.disabled AND r.signing_algorithm='RS256' AND r.access_token_ttl BETWEEN 1 AND 300 AND $3=ANY(r.allowed_scopes) AS safe FROM auth.oauth_resource r JOIN auth.oauth_client_resource cr ON cr.resource_id=r.identifier WHERE cr.client_id=$1 AND r.identifier=$2 FOR SHARE OF r,cr`,
      [clientId, config.IDENTITY_SERVICE_RESOURCE_URL, scope],
    );
    if (!resource.rows[0]?.safe) return fail('IDENTITY_SERVICE_DENIED');
    return { clientId, applicationId: approval.data.applicationId, scopes: scopes ?? [scope] };
  }
  async authenticate(
    header: unknown,
    scope: (typeof IDENTITY_SERVICE_SCOPES)[number],
  ): Promise<Principal> {
    const config = this.configuration();
    if (typeof header !== 'string' || !/^Bearer [A-Za-z0-9_.-]{1,8192}$/.test(header))
      return fail('IDENTITY_SERVICE_IDENTITY_REQUIRED');
    const token = header.slice(7);
    const keys = createLocalJWKSet(await this.configuration().auth.api.getJwks());
    let claims: JWTPayload;
    try {
      const h = decodeProtectedHeader(token);
      if (
        h.alg !== 'RS256' ||
        h.typ !== 'at+jwt' ||
        typeof h.kid !== 'string' ||
        !h.kid ||
        h.kid.length > 128 ||
        h.jwk ||
        h.jku ||
        h.x5u
      )
        return fail('IDENTITY_SERVICE_IDENTITY_REQUIRED');
      claims = (
        await jwtVerify(token, keys, {
          issuer: config.AUTH_ISSUER_URL,
          audience: config.IDENTITY_SERVICE_RESOURCE_URL,
          algorithms: ['RS256'],
          typ: 'at+jwt',
          maxTokenAge: 300,
          requiredClaims: ['exp', 'iat', 'jti', 'sub', 'client_id'],
        })
      ).payload;
      if (
        claims.client_id !== config.IDENTITY_SERVICE_CLIENT_ID ||
        claims.sub !== claims.client_id ||
        (claims.azp !== undefined && claims.azp !== claims.client_id) ||
        'sid' in claims ||
        'cnf' in claims ||
        claims.aud !== config.IDENTITY_SERVICE_RESOURCE_URL ||
        typeof claims.exp !== 'number' ||
        typeof claims.iat !== 'number' ||
        claims.exp <= claims.iat ||
        claims.exp - claims.iat > 300 ||
        typeof claims.jti !== 'string' ||
        !claims.jti ||
        typeof claims.scope !== 'string'
      )
        return fail('IDENTITY_SERVICE_IDENTITY_REQUIRED');
    } catch {
      return fail('IDENTITY_SERVICE_IDENTITY_REQUIRED');
    }
    const scopes = claims.scope.split(' ');
    if (
      !scopes.length ||
      new Set(scopes).size !== scopes.length ||
      scopes.some((s) => !(IDENTITY_SERVICE_SCOPES as readonly string[]).includes(s))
    )
      return fail('IDENTITY_SERVICE_DENIED');
    return this.transaction((db) =>
      this.live(db, scope, config.IDENTITY_SERVICE_CLIENT_ID, scopes),
    );
  }
  private async limit(db: PoolClient, key: string, maximum: number, seconds = 60) {
    const config = this.configuration();
    const window = new Date(Math.floor(Date.now() / (seconds * 1000)) * seconds * 1000);
    const { rows } = await db.query<{ count: number }>(
      `INSERT INTO auth.identity_limit (tenant_id,key,"window",count) VALUES ($1,$2,$3,1) ON CONFLICT (tenant_id,key,"window") DO UPDATE SET count=auth.identity_limit.count+1 RETURNING count`,
      [config.INSTALLATION_TENANT_ID, key, window],
    );
    if ((rows[0]?.count ?? fail('IDENTITY_SERVICE_UNAVAILABLE')) > maximum) return false;
    return true;
  }
  async rate(key: string, maximum = 60) {
    // Committed independently so rejected work still counts. Keys contain no raw IP or credential.
    const allowed = await this.transaction(async (db) => {
      await db.query(
        `DELETE FROM auth.identity_limit WHERE tenant_id=$1 AND "window" < now()-interval '2 hours'`,
        [this.configuration().INSTALLATION_TENANT_ID],
      );
      return this.limit(db, digest(key), maximum);
    });
    if (!allowed) fail('IDENTITY_SERVICE_RATE_LIMITED');
  }
  private bound(principal: Principal, input: { tenantId: string; applicationId: string }) {
    if (
      input.tenantId !== this.configuration().INSTALLATION_TENANT_ID ||
      input.applicationId !== principal.applicationId
    )
      fail('IDENTITY_SERVICE_DENIED');
  }
  private async audit(
    db: PoolClient,
    p: Principal,
    action: string,
    operationId: string | null = null,
  ) {
    const count = await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM auth.identity_audit WHERE tenant_id=$1',
      [this.configuration().INSTALLATION_TENANT_ID],
    );
    if ((count.rows[0]?.count ?? fail('IDENTITY_SERVICE_UNAVAILABLE')) >= 100000)
      return fail('IDENTITY_SERVICE_UNAVAILABLE');
    await db.query(
      'INSERT INTO auth.identity_audit (tenant_id,application_id,client_id,id,action,operation_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,now())',
      [
        this.configuration().INSTALLATION_TENANT_ID,
        p.applicationId,
        p.clientId,
        randomUUID(),
        action,
        operationId,
      ],
    );
  }
  private async account(db: PoolClient, email: string) {
    return (
      await db.query<Account>(
        'SELECT id,email_verified,banned,ban_expires FROM auth."user" WHERE email=$1',
        [email],
      )
    ).rows[0];
  }
  private async load(db: PoolClient, p: Principal, id: string) {
    const { rows } = await db.query<Preparation>(
      'SELECT * FROM auth.identity_preparation WHERE tenant_id=$1 AND application_id=$2 AND client_id=$3 AND id=$4 FOR UPDATE',
      [this.configuration().INSTALLATION_TENANT_ID, p.applicationId, p.clientId, id],
    );
    if (!rows[0]) return fail('IDENTITY_SERVICE_NOT_FOUND');
    return rows[0];
  }
  private async current(db: PoolClient, row: Preparation) {
    const { rows } = await db.query<{ generation: number }>(
      'SELECT generation FROM auth.identity_epoch WHERE tenant_id=$1 AND application_id=$2 AND client_id=$3 AND invitation_id=$4',
      [row.tenant_id, row.application_id, row.client_id, row.invitation_id],
    );
    return rows[0]?.generation === row.generation && row.retained_until.getTime() > Date.now();
  }
  private async projectPreparation(db: PoolClient, row: Preparation): Promise<IdentityPreparation> {
    const base = {
      tenantId: row.tenant_id,
      applicationId: row.application_id,
      id: row.id,
      operationId: row.id,
      invitationId: row.invitation_id,
      generation: row.generation,
    };
    if (!(await this.current(db, row))) return { ...base, state: 'unavailable' };
    const user = row.user_id
      ? (
          await db.query<Account>(
            'SELECT id,email_verified,banned,ban_expires FROM auth."user" WHERE id=$1',
            [row.user_id],
          )
        ).rows[0]
      : await this.account(db, row.email);
    if (user && !blocked(user)) {
      if (!row.user_id)
        await db.query(
          'UPDATE auth.identity_preparation SET user_id=$1 WHERE tenant_id=$2 AND application_id=$3 AND client_id=$4 AND id=$5',
          [user.id, row.tenant_id, row.application_id, row.client_id, row.id],
        );
      return { ...base, state: 'completed', userId: user.id, emailVerified: user.email_verified };
    }
    if (user || row.user_id || row.exchanged_at || row.expires_at.getTime() <= Date.now())
      return { ...base, state: 'unavailable' };
    return {
      ...base,
      state: 'authorized',
      expiresAt: row.expires_at.toISOString(),
      setupReceipt: this.unseal(
        row.sealed_receipt,
        `${row.client_id}:${row.application_id}:${row.id}`,
      ),
    };
  }
  async prepare(p: Principal, input: IdentityPreparationRequest) {
    this.bound(p, input);
    return this.transaction(async (db) => {
      await this.live(db, IDENTITY_SERVICE_SCOPES[0], p.clientId, p.scopes);
      // One installation lock bounds retained receipt/session counts across all service clients.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `identity:${input.tenantId}`,
      ]);
      await db.query(
        'DELETE FROM auth.identity_preparation WHERE tenant_id=$1 AND retained_until<=now()',
        [input.tenantId],
      );
      await db.query(
        'DELETE FROM auth.identity_epoch e WHERE tenant_id=$1 AND expires_at<=now() AND NOT EXISTS (SELECT 1 FROM auth.identity_preparation p WHERE p.tenant_id=e.tenant_id AND p.application_id=e.application_id AND p.client_id=e.client_id AND p.invitation_id=e.invitation_id)',
        [input.tenantId],
      );
      const existing = await db.query<Preparation>(
        'SELECT * FROM auth.identity_preparation WHERE tenant_id=$1 AND application_id=$2 AND client_id=$3 AND id=$4',
        [input.tenantId, input.applicationId, p.clientId, input.operationId],
      );
      const requestHash = digest(JSON.stringify(input));
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== requestHash) return fail('IDENTITY_SERVICE_CONFLICT');
        return this.projectPreparation(db, existing.rows[0]);
      }
      const expiry = Date.parse(input.expiresAt);
      if (expiry <= Date.now() || expiry > Date.now() + 7 * 86400000)
        return fail('IDENTITY_SERVICE_INVALID');
      const count = await db.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM auth.identity_preparation WHERE tenant_id=$1',
        [input.tenantId],
      );
      if ((count.rows[0]?.count ?? fail('IDENTITY_SERVICE_UNAVAILABLE')) >= 10000)
        return fail('IDENTITY_SERVICE_UNAVAILABLE');
      const epoch = (
        await db.query<{ generation: number; email: string }>(
          'SELECT generation,email FROM auth.identity_epoch WHERE tenant_id=$1 AND application_id=$2 AND client_id=$3 AND invitation_id=$4',
          [input.tenantId, input.applicationId, p.clientId, input.invitationId],
        )
      ).rows[0];
      if (
        epoch &&
        (epoch.generation > input.generation ||
          (epoch.generation === input.generation && epoch.email !== input.email))
      )
        return fail('IDENTITY_SERVICE_CONFLICT');
      await db.query(
        'INSERT INTO auth.identity_epoch (tenant_id,application_id,client_id,invitation_id,generation,email,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id,application_id,client_id,invitation_id) DO UPDATE SET generation=EXCLUDED.generation,email=EXCLUDED.email,expires_at=EXCLUDED.expires_at',
        [
          input.tenantId,
          input.applicationId,
          p.clientId,
          input.invitationId,
          input.generation,
          input.email,
          input.expiresAt,
        ],
      );
      const receipt = opaque();
      const expiresAt = new Date(Math.min(expiry, Date.now() + 1800000));
      await db.query(
        'INSERT INTO auth.identity_preparation (tenant_id,application_id,client_id,id,invitation_id,generation,email,request_hash,receipt_hash,sealed_receipt,expires_at,retained_until) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          input.tenantId,
          input.applicationId,
          p.clientId,
          input.operationId,
          input.invitationId,
          input.generation,
          input.email,
          requestHash,
          digest(receipt),
          this.seal(receipt, `${p.clientId}:${input.applicationId}:${input.operationId}`),
          expiresAt,
          new Date(Date.now() + 86400000),
        ],
      );
      await this.audit(db, p, 'prepare', input.operationId);
      return identityPreparationSchema.parse(
        await this.projectPreparation(db, await this.load(db, p, input.operationId)),
      );
    });
  }
  async preparation(p: Principal, id: string) {
    return this.transaction(async (db) => {
      await this.live(db, IDENTITY_SERVICE_SCOPES[0], p.clientId, p.scopes);
      return this.projectPreparation(db, await this.load(db, p, id));
    });
  }
  async project(p: Principal, input: IdentityProjectionRequest) {
    this.bound(p, input);
    return this.transaction(async (db) => {
      await this.live(db, IDENTITY_SERVICE_SCOPES[1], p.clientId, p.scopes);
      const config = this.configuration();
      const count = await db.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM auth.identity_subject WHERE tenant_id=$1 AND client_id=$2',
        [config.INSTALLATION_TENANT_ID, p.clientId],
      );
      if ((count.rows[0]?.count ?? fail('IDENTITY_SERVICE_UNAVAILABLE')) > 10000)
        return fail('IDENTITY_SERVICE_UNAVAILABLE');
      let linkedCount = count.rows[0]?.count ?? fail('IDENTITY_SERVICE_UNAVAILABLE');
      const checkedAt = new Date().toISOString();
      const subjects = [];
      for (const assertion of input.subjects) {
        const binding = [
          config.INSTALLATION_TENANT_ID,
          p.applicationId,
          p.clientId,
          assertion.memberId,
        ];
        const old = (
          await db.query<{ user_id: string; member_version: number }>(
            'SELECT user_id,member_version FROM auth.identity_subject WHERE tenant_id=$1 AND application_id=$2 AND client_id=$3 AND member_id=$4',
            binding,
          )
        ).rows[0];
        const other = (
          await db.query<{ member_id: string }>(
            'SELECT member_id FROM auth.identity_subject WHERE tenant_id=$1 AND application_id=$2 AND client_id=$3 AND user_id=$4',
            [...binding.slice(0, 3), assertion.userId],
          )
        ).rows[0];
        if (
          (old &&
            (old.user_id !== assertion.userId || old.member_version > assertion.memberVersion)) ||
          (other && other.member_id !== assertion.memberId)
        )
          return fail('IDENTITY_SERVICE_CONFLICT');
        if (!old && ++linkedCount > 10000) return fail('IDENTITY_SERVICE_UNAVAILABLE');
        await db.query(
          'INSERT INTO auth.identity_subject (tenant_id,application_id,client_id,member_id,user_id,member_version) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id,application_id,client_id,member_id) DO UPDATE SET member_version=EXCLUDED.member_version',
          [...binding, assertion.userId, assertion.memberVersion],
        );
        const user = (
          await db.query<{ id: string; name: string; email: string; email_verified: boolean }>(
            'SELECT id,name,email,email_verified FROM auth."user" WHERE id=$1',
            [assertion.userId],
          )
        ).rows[0];
        subjects.push(
          user
            ? {
                userId: user.id,
                state: 'present' as const,
                name: user.name,
                email: user.email,
                emailVerified: user.email_verified,
                checkedAt,
              }
            : { userId: assertion.userId, state: 'deleted' as const, checkedAt },
        );
      }
      await this.audit(db, p, 'project');
      return identityProjectionResponseSchema.parse({ subjects });
    });
  }
  private async session(db: PoolClient, cookie: string) {
    const config = this.configuration();
    const session = (
      await db.query<{ preparation_id: string; application_id: string; expires_at: Date }>(
        'SELECT preparation_id,application_id,expires_at FROM auth.identity_setup WHERE tenant_id=$1 AND client_id=$2 AND digest=$3',
        [config.INSTALLATION_TENANT_ID, config.IDENTITY_SERVICE_CLIENT_ID, digest(cookie)],
      )
    ).rows[0];
    if (!session || session.expires_at.getTime() <= Date.now())
      return fail('IDENTITY_SETUP_UNAVAILABLE');
    const p = await this.live(db, IDENTITY_SERVICE_SCOPES[0], config.IDENTITY_SERVICE_CLIENT_ID);
    if (p.applicationId !== session.application_id) return fail('IDENTITY_SETUP_UNAVAILABLE');
    const row = await this.load(db, p, session.preparation_id);
    if (!(await this.current(db, row)) || row.expires_at.getTime() <= Date.now())
      return fail('IDENTITY_SETUP_UNAVAILABLE');
    return { p, row };
  }
  private async contextValue(db: PoolClient, row: Preparation, cookie: string) {
    const user = row.user_id
      ? (
          await db.query<Account>(
            'SELECT id,email_verified,banned,ban_expires FROM auth."user" WHERE id=$1',
            [row.user_id],
          )
        ).rows[0]
      : await this.account(db, row.email);
    if (user || row.user_id)
      return {
        phase: 'continue' as const,
        csrfToken: this.csrf(cookie),
        destination: '/sign-in' as const,
      };
    return {
      phase: 'ready' as const,
      csrfToken: this.csrf(cookie),
      expiresAt: row.expires_at.toISOString(),
    };
  }
  async exchange(receipt: string) {
    const cookie = opaque();
    const value = await this.transaction(async (db) => {
      const config = this.configuration();
      const p = await this.live(db, IDENTITY_SERVICE_SCOPES[0], config.IDENTITY_SERVICE_CLIENT_ID);
      await db.query('DELETE FROM auth.identity_setup WHERE tenant_id=$1 AND expires_at<=now()', [
        config.INSTALLATION_TENANT_ID,
      ]);
      const candidate = (
        await db.query<{ id: string }>(
          'SELECT id FROM auth.identity_preparation WHERE tenant_id=$1 AND application_id=$2 AND client_id=$3 AND receipt_hash=$4',
          [config.INSTALLATION_TENANT_ID, p.applicationId, p.clientId, digest(receipt)],
        )
      ).rows[0];
      if (!candidate) return fail('IDENTITY_SETUP_UNAVAILABLE');
      const row = await this.load(db, p, candidate.id);
      if (!(await this.current(db, row)) || row.expires_at.getTime() <= Date.now())
        return fail('IDENTITY_SETUP_UNAVAILABLE');
      if (row.exchanged_at) return fail('IDENTITY_SETUP_UNAVAILABLE');
      await db.query(
        'UPDATE auth.identity_preparation SET exchanged_at=now() WHERE tenant_id=$1 AND application_id=$2 AND client_id=$3 AND id=$4',
        [row.tenant_id, row.application_id, row.client_id, row.id],
      );
      const count = await db.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM auth.identity_setup WHERE tenant_id=$1',
        [config.INSTALLATION_TENANT_ID],
      );
      if ((count.rows[0]?.count ?? fail('IDENTITY_SERVICE_UNAVAILABLE')) >= 2000)
        return fail('IDENTITY_SERVICE_UNAVAILABLE');
      await db.query(
        'INSERT INTO auth.identity_setup (tenant_id,application_id,client_id,digest,preparation_id,expires_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [
          config.INSTALLATION_TENANT_ID,
          p.applicationId,
          p.clientId,
          digest(cookie),
          row.id,
          row.expires_at,
        ],
      );
      return this.contextValue(db, row, cookie);
    });
    return { cookie, value };
  }
  async context(cookie: string) {
    return this.transaction(async (db) =>
      this.contextValue(db, (await this.session(db, cookie)).row, cookie),
    );
  }
  async cancel(cookie: string) {
    await this.transaction(async (db) => {
      const { p, row } = await this.session(db, cookie);
      await db.query('DELETE FROM auth.identity_setup WHERE tenant_id=$1 AND digest=$2', [
        row.tenant_id,
        digest(cookie),
      ]);
      await this.audit(db, p, 'cancel', row.id);
    });
    return { state: 'continue' as const, destination: '/sign-in' as const };
  }
  async complete(cookie: string, input: IdentitySetupComplete) {
    const create = (allowCreation = true) =>
      this.transaction(async (db) => {
        const { p, row } = await this.session(db, cookie);
        if (row.user_id) return { email: undefined };
        let user = await this.account(db, row.email);
        let created = false;
        if (!user) {
          if (!allowCreation) return fail('IDENTITY_SERVICE_UNAVAILABLE');
          // Supported provider API hashes/links credentials on this exact transaction connection.
          const bound = this.authority.transactionAuth(db);
          const account = await bound.api.createUser({
            body: { email: row.email, name: input.name, password: input.password, role: 'user' },
          });
          user = { id: account.user.id, email_verified: false, banned: false, ban_expires: null };
          created = true;
        }
        if (blocked(user)) return { email: undefined };
        await db.query(
          'UPDATE auth.identity_preparation SET user_id=$1 WHERE tenant_id=$2 AND application_id=$3 AND client_id=$4 AND id=$5',
          [user.id, row.tenant_id, row.application_id, row.client_id, row.id],
        );
        await this.audit(db, p, 'complete', row.id);
        return { email: created ? row.email : undefined };
      });
    let result: { email: string | undefined };
    try {
      result = await create();
    } catch (error) {
      if (!creationConflict(error)) throw error;
      // A separate private authority creator may race this service's lock. Reconcile once
      // in a fresh transaction; a disappearing collision never permits a second creation.
      result = await create(false);
    }
    // Mail is outside the account/receipt transaction. A failed response is reconciled by receipt;
    // repeated completion never creates another credential or implicitly resends verification.
    if (result.email) await this.authority.sendInvitationVerification(result.email);
    return { state: 'continue' as const, destination: '/sign-in' as const };
  }
}
