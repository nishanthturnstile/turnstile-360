// Separate-process fixture: consumers use HTTP and private fixture IPC, never DMS imports.
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { createApplication } from '../dist/bootstrap.js';
import { withTenant } from '../dist/infrastructure/database/postgres.js';
import { SecurityTelemetryService } from '../dist/infrastructure/security-telemetry.service.js';
import {
  disableApplication,
  issueEnrollmentKey,
  registerApplication,
  setApplicationScopes,
} from '../dist/modules/enrollment/enrollment-operator.js';
import { AuthorityService } from '../dist/modules/platform-auth/authority/authority.service.js';
import { manageOAuthClient } from '../dist/modules/platform-auth/manage-client.js';
import { provisionUser } from '../dist/modules/platform-auth/provision-user.js';
import { smtpFixture } from './smtp-fixture.ts';

const smtp = process.env.AUTH_BROWSER_MAILPIT_URL
  ? {
      port: process.env.AUTH_SMTP_PORT,
      async link(purpose, email) {
        const base = process.env.AUTH_BROWSER_MAILPIT_URL;
        let message;
        for (let attempt = 0; attempt < 50 && !message; attempt++) {
          const list = await (await fetch(`${base}/api/v1/messages`)).json();
          message = list.messages.find(
            (value) =>
              value.Subject.includes(
                purpose === 'verify' ? 'Verify your account' : 'Reset your account',
              ) && value.To.some((recipient) => recipient.Address === email),
          );
          if (!message) await new Promise((done) => setTimeout(done, 100));
        }
        if (!message) throw new Error('Missing fixture mail');
        const detail = await (await fetch(`${base}/api/v1/message/${message.ID}`)).json();
        const link = detail.Text.match(/https?:\/\/[^\s]+/)?.[0];
        if (!link) throw new Error('Missing fixture link');
        return new URL(link);
      },
      async close() {},
    }
  : await smtpFixture();
if (process.env.AUTH_BROWSER_MAILPIT_URL)
  process.on('uncaughtException', (error) => {
    const candidate = error.body?.code ?? error.code;
    const code =
      typeof candidate === 'string' && /^[A-Z0-9_]{1,64}$/.test(candidate) ? candidate : 'UNKNOWN';
    process.send?.({ diagnostic: `${error.name} ${code}` });
    process.exit(1);
  });
