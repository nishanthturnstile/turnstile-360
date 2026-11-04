// Owning authority fixture. The product process sees HTTP and explicit private fixture IPC only.
import { randomBytes } from 'node:crypto';
import { createLocalJWKSet, decodeJwt, jwtVerify } from 'jose';
import { Pool } from 'pg';
import { createApplication } from '../dist/bootstrap.js';
import { withTenant } from '../dist/infrastructure/database/postgres.js';
import { AuthorityService } from '../dist/modules/platform-auth/authority/authority.service.js';
import { manageOAuthClient } from '../dist/modules/platform-auth/manage-client.js';
import { pruneIdentity } from '../dist/modules/platform-auth/prune-identity.js';
import { smtpFixture } from './smtp-fixture.ts';

const smtp = await smtpFixture();
process.env.AUTH_SMTP_PORT = String(smtp.port);
const namespace = process.env.IDENTITY_FIXTURE_NAMESPACE ?? 'identity';
process.env.IDENTITY_SERVICE_CLIENT_ID = `${namespace}-fixture-service`;
process.env.IDENTITY_SERVICE_RESOURCE_URL = `${process.env.AUTH_PUBLIC_ORIGIN}/identity/services/accounts`;
const owner = new Pool({ connectionString: process.env.AUTH_MIGRATION_DATABASE_URL });
const app = await createApplication(false);
await app.init();
const authority = app.get(AuthorityService);
const { auth, config } = authority;
const password = randomBytes(24).toString('base64url');
const users = {};
for (const [label, role, verified, credential] of [
  ['operator', 'admin', true, true],
  ['verified', 'user', true, true],
  ['unverified', 'user', false, true],
  ['passwordless', 'user', false, false],
  ['banned', 'user', true, true],
]) {
  const email = `${namespace}-${label}@example.test`;
  const { user } = await auth.api.createUser({
    body: { email, name: label, role, ...(credential ? { password } : {}) },
  });
  if (verified) {
    await authority.sendInvitationVerification(email);
    const link = smtp.link('verify');
    const response = await app.inject({ method: 'GET', url: link.pathname + link.search });
    if (response.statusCode !== 302) throw new Error('Fixture verification failed');
  }
  users[label] = { id: user.id, email };
}
const login = await auth.api.signInEmail({
  body: { email: users.operator.email, password },
  returnHeaders: true,
});
const operator = new Headers({
  origin: config.AUTH_PUBLIC_ORIGIN,
  cookie: login.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; '),
});
await auth.api.banUser({ headers: operator, body: { userId: users.banned.id } });
const service = await manageOAuthClient(auth, config, operator, {
  kind: 'identity_service',
  action: 'issue',
  applicationId: process.env.TURNSTILE_APPLICATION_ID,
  scopes: ['identity:invitation:prepare', 'identity:subjects:read'],
});
const machine = await manageOAuthClient(auth, config, operator, {
  kind: 'machine',
  action: 'issue',
  clientId: `${namespace}-fixture-machine`,
  applicationId: process.env.TURNSTILE_APPLICATION_ID,
  scopes: ['dms:capabilities:read'],
});
const browserLogin =
  process.env.IDENTITY_FIXTURE_LOGIN === 'true'
    ? await manageOAuthClient(auth, config, operator, {
        kind: 'login',
        action: 'issue',
        applicationId: process.env.TURNSTILE_APPLICATION_ID,
      })
    : undefined;
