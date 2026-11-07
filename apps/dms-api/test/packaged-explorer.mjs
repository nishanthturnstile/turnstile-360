// Private disposable-image fixture. Mounted read-only into /run, never shipped as runtime code.

let phase = 'input';
process.on('uncaughtException', (error) => {
  // Fixed phase/type only: never print credentials, URLs, database details or raw errors.
  console.error(
    JSON.stringify({
      type: 'packaged-explorer-failure',
      phase,
      kind: error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : 'Error',
    }),
  );
  process.exit(1);
});

let input = '';
for await (const chunk of process.stdin) input += chunk;
const value = JSON.parse(input);
if (value.action === 'http') {
  phase = 'http';
  const response = await fetch(`http://localhost:3001${value.path}`, {
    signal: AbortSignal.timeout(10000),
    headers: value.headers,
    redirect: 'manual',
  });
  console.log(
    JSON.stringify({
      status: response.status,
      headers: Object.fromEntries(
        [...response.headers].filter(
          ([key]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(key),
        ),
      ),
      body: Buffer.from(await response.arrayBuffer()).toString('base64'),
    }),
  );
} else {
  phase = 'load-runtime';
  const { createPool } = await import('/app/dist/infrastructure/database/postgres.js');
  const { issueEnrollmentKey, registerApplication } = await import(
    '/app/dist/modules/enrollment/enrollment-operator.js'
  );
  const { parseAuthorityEnvironment } = await import(
    '/app/dist/modules/platform-auth/authority-configuration.js'
  );
  const { createAuthority } = await import('/app/dist/modules/platform-auth/authority-instance.js');
  const { manageOAuthClient } = await import('/app/dist/modules/platform-auth/manage-client.js');
  const { createRecoveryDelivery } = await import(
    '/app/dist/modules/platform-auth/recovery-delivery.js'
  );
  phase = 'configuration';
  const config = parseAuthorityEnvironment(process.env);
  const pool = createPool(config.AUTH_DATABASE_URL, 1);
  const owner = createPool(process.env.DMS_MIGRATION_DATABASE_URL, 1);
  const auth = createAuthority(config, pool, createRecoveryDelivery(config));
  let headers;
  try {
    phase = 'administrator-login';
    const login = await auth.api.signInEmail({
      body: { email: value.email, password: value.password },
      returnHeaders: true,
    });
    headers = new Headers({
      origin: config.AUTH_PUBLIC_ORIGIN,
      cookie: login.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; '),
    });
    const applicationId = crypto.randomUUID();
    const clientId = 'packaged-explorer-client';
    phase = 'machine-client';
    const issued = await manageOAuthClient(auth, config, headers, {
      action: 'issue',
      kind: 'machine',
      clientId,
      applicationId,
      scopes: ['dms:capabilities:read'],
    });
    const context = {
      tenantId: config.INSTALLATION_TENANT_ID,
      issuer: config.AUTH_ISSUER_URL,
      deploymentId: config.DMS_RESOURCE_URL,
    };
    phase = 'registration';
    await registerApplication(
      owner,
      context,
      { applicationId, clientId, name: clientId, scopes: ['dms:capabilities:read'] },
      issued.record,
    );
    phase = 'enrollment-key';
    const key = await issueEnrollmentKey(owner, context, applicationId);
    const tokenOptions = {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${issued.secret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'dms:capabilities:read',
        resource: config.DMS_RESOURCE_URL,
      }),
    };
    // Isolated authority fixture only: mint a genuinely short-lived signed JWT,
    // restore the normal ceiling, then prove expiry at the real machine boundary.
    await pool.query('UPDATE auth.oauth_resource SET access_token_ttl=1 WHERE identifier=$1', [
      config.DMS_RESOURCE_URL,
    ]);
    let expired;
    try {
      phase = 'short-token';
      const short = await fetch('http://localhost:3001/identity/oauth2/token', tokenOptions);
      if (!short.ok) throw new Error('Short-lived fixture token failed');
      expired = await short.json();
      if (expired.expires_in !== 1) throw new Error('Fixture did not mint an expiring token');
    } finally {
      await pool.query('UPDATE auth.oauth_resource SET access_token_ttl=300 WHERE identifier=$1', [
        config.DMS_RESOURCE_URL,
      ]);
    }
    phase = 'machine-token';
    const response = await fetch('http://localhost:3001/identity/oauth2/token', tokenOptions);
    if (!response.ok) throw new Error('Packaged token issuance failed');
    const token = await response.json();
    phase = 'enrollment';
    const enrolled = await fetch('http://localhost:3001/v1/application-enrollments', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token.access_token}`,
        'x-thaarei-enrollment-key': key.key,
        'idempotency-key': crypto.randomUUID(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: clientId }),
    });
    if (!enrolled.ok) throw new Error('Packaged enrollment failed');
    // Captured over private fixture IPC, never written to test logs/evidence.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    console.log(
      JSON.stringify({ accessToken: token.access_token, expiredToken: expired.access_token }),
    );
  } finally {
    if (headers) await auth.api.signOut({ headers });
    await Promise.all([pool.end(), owner.end()]);
  }
}
