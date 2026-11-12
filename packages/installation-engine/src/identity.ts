import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { preparePrivateFiles, rawEnvironment } from '@thaarei/deployment-control';
import { ClientCredentialsTokenProvider, DmsClient } from '@thaarei/dms-client';
import { IDENTITY_SERVICE_SCOPES } from '@thaarei/dms-contracts';
import { identitySetupInput } from './contracts.js';
import { privateText, writeJson } from './files.js';
import type { PrivateJobs } from './jobs.js';

const json = (output: string): Record<string, unknown> =>
  JSON.parse(output.split('\n').find((l) => l.startsWith('{')) ?? '{}');
export async function integrateIdentity(
  c: {
    root: string;
    state: string;
    applicationId: string;
    tenantId: string;
    operatorId: string;
    authorityOrigin: string;
    resourceOrigin: string;
    network: string;
    env: (files: string[]) => Record<string, string>;
    ownerEnv: (product: 'dms' | 'turnstile', maintenance?: boolean) => Record<string, string>;
    jobs: PrivateJobs;
    current: () => Promise<void>;
  },
  raw: unknown,
) {
  const input = identitySetupInput.parse(raw),
    user = JSON.parse(privateText(join(c.state, 'prepared-user.json')));
  assert.equal(
    user.email,
    input.operatorEmail,
    'Use the explicitly prepared customer administrator',
  );
  const selection = { email: input.operatorEmail, initialPermissions: input.initialPermissions },
    selectionFile = join(c.state, 'identity-selection.json');
  if (existsSync(selectionFile))
    assert.deepEqual(
      JSON.parse(privateText(selectionFile)),
      selection,
      'Changed identity selection requires explicit reconciliation',
    );
  else writeJson(selectionFile, selection);
  const generated = c.env(['.env.turnstile']);
  const specs = [
    ['login', 'AUTH_LOGIN_CLIENT_ID', null],
    ['machine', 'DMS_MACHINE_CLIENT_ID', ['dms:capabilities:read']],
    ['identity_service', 'IDENTITY_SERVICE_CLIENT_ID', [...IDENTITY_SERVICE_SCOPES]],
  ] as const;
  const folder = join(c.root, 'credentials');
  if (!existsSync(folder)) mkdirSync(folder, { mode: 0o700 });
  const secrets: Record<string, { clientId: string; clientSecret: string }> = {};
  for (const [kind, key, scopes] of specs) {
    const clientId = generated[key];
    assert.ok(clientId);
    const common = {
      action: 'issue',
      kind,
      clientId,
      applicationId: c.applicationId,
      operatorEmail: input.operatorEmail,
      operatorPassword: input.operatorPassword,
      credentialFile: `/run/thaarei/credentials/${clientId}.json`,
      ...(scopes ? { scopes } : {}),
    };
    await c.jobs.run(
      `identity-issue-${kind}`,
      'dms-api',
      'dist/modules/platform-auth/manage-client.js',
      [],
      c.ownerEnv('dms', true),
      common,
      c.network,
    );
    // Fresh verified-admin readback catches disabled/re-scoped clients; stale success is never authority.
    const current = json(
      await c.jobs.run(
        `identity-inspect-${kind}-${randomUUID()}`,
        'dms-api',
        'dist/modules/platform-auth/manage-client.js',
        [],
        c.ownerEnv('dms', true),
        {
          action: 'inspect',
          kind,
          clientId,
          operatorEmail: input.operatorEmail,
          operatorPassword: input.operatorPassword,
        },
        c.network,
      ),
    );
    assert.equal(current.clientId, clientId);
    assert.equal(current.applicationId, c.applicationId);
    assert.equal(current.tenantId, c.tenantId);
    assert.equal(current.disabled, false);
    assert.equal(current.kind, kind);
    if (scopes)
      assert.deepEqual(
        [...(current.scopes as string[])].sort(),
        [...scopes].sort(),
        'Current client scopes changed',
      );
    if (kind === 'login')
      assert.deepEqual(current.redirectUris, [`${c.authorityOrigin}/api/auth/callback`]);
    assert.equal(current.operatorId, user.userId, 'Current verified administrator changed');
    const credential = JSON.parse(privateText(join(folder, `${clientId}.json`)));
    assert.equal(credential.clientId, clientId);
    assert.ok(typeof credential.clientSecret === 'string' && credential.clientSecret.length >= 20);
    secrets[kind] = credential;
  }
  const machine = secrets.machine,
    login = secrets.login,
    identity = secrets.identity_service;
  assert.ok(machine && login && identity);
  await c.jobs.run(
    'identity-application-register',
    'dms-api',
    'dist/modules/enrollment/manage-application.js',
    [],
    c.ownerEnv('dms', true),
    {
      action: 'register',
      applicationId: c.applicationId,
      clientId: machine.clientId,
      name: 'Turnstile 360',
      scopes: ['dms:capabilities:read'],
      operatorEmail: input.operatorEmail,
      operatorPassword: input.operatorPassword,
    },
    c.network,
  );
  await c.jobs.run(
    'identity-enrollment-key',
    'dms-api',
    'dist/modules/enrollment/manage-application.js',
    [],
    c.ownerEnv('dms', true),
    {
      action: 'issue-key',
      applicationId: c.applicationId,
      credentialFile: '/run/thaarei/credentials/enrollment.json',
    },
    c.network,
  );
  const enrollment = JSON.parse(privateText(join(folder, 'enrollment.json')));
  assert.equal(enrollment.applicationId, c.applicationId);
  const requestFile = join(c.state, 'enrollment-operation.json');
  const operation = existsSync(requestFile)
    ? JSON.parse(privateText(requestFile))
    : { idempotencyKey: randomBytes(24).toString('base64url'), request: { name: 'Turnstile 360' } };
  if (!existsSync(requestFile)) writeJson(requestFile, operation);
  const provider = new ClientCredentialsTokenProvider({
    issuerUrl: `${c.authorityOrigin}/identity`,
    clientId: machine.clientId,
    clientSecret: machine.clientSecret,
    resource: `${c.resourceOrigin}/v1`,
    scopes: ['dms:capabilities:read'],
  });
  const consumer = new DmsClient({ baseUrl: `${c.resourceOrigin}/v1`, tokenProvider: provider });
  await c.current();
  const receiptPath = join(c.state, 'enrollment-receipt.json');
  if (existsSync(receiptPath)) {
    const receipt = JSON.parse(privateText(receiptPath));
    assert.equal(receipt.applicationId, c.applicationId);
    assert.equal(receipt.tenantId, c.tenantId);
    const registration = json(
      await c.jobs.run(
        `identity-enrollment-inspect-${randomUUID()}`,
        'dms-api',
        'dist/modules/enrollment/manage-application.js',
        [],
        c.ownerEnv('dms', true),
        { action: 'inspect', applicationId: c.applicationId },
        c.network,
      ),
    );
    assert.ok(
      registration.registration &&
        typeof registration.registration === 'object' &&
        'status' in registration.registration &&
        registration.registration.status === 'active',
      'Current DMS enrollment requires reconciliation',
    );
  } else {
    const receipt = await consumer.enroll({
      ...operation,
      enrollmentKey: enrollment.enrollmentKey,
    });
    assert.equal(receipt.applicationId, c.applicationId);
    assert.equal(receipt.tenantId, c.tenantId);
    writeJson(receiptPath, receipt);
  }
  await consumer.capabilities(); // Permissioned service/auth boundary, not a processing-readiness claim.
  // These are three purpose-separated owning credentials. No operator password enters runtime config.
  const values = {
    AUTH_LOGIN_CLIENT_SECRET: login.clientSecret,
    DMS_MACHINE_CLIENT_SECRET: machine.clientSecret,
    IDENTITY_SERVICE_CLIENT_SECRET: identity.clientSecret,
  };
  preparePrivateFiles(
    c.root,
    'clients',
    { applicationId: c.applicationId, values },
    ['.env.clients'],
    () => ({ files: { '.env.clients': rawEnvironment(values) }, result: { version: 1 } }),
  );
  await c.jobs.run(
    'identity-initial-access',
    'turnstile-api',
    'dist/modules/auth/set-user-access.js',
    [],
    c.ownerEnv('turnstile', true),
    {
      operatorId: c.operatorId,
      userId: user.userId,
      enabled: true,
      permissions: input.initialPermissions,
    },
    c.network,
  );
}