await app.listen(0, '127.0.0.1');
process.send?.({
  ready: true,
  port: app.getHttpAdapter().getInstance().server.address().port,
  secret: service.secret,
  machineSecret: machine.secret,
  users,
  password,
  loginSecret: browserLogin?.secret,
  operatorCookie: operator.get('cookie'),
});
process.on('message', async (message) => {
  try {
    let value;
    if (message.action === 'check-token') {
      // Private fixture diagnostics expose numeric timings and finite verification codes only.
      const claims = decodeJwt(message.token);
      let verification = 'VALID';
      try {
        await jwtVerify(message.token, createLocalJWKSet(await auth.api.getJwks()), {
          issuer: config.AUTH_ISSUER_URL,
          audience: process.env.IDENTITY_SERVICE_RESOURCE_URL,
          algorithms: ['RS256'],
          typ: 'at+jwt',
          maxTokenAge: 300,
          requiredClaims: ['exp', 'iat', 'jti', 'sub', 'client_id'],
        });
      } catch (error) {
        verification = typeof error.code === 'string' ? error.code : 'UNCLASSIFIED';
      }
      value = {
        verification,
        lifetimeSeconds: claims.exp - claims.iat,
        ageSeconds: Math.floor(Date.now() / 1000) - claims.iat,
        clientMatches: claims.client_id === config.IDENTITY_SERVICE_CLIENT_ID,
        subjectMatches: claims.sub === claims.client_id,
      };
    } else if (message.action === 'clear-limits') {
      await owner.query('DELETE FROM auth.rate_limit');
      await withTenant(owner, config.INSTALLATION_TENANT_ID, (db) =>
        db.query('DELETE FROM auth.identity_limit'),
      );
    } else if (message.action === 'reset-member-projections') {
      // Pair the disposable product fixture reset with its owning authority assertions.
      await withTenant(owner, config.INSTALLATION_TENANT_ID, (db) =>
        db.query('DELETE FROM auth.identity_subject WHERE tenant_id=$1 AND client_id=$2', [
          config.INSTALLATION_TENANT_ID,
          config.IDENTITY_SERVICE_CLIENT_ID,
        ]),
      );
    } else if (message.action === 'ban-user') {
      await auth.api.banUser({ headers: operator, body: { userId: message.id } });
    } else if (['suspend', 'resume', 'set-scopes'].includes(message.action))
      await manageOAuthClient(auth, config, operator, {
        kind: 'identity_service',
        action: message.action,
        ...(message.action === 'set-scopes' ? { scopes: message.scopes } : {}),
      });
    else if (message.action === 'reject-mail') smtp.rejectNextDelivery();
    else if (message.action === 'verification') {
      const link = smtp.link('verify');
      value = {
        path: link.pathname + link.search,
        callback: link.searchParams.get('callbackURL'),
        messages: smtp.messages.length,
      };
    } else if (message.action === 'change-email') {
      await owner.query('UPDATE auth."user" SET email=$2,email_verified=true WHERE id=$1', [
        message.id,
        message.email,
      ]);
    } else if (message.action === 'recovery') {
      const link = smtp.link('reset');
      value = { path: link.pathname + link.search };
    } else if (message.action === 'account') {
      const row = (
        await owner.query(
          'SELECT id,name,email_verified,role,banned FROM auth."user" WHERE email=$1',
          [message.email],
        )
      ).rows[0];
      const credentials = row
        ? (
            await owner.query(
              "SELECT count(*)::int AS count,bool_and(password IS NOT NULL AND password<>$2 AND password<>$3) AS hashed FROM auth.account WHERE user_id=$1 AND provider_id='credential'",
              [row.id, password, message.plaintext ?? password],
            )
          ).rows[0]
        : undefined;
      value = {
        user: row ?? null,
        credentials: credentials ?? null,
        messages: smtp.messages.length,
      };
    } else if (message.action === 'expire')
      await withTenant(owner, config.INSTALLATION_TENANT_ID, (db) =>
        db.query(
          "UPDATE auth.identity_preparation SET expires_at=now()-interval '1 second' WHERE id=$1",
          [message.id],
        ),
      );
    else if (message.action === 'prune') value = await pruneIdentity();
    else if (message.action === 'expire-retention')
      await withTenant(owner, config.INSTALLATION_TENANT_ID, (db) =>
        db.query(
          "UPDATE auth.identity_preparation SET retained_until=now()-interval '1 second' WHERE id=$1",
          [message.id],
        ),
      );
    else if (message.action === 'delete-user')
      await owner.query('DELETE FROM auth."user" WHERE id=$1', [message.id]);
    else if (message.action === 'create-race')
      value = (
        await auth.api.createUser({
          body: { email: message.email, name: 'Private creator', password, role: 'user' },
        })
      ).user.id;
    else if (message.action === 'rls') {
      value = (
        await authority.pool.query('SELECT count(*)::int AS count FROM auth.identity_preparation')
      ).rows[0].count;
    } else if (message.action === 'fail-complete-audit') {
      await owner.query(
        `CREATE FUNCTION auth.identity_fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='complete' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$`,
      );
      await owner.query(
        'CREATE TRIGGER identity_fixture_failure BEFORE INSERT ON auth.identity_audit FOR EACH ROW EXECUTE FUNCTION auth.identity_fixture_failure()',
      );
    } else if (message.action === 'allow-complete-audit') {
      await owner.query('DROP TRIGGER IF EXISTS identity_fixture_failure ON auth.identity_audit');
      await owner.query('DROP FUNCTION IF EXISTS auth.identity_fixture_failure()');
    } else if (message.action === 'break-audit')
      await owner.query('REVOKE INSERT ON auth.identity_audit FROM thaarei_auth_runtime');
    else if (message.action === 'restore-audit')
      await owner.query('GRANT INSERT ON auth.identity_audit TO thaarei_auth_runtime');
    else if (message.action === 'allow-audit-update')
      await owner.query('GRANT UPDATE ON auth.identity_audit TO thaarei_auth_runtime');
    else if (message.action === 'allow-audit-column-update')
      await owner.query('GRANT UPDATE(action) ON auth.identity_audit TO thaarei_auth_runtime');
    else if (message.action === 'deny-audit-update') {
      await owner.query('REVOKE UPDATE ON auth.identity_audit FROM thaarei_auth_runtime');
      await owner.query('REVOKE UPDATE(action) ON auth.identity_audit FROM thaarei_auth_runtime');
    } else throw new Error('Unknown fixture operation');
    process.send?.({ requestId: message.requestId, ok: true, value });
  } catch {
    process.send?.({ requestId: message.requestId, ok: false });
  }
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  await owner.end();
  await smtp.close();
  process.disconnect?.();
}
process.on('disconnect', () => void close());
process.on('SIGTERM', () => void close());