process.env.AUTH_SMTP_PORT = String(smtp.port);
process.env.AUTH_LOGIN_CLIENT_ID = 'bff-fixture-login';
process.env.DMS_MACHINE_CLIENT_ID = 'bff-fixture-machine';
const owner = new Pool({ connectionString: process.env.AUTH_MIGRATION_DATABASE_URL });
const dmsOwner = new Pool({ connectionString: process.env.DMS_MIGRATION_DATABASE_URL });
const app = await createApplication(false);
process.send?.({ phase: 'initialize authority' });
await app.init();
if (process.env.AUTH_BROWSER_MAILPIT_URL) app.get(SecurityTelemetryService).enable(true);
const authority = app.get(AuthorityService);
const config = authority.config;
const auth = authority.auth;
if (!config || !auth) throw new Error('Authority fixture configuration missing');
const password = randomBytes(24).toString('base64url');
const users = {};
process.send?.({ phase: 'provision verified users' });
for (const [label, role] of [
  ['operator', 'admin'],
  ['member', 'user'],
  ['reset', 'user'],
  ['suspended', 'user'],
]) {
  const email = `bff-${label}@example.test`;
  const user = await provisionUser(
    auth,
    { email, name: label, role, password },
    config.AUTH_PUBLIC_ORIGIN,
  );
  process.send?.({ phase: 'read verification email' });
  const link = await smtp.link('verify', email);
  process.send?.({ phase: 'verify captured email' });
  const response = await app.inject({ method: 'GET', url: link.pathname + link.search });
  process.send?.({ phase: `verification status ${response.statusCode}` });
  if (response.statusCode !== 302) throw new Error('Fixture verification failed');
  users[label] = { id: user.id, email };
}
if (process.env.AUTH_BROWSER_MAILPIT_URL) {
  process.send?.({ phase: 'provision unverified account' });
  const email = 'bff-unverified@example.test';
  const user = await provisionUser(
    auth,
    { email, name: 'unverified', role: 'user', password },
    config.AUTH_PUBLIC_ORIGIN,
  );
  users.unverified = { id: user.id, email };
}
process.send?.({ phase: 'private administrator login' });
const signedIn = await auth.api.signInEmail({
  body: { email: users.operator.email, password },
  returnHeaders: true,
});
const operator = new Headers({
  origin: config.AUTH_PUBLIC_ORIGIN,
  cookie: signedIn.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; '),
});
process.send?.({ phase: 'issue managed clients' });
const login = await manageOAuthClient(auth, config, operator, {
  kind: 'login',
  action: 'issue',
  applicationId: process.env.TURNSTILE_APPLICATION_ID,
});
const applicationId = process.env.TURNSTILE_APPLICATION_ID;
process.send?.({ phase: 'login client issued' });
const machine = await manageOAuthClient(auth, config, operator, {
  kind: 'machine',
  action: 'issue',
  applicationId,
  scopes: ['dms:capabilities:read'],
});
const context = {
  tenantId: config.INSTALLATION_TENANT_ID,
  deploymentId: config.DMS_RESOURCE_URL,
  issuer: config.AUTH_ISSUER_URL,
};
process.send?.({ phase: 'machine client issued' });
await registerApplication(
  dmsOwner,
  context,
  {
    applicationId,
    clientId: machine.record.clientId,
    name: 'BFF fixture',
    scopes: ['dms:capabilities:read'],
  },
  machine.record,
);
const enrollment = await issueEnrollmentKey(dmsOwner, context, applicationId);
process.send?.({ phase: 'enrollment key issued' });
await app.listen(0, '127.0.0.1');
const address = app.getHttpAdapter().getInstance().server.address();
process.send?.({
  ready: true,
  port: address.port,
  password,
  users,
  loginSecret: login.secret,
  machineSecret: machine.secret,
});
process.on('message', async (message) => {
  try {
    if (message.action === 'clear-rate-limits') await owner.query('DELETE FROM auth.rate_limit');
    else if (message.action === 'enroll-machine') {
      const response = await app.inject({
        method: 'POST',
        url: '/identity/oauth2/token',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${Buffer.from(`${machine.record.clientId}:${machine.secret}`).toString('base64')}`,
        },
        payload: new URLSearchParams({
          grant_type: 'client_credentials',
          resource: config.DMS_RESOURCE_URL,
          scope: 'dms:capabilities:read',
        }).toString(),
      });
      if (response.statusCode !== 200) throw new Error('Fixture machine issuance failed');
      const activated = await app.inject({
        method: 'POST',
        url: '/v1/application-enrollments',
        headers: {
          authorization: `Bearer ${response.json().access_token}`,
          'x-thaarei-enrollment-key': enrollment.key,
          'idempotency-key': enrollment.keyId,
        },
        payload: { name: 'BFF fixture' },
      });
      if (activated.statusCode !== 201) throw new Error('Fixture enrollment failed');
    } else if (
      message.action === 'deny-machine-scope' ||
      message.action === 'restore-machine-scope'
    )
      await setApplicationScopes(
        dmsOwner,
        context,
        applicationId,
        message.action === 'deny-machine-scope' ? [] : ['dms:capabilities:read'],
      );
    else if (message.action === 'disable-machine')
      await disableApplication(dmsOwner, context, applicationId, async () => {
        await manageOAuthClient(auth, config, operator, {
          action: 'suspend',
          kind: 'machine',
          clientId: machine.record.clientId,
        });
      });
    else if (message.action === 'ban')
      await auth.api.banUser({ headers: operator, body: { userId: users.suspended.id } });
    else if (message.action === 'reset') {
      await auth.api.requestPasswordReset({
        body: {
          email: users.reset.email,
          redirectTo: `${config.AUTH_PUBLIC_ORIGIN}/reset-password`,
        },
      });
      const link = await smtp.link('reset', users.reset.email);
      await auth.api.resetPassword({
        body: {
          newPassword: randomBytes(24).toString('base64url'),
          token: link.searchParams.get('token') ?? link.pathname.split('/').at(-1),
        },
      });
    } else if (message.action !== 'security-metrics') throw new Error('Unknown fixture operation');
    process.send?.({
      requestId: message.requestId,
      ok: true,
      ...(message.action === 'security-metrics'
        ? { metrics: app.get(SecurityTelemetryService).snapshot() }
        : {}),
    });
  } catch {
    process.send?.({ requestId: message.requestId, ok: false });
  }
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  await withTenant(dmsOwner, context.tenantId, async (client) => {
    await client.query('DELETE FROM dms.enrollment_receipt WHERE application_id=$1', [
      applicationId,
    ]);
    await client.query('DELETE FROM dms.enrollment_key WHERE application_id=$1', [applicationId]);
    await client.query('DELETE FROM dms.application_registration WHERE id=$1', [applicationId]);
  });
  await dmsOwner.end();
  await owner.end();
  await smtp.close();
  process.disconnect?.();
}
process.on('disconnect', () => void close());
process.on('SIGTERM', () => void close());
