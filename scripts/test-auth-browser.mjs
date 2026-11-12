// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: Standalone uncached fixture runner; generated credentials never enter Turbo task hashes.
// Runs only inside the disposable database harness. No customer configuration is loaded.
import assert from 'node:assert/strict';
import { fork, spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest, createServer as httpServer } from 'node:http';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { parse } from 'yaml';
import { prepareModuleAccess } from './fixtures/module-access.mjs';
import { prepareCutoverBrowser } from './fixtures/module-cutover-browser-setup.mjs';
import { testModuleCutover } from './test-module-cutover-browser.mjs';
import { testModuleAccess } from './test-modules-browser.mjs';
import { testOnboarding } from './test-onboarding-browser.mjs';
import { testPeople } from './test-people-browser.mjs';
import { testSettings } from './test-settings-browser.mjs';
import { testStructuredOnboarding } from './test-structured-onboarding-browser.mjs';

assert.equal(process.env.INSTALLATION_CUSTOMER_KEY, 'auth-fixture', 'Disposable harness required');
const temporary = await mkdtemp(join(tmpdir(), 'thaarei-auth-browser-'));
const mailpit = `thaarei-mail-${randomBytes(6).toString('hex')}`;
const web = `thaarei-web-${randomBytes(6).toString('hex')}`;
let mailCreated = false;
let webCreated = false;
const runtimeContainers = [];
let productMaintenanceArgs;
let cutoverPreparation;
let productRuntimeArguments;
const fullImages = process.env.AUTH_BROWSER_FULL_IMAGES === 'true';
assert.ok(
  !fullImages ||
    (process.env.AUTH_BROWSER_API_IMAGE &&
      process.env.AUTH_BROWSER_DMS_IMAGE &&
      process.env.AUTH_BROWSER_WEB_IMAGE),
  'Full image acceptance needs all three candidate images',
);
let browser;
let page;
let callbackStatus;
let callbackHtml;
const callbackTransport = [];
const introspectionStatuses = new Map();
let authority;
let product;
let authorityPort = 0;
let productPort = 0;
let webPort = 0;
let fault = 'none';
const browserNetwork = `${web}-network`;
let networkCreated = false;
const faultFile = join(temporary, 'browser-fault');
writeFileSync(faultFile, fault, { mode: 0o600 });
const setFault = (value) => {
  fault = value;
  writeFileSync(faultFile, value, { mode: 0o600 });
};
let stage = 'fixture setup';
let productLogs = '';
let authorityLogs = '';
const continuationSecrets = [];
const consoleMessages = [];
const nginx = await readFile('deploy/nginx/nginx.conf', 'utf8');
const csp = /add_header Content-Security-Policy "([^"]+)"/.exec(nginx)?.[1];
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30000, ...options });
  if (result.status !== 0 && command === 'docker')
    console.error(
      `Docker fixture operation failed: ${result.stderr.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[redacted]')}`,
    );
  assert.equal(
    result.status,
    0,
    `Private browser fixture command failed: ${command}, status=${result.status}, signal=${result.signal ?? 'none'}, error=${result.error?.code ?? 'none'}`,
  );
  return result.stdout.trim();
}
async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if (await check()) return;
    } catch {
      /* Dependency may still be starting. */
    }
    await delay(100);
  }
  throw new Error('Fixture readiness deadline');
}
const gateway = createServer({}, async (request, response) => {
  try {
    const path = (request.url ?? '/').split('?')[0];
    if (
      fullImages &&
      (path.startsWith('/internal/identity/') || path.startsWith('/internal/work/'))
    ) {
      response.writeHead(404).end();
      return;
    }
    const identity =
      path.startsWith('/identity/') ||
      path.startsWith('/internal/identity/') ||
      path.startsWith('/.well-known/');
    if (
      (fault === 'authority' && identity) ||
      (fault === 'logout' && /\/(revoke|end-session|sign-out)$/.test(path)) ||
      (fault === 'dms' && path.startsWith('/v1/'))
    ) {
      response
        .writeHead(503, { 'content-type': 'application/json' })
        .end('{"code":"AUTH_UNAVAILABLE"}');
      return;
    }
    const port =
      identity || path.startsWith('/v1')
        ? authorityPort
        : path.startsWith('/api')
          ? productPort
          : webPort;
    if (port) {
      const upstream = httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: request.url,
          method: request.method,
          headers: { ...request.headers, connection: 'close' },
        },
        (incoming) => {
          if (path === '/identity/oauth2/introspect')
            introspectionStatuses.set(
              incoming.statusCode,
              (introspectionStatuses.get(incoming.statusCode) ?? 0) + 1,
            );
          if (
            fault === 'people-outcome' &&
            path === '/api/people/roles' &&
            request.method === 'POST'
          ) {
            setFault('none');
            incoming.resume();
            incoming.once('end', () => response.destroy());
            return;
          }
          response.writeHead(incoming.statusCode ?? 503, incoming.headers);
          incoming.pipe(response);
        },
      );
      upstream.on('error', () => {
        if (!response.headersSent) response.writeHead(503);
        response.end();
      });
      request.pipe(upstream);
      return;
    }
    let file = 'index.html';
    if (/^\/assets\/[A-Za-z0-9_.-]+$/.test(path)) file = path.slice(1);
    const body = await readFile(resolve('apps/turnstile-web/dist', file));
    response
      .writeHead(200, {
        'content-type': file.endsWith('.js')
          ? 'text/javascript'
          : file.endsWith('.css')
            ? 'text/css'
            : file.endsWith('.woff2')
              ? 'font/woff2'
              : 'text/html',
        'referrer-policy': 'no-referrer',
        'content-security-policy': csp,
        'cache-control': 'no-store',
      })
      .end(body);
  } catch {
    response.writeHead(503).end();
  }
});

try {
  stage = 'test certificate';
  run('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    join(temporary, 'key.pem'),
    '-out',
    join(temporary, 'cert.pem'),
    '-days',
    '1',
    '-subj',
    '/CN=auth.fixture.test',
    '-addext',
    `subjectAltName=IP:127.0.0.1,DNS:auth.fixture.test,DNS:mailpit,DNS:${mailpit}`,
  ]);
  gateway.setSecureContext({
    key: await readFile(join(temporary, 'key.pem')),
    cert: await readFile(join(temporary, 'cert.pem')),
  });
  await new Promise((done) => gateway.listen(0, fullImages ? '0.0.0.0' : '127.0.0.1', done));
  const origin = `https://auth.fixture.test:${gateway.address().port}`;
  const dnsFile = join(temporary, 'fixture-dns.cjs');
  await writeFile(
    dnsFile,
    `const dns = require('node:dns'); const original = dns.lookup;
dns.lookup = function(host, options, callback) {
  if (host !== 'auth.fixture.test') return original.apply(this, arguments);
  if (typeof options === 'function') { callback = options; options = {}; }
  process.nextTick(() => options?.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4));
};\n`,
  );
  const image = parse(await readFile('deploy/compose.local.yaml', 'utf8')).services.mailpit.image;
  if (fullImages) {
    run('docker', [
      'network',
      'create',
      ...(process.env.AUTH_BROWSER_PRIVATE_SUBNET
        ? ['--subnet', process.env.AUTH_BROWSER_PRIVATE_SUBNET]
        : []),
      browserNetwork,
    ]);
    networkCreated = true;
    run('docker', ['network', 'connect', browserNetwork, process.env.ONBOARDING_ARCHIVE_CONTAINER]);
  }
  stage = 'Mailpit container';
  run('docker', [
    'run',
    '-d',
    '--rm',
    '--name',
    mailpit,
    ...(fullImages ? ['--network', browserNetwork, '--network-alias', 'mailpit'] : []),
    '-p',
    '127.0.0.1::1025',
    '-p',
    '127.0.0.1::8025',
    '-e',
    'MP_DISABLE_VERSION_CHECK=true',
    '-e',
    'MP_MAX_MESSAGES=100',
    '-e',
    'MP_QUIET=true',
    '-v',
    `${join(temporary, 'cert.pem')}:/run/tls/cert.pem:ro`,
    '-v',
    `${join(temporary, 'key.pem')}:/run/tls/key.pem:ro`,
    '-e',
    'MP_SMTP_TLS_CERT=/run/tls/cert.pem',
    '-e',
    'MP_SMTP_TLS_KEY=/run/tls/key.pem',
    '-e',
    'MP_SMTP_REQUIRE_STARTTLS=true',
    image,
  ]);
  mailCreated = true;
  const port = (name, internal) =>
    run('docker', [
      'inspect',
      '--format',
      `{{(index (index .NetworkSettings.Ports "${internal}/tcp") 0).HostPort}}`,
      name,
    ]);
  const smtpPort = port(mailpit, 1025);
  const mailUrl = `http://127.0.0.1:${port(mailpit, 8025)}`;
  await waitFor(async () => (await fetch(`${mailUrl}/readyz`)).ok);
  const environment = {
    ...process.env,
    AUTH_PROFILE: 'production',
    NODE_ENV: 'production',
    NODE_OPTIONS: `--require ${dnsFile}`,
    NODE_EXTRA_CA_CERTS: join(temporary, 'cert.pem'),
    AUTH_PUBLIC_ORIGIN: origin,
    AUTH_ISSUER_URL: `${origin}/identity`,
    AUTH_LOGIN_CALLBACK_URL: `${origin}/api/auth/callback`,
    DMS_RESOURCE_URL: `${origin}/v1`,
    DMS_API_URL: `${origin}/v1`,
    AUTH_SMTP_PORT: smtpPort,
    AUTH_SMTP_MODE: 'starttls',
    AUTH_BROWSER_MAILPIT_URL: mailUrl,
    ...(process.argv.includes('--modules')
      ? {
          AUTH_BROWSER_DIAGNOSTIC_FILE: join(
            dirname(process.env.MOD_I07_MODULE_FIXTURE),
            'authority-error.json',
          ),
        }
      : {}),
    AUTH_LOGIN_CLIENT_ID: 'bff-fixture-login',
    DMS_MACHINE_CLIENT_ID: 'bff-fixture-machine',
  };
  if (
    process.argv.includes('--people-ui') ||
    process.argv.includes('--modules') ||
    process.argv.includes('--module-cutover')
  ) {
    environment.IDENTITY_SERVICE_CLIENT_ID = 'bff-fixture-service';
    environment.IDENTITY_SERVICE_RESOURCE_URL = `${origin}/identity/services/accounts`;
  }
  stage = 'authority fixture startup';
  authority = fork('apps/dms-api/test/bff-authority-fixture.mjs', [], {
    env: environment,
    stdio: ['ignore', 'pipe', 'ignore', 'ipc'],
  });
  authority.stdout.on('data', (chunk) => {
    authorityLogs = `${authorityLogs}${chunk}`.slice(-131072);
  });
  const fixture = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Authority fixture deadline')), 30000);
    authority.on('message', (message) => {
      if (message.phase) stage = `authority fixture: ${message.phase}`;
      if (message.diagnostic) stage += ` / ${message.diagnostic}`;
      if (message.ready) {
        clearTimeout(timer);
        done(message);
      }
    });
    authority.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Authority fixture exited'));
    });
  });
  authorityPort = fixture.port;
  function command(action) {
    const requestId = randomUUID();
    return new Promise((done, reject) => {
      const timer = setTimeout(() => {
        authority.off('message', listener);
        reject(new Error('Fixture operation deadline'));
      }, 10000);
      function listener(message) {
        if (message.requestId !== requestId) return;
        clearTimeout(timer);
        authority.off('message', listener);
        message.ok ? done(message) : reject(new Error('Fixture operation failed'));
      }
      authority.on('message', listener);
      authority.send({ action, requestId });
    });
  }
  stage = 'machine enrollment';
  await command('enroll-machine');
  environment.AUTH_LOGIN_CLIENT_SECRET = fixture.loginSecret;
  environment.DMS_MACHINE_CLIENT_SECRET = fixture.machineSecret;
  stage = 'product permission assignment';
  run(
    process.execPath,
    ['apps/turnstile-api/dist/modules/organization/configuration-operator.js', 'initialize'],
    {
      env: environment,
      input: JSON.stringify({ operatorId: 'browser-fixture' }),
    },
  );
  run(
    process.execPath,
    ['apps/turnstile-api/dist/modules/access/access-operator.js', 'initialize'],
    {
      env: environment,
      input: JSON.stringify({ operatorId: 'browser-fixture' }),
    },
  );
  for (const label of ['member', 'reset', 'unverified']) {
    run(process.execPath, ['apps/turnstile-api/dist/modules/auth/set-user-access.js'], {
      env: environment,
      input: JSON.stringify({
        operatorId: 'browser-fixture',
        userId: fixture.users[label].id,
        enabled: true,
        permissions: [
          'turnstile:access',
          'turnstile:dms:capabilities:read',
          ...(label === 'member' ? ['turnstile:configuration:manage'] : []),
        ],
      }),
    });
  }
  if (
    process.argv.includes('--people-ui') ||
    process.argv.includes('--modules') ||
    process.argv.includes('--module-cutover')
  ) {
    environment.IDENTITY_SERVICE_CLIENT_SECRET = fixture.identitySecret;
    environment.IDENTITY_SERVICE_API_URL = `${origin}`;
    environment.TURNSTILE_INVITATION_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    environment.TURNSTILE_INVITATION_RECOVERY_EPOCH = randomBytes(32).toString('base64url');
    environment.TURNSTILE_SMTP_HOST = '127.0.0.1';
    environment.TURNSTILE_SMTP_PORT = String(smtpPort);
    environment.TURNSTILE_MAIL_FROM = 'turnstile@example.test';
    stage = 'People owning fixture setup';
    run(process.execPath, ['apps/turnstile-api/test/people-browser-fixture.mjs', '--setup'], {
      env: { ...environment, NODE_ENV: 'test' },
      input: JSON.stringify(fixture.users),
    });
  }
  const moduleFixture = process.argv.includes('--modules')
    ? await prepareModuleAccess(environment)
    : undefined;
  if (process.argv.includes('--module-cutover'))
    cutoverPreparation = await prepareCutoverBrowser(environment, browserNetwork);
  const reservation = httpServer();
  await new Promise((done) => reservation.listen(0, '127.0.0.1', done));
  productPort = reservation.address().port;
  await new Promise((done) => reservation.close(done));
  stage = 'compiled product startup';
  const productEnvironment = { ...environment, HOST: '127.0.0.1', PORT: String(productPort) };
  for (const name of Object.keys(productEnvironment))
    if (
      name.includes('MIGRATION_DATABASE_URL') ||
      [
        'AUTH_DATABASE_URL',
        'DMS_DATABASE_URL',
        'PROVISION_DATABASE_URL',
        'AUTH_SECRET',
        'AUTH_BROWSER_MAILPIT_URL',
        'TURNSTILE_REPORTER_DATABASE_URL',
      ].includes(name)
    )
      delete productEnvironment[name];
  async function imageRuntime(kind, image, configuration, port) {
    const runtime = {};
    const mounts = new Set();
    for (const [key, raw] of Object.entries(configuration)) {
      if (
        !/^(AUTH_|DMS_|IDENTITY_|TURNSTILE_|INSTALLATION_|CONTROL_PLANE_|NODE_ENV$|NODE_EXTRA_CA_CERTS$)/.test(
          key,
        ) ||
        key.includes('MIGRATION_') ||
        key.includes('FIXTURE') ||
        key.includes('BROWSER') ||
        key.includes('PROVISION') ||
        key === 'DMS_COORDINATOR_DATABASE_URL' ||
        key === 'DMS_OPERATOR_DATABASE_URL' ||
        key.endsWith('MACHINE_SECRET_FILE')
      )
        continue;
      if (
        kind === 'product' &&
        [
          'AUTH_DATABASE_URL',
          'DMS_DATABASE_URL',
          'AUTH_SECRET',
          'TURNSTILE_REPORTER_DATABASE_URL',
        ].includes(key)
      )
        continue;
      if (
        kind === 'authority' &&
        (key.startsWith('TURNSTILE_') ||
          (key.startsWith('IDENTITY_') &&
            !['IDENTITY_SERVICE_CLIENT_ID', 'IDENTITY_SERVICE_RESOURCE_URL'].includes(key)))
      )
        continue;
      let value = raw;
      if (key.endsWith('DATABASE_URL')) {
        const url = new URL(value);
        url.hostname = process.env.ONBOARDING_ARCHIVE_CONTAINER;
        url.port = '5432';
        value = url.href;
      }
      if (key.endsWith('SMTP_HOST')) value = key === 'TURNSTILE_SMTP_HOST' ? 'mailpit' : mailpit;
      if (key.endsWith('SMTP_PORT')) value = '1025';
      if (key.endsWith('_FILE') || key === 'NODE_EXTRA_CA_CERTS') mounts.add(value);
      runtime[key] = value;
    }
    for (const path of mounts)
      assert.ok(
        (await lstat(path)).isFile(),
        'Runtime delivery must mount exact public files, not fixture directories',
      );
    runtime.HOST = '0.0.0.0';
    runtime.PORT = String(port);
    const file = join(temporary, `${kind}-runtime.env`);
    await writeFile(
      file,
      Object.entries(runtime)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n'),
      { mode: 0o600 },
    );
    const mountArgs = [...mounts].flatMap((path) => [
      '--mount',
      `type=bind,source=${path},target=${path},readonly`,
    ]);
    if (kind === 'product') {
      const migrationUrl = new URL(environment.TURNSTILE_MIGRATION_DATABASE_URL);
      migrationUrl.hostname = process.env.ONBOARDING_ARCHIVE_CONTAINER;
      migrationUrl.port = '5432';
      const maintenanceFile = join(temporary, 'product-maintenance.env');
      await writeFile(
        maintenanceFile,
        Object.entries({ ...runtime, TURNSTILE_MIGRATION_DATABASE_URL: migrationUrl.href })
          .map(([key, value]) => `${key}=${value}`)
          .join('\n'),
        { mode: 0o600 },
      );
      productMaintenanceArgs = [
        'run',
        '--rm',
        '-i',
        '--network',
        browserNetwork,
        '--read-only',
        '--tmpfs',
        '/tmp',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges:true',
        '--env-file',
        maintenanceFile,
        ...mountArgs,
        image,
        'node',
        'dist/modules/access/release-operator.js',
      ];
    }
    if (kind === 'product') productRuntimeArguments = { runtime, mounts: [...mounts], image };
    const name = `${web}-${kind}`;
    run('docker', [
      'run',
      '--detach',
      '--rm',
      '--name',
      name,
      '--network',
      browserNetwork,
      '-p',
      `127.0.0.1::${port}`,
      '--read-only',
      '--tmpfs',
      '/tmp',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--env-file',
      file,
      ...[...mounts].flatMap((path) => [
        '--mount',
        `type=bind,source=${path},target=${path},readonly`,
      ]),
      image,
    ]);
    runtimeContainers.push(name);
    const exposed = Number(
      run('docker', [
        'inspect',
        '--format',
        `{{(index (index .NetworkSettings.Ports "${port}/tcp") 0).HostPort}}`,
        name,
      ]),
    );
    await waitFor(async () => (await fetch(`http://127.0.0.1:${exposed}/health/live`)).ok);
    return exposed;
  }
  let cutoverOwnerFile;
  if (cutoverPreparation) {
    environment.TURNSTILE_BUILD_VERSION = 'tcp-i06';
    productEnvironment.TURNSTILE_BUILD_VERSION = 'tcp-i06';
    const owner = { ...environment };
    for (const key of Object.keys(owner))
      if (key.endsWith('DATABASE_URL') && key.startsWith('TURNSTILE_')) {
        const url = new URL(owner[key]);
        url.hostname = process.env.ONBOARDING_ARCHIVE_CONTAINER;
        url.port = '5432';
        owner[key] = url.href;
      }
    owner.TURNSTILE_SMTP_HOST = 'mailpit';
    owner.TURNSTILE_SMTP_PORT = '1025';
    cutoverOwnerFile = join(cutoverPreparation.directory, 'owner.env');
    await writeFile(
      cutoverOwnerFile,
      Object.entries(owner)
        .filter(
          ([key]) =>
            /^(AUTH_|DMS_|IDENTITY_|TURNSTILE_|INSTALLATION_|NODE_ENV$|NODE_EXTRA_CA_CERTS$)/.test(
              key,
            ) &&
            ![
              'PROVISION_DATABASE_URL',
              'AUTH_DATABASE_URL',
              'DMS_DATABASE_URL',
              'AUTH_SECRET',
            ].includes(key) &&
            (!key.endsWith('DATABASE_URL') || key.startsWith('TURNSTILE_')),
        )
        .map(([k, v]) => `${k}=${v}`)
        .join('\n'),
      { mode: 0o600 },
    );
    const publicPaths = [
      'TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE',
      'TURNSTILE_CONTROL_PLANE_VERIFICATION_KEYS_FILE',
      'TURNSTILE_MODULE_RELEASE_FILE',
      'TURNSTILE_MODULE_RELEASE_TRUST_FILE',
      'NODE_EXTRA_CA_CERTS',
    ].map((k) => owner[k]);
    const args = [
      'run',
      '--rm',
      '-i',
      '--network',
      browserNetwork,
      '--env-file',
      cutoverOwnerFile,
      ...publicPaths.flatMap((p) => ['--mount', `type=bind,source=${p},target=${p},readonly`]),
      '--mount',
      `type=bind,source=${cutoverPreparation.privateDirectory},target=${cutoverPreparation.privateDirectory}`,
      process.env.AUTH_BROWSER_API_IMAGE,
      'node',
      'dist/modules/deployment/operator.js',
    ];
    const own = (action) =>
      run('docker', args, {
        input: JSON.stringify({
          action,
          ...(action === 'setup' ? { pairingFile: cutoverPreparation.pairingFile } : {}),
        }),
      });
    args.splice(
      args.indexOf(process.env.AUTH_BROWSER_API_IMAGE),
      0,
      '--mount',
      `type=bind,source=${cutoverPreparation.pairingFile},target=${cutoverPreparation.pairingFile},readonly`,
    );
    own('setup');
    await cutoverPreparation.rpc({ action: 'approve-product' });
    own('sync');
    await cutoverPreparation.rpc({ action: 'activate' });
    own('sync');
  }
  if (fullImages) {
    authorityPort = await imageRuntime(
      'authority',
      process.env.AUTH_BROWSER_DMS_IMAGE,
      environment,
      3001,
    );
    productPort = await imageRuntime(
      'product',
      process.env.AUTH_BROWSER_API_IMAGE,
      productEnvironment,
      3002,
    );
    const ingress = `${web}-canonical`;
    run('docker', [
      'run',
      '--detach',
      '--rm',
      '--name',
      ingress,
      '--network',
      browserNetwork,
      '--network-alias',
      'auth.fixture.test',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '-e',
      `QUALIFICATION_AUTHORITY=${web}-authority`,
      '-e',
      `QUALIFICATION_PRODUCT=${web}-product`,
      '-e',
      `QUALIFICATION_PORT=${new URL(origin).port}`,
      '--mount',
      `type=bind,source=${join(temporary, 'cert.pem')},target=/qualification/cert.pem,readonly`,
      '--mount',
      `type=bind,source=${join(temporary, 'key.pem')},target=/qualification/key.pem,readonly`,
      '--mount',
      `type=bind,source=${faultFile},target=/qualification/browser-fault,readonly`,
      '--mount',
      `type=bind,source=${resolve('scripts/fixtures/customer-browser-ingress.mjs')},target=/ingress.mjs,readonly`,
      process.env.AUTH_BROWSER_API_IMAGE,
      'node',
      '/ingress.mjs',
    ]);
    runtimeContainers.push(ingress);
    await waitFor(async () => {
      const probe = run('docker', [
        'exec',
        `${web}-product`,
        'node',
        '-e',
        `fetch('${origin}/identity/.well-known/openid-configuration',{redirect:'error',signal:AbortSignal.timeout(5000)}).then(async r=>{const m=await r.json();if(!r.ok||m.issuer!=='${origin}/identity'||m.jwks_uri!=='${origin}/identity/jwks'){console.error(JSON.stringify({status:r.status,issuer:m.issuer,jwks:m.jwks_uri}));process.exit(1);}console.log('passed')}).catch(e=>{console.error(e.cause?.code??e.name);process.exit(1)})`,
      ]);
      return probe === 'passed';
    });
  } else {
    product = spawn(process.execPath, ['apps/turnstile-api/dist/main.js'], {
      env: productEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [product.stdout, product.stderr])
      stream.on('data', (chunk) => {
        productLogs = `${productLogs}${chunk}`.slice(-131072);
      });
    await waitFor(async () => (await fetch(`http://127.0.0.1:${productPort}/health/live`)).ok);
  }
  if (process.env.AUTH_BROWSER_WEB_IMAGE) {
    run('docker', [
      'run',
      '-d',
      '--rm',
      '--name',
      web,
      ...(fullImages ? ['--network', browserNetwork] : []),
      '-p',
      '127.0.0.1::8080',
      process.env.AUTH_BROWSER_WEB_IMAGE,
    ]);
    webCreated = true;
    webPort = Number(port(web, 8080));
    await waitFor(async () => (await fetch(`http://127.0.0.1:${webPort}/health/live`)).ok);
    // Confirm canonical TLS/discovery reachability from an application container without disabling TLS checks.
    if (!fullImages) {
      const probe = spawn(
        'docker',
        [
          'run',
          '--rm',
          '--network',
          'host',
          '--add-host',
          'auth.fixture.test:127.0.0.1',
          '-v',
          `${join(temporary, 'cert.pem')}:/tmp/auth07-ca.crt:ro`,
          '-e',
          'NODE_EXTRA_CA_CERTS=/tmp/auth07-ca.crt',
          process.env.AUTH_BROWSER_API_IMAGE ?? 'thaarei-auth07-api',
          'node',
          '-e',
          `fetch('${origin}/identity/.well-known/openid-configuration',{redirect:'error',signal:AbortSignal.timeout(5000)}).then(async r=>{const m=await r.json();process.exit(r.ok&&m.issuer==='${origin}/identity'&&m.jwks_uri==='${origin}/identity/jwks'?0:1)}).catch(e=>process.exit(['ECONNREFUSED','ENETUNREACH','ETIMEDOUT','EHOSTUNREACH','UND_ERR_CONNECT_TIMEOUT'].includes(e.cause?.code)||e.name==='TimeoutError'?2:1))`,
        ],
        { stdio: 'ignore', timeout: 10000 },
      );
      const probeResult = (await once(probe, 'exit'))[0];
      assert.ok(
        [0, 2].includes(probeResult),
        'Canonical container discovery/TLS validation failed',
      );
      console.log(
        probeResult === 0
          ? 'Canonical HTTPS discovery from application container passed.'
          : 'UNAVAILABLE: application container cannot reach the local HTTPS fixture (host-network routing). Actual deployment DNS/TLS reachability remains unverified.',
      );
    }
  }
  browser = await chromium.launch({
    headless: true,
    args: ['--host-resolver-rules=MAP auth.fixture.test 127.0.0.1', '--no-proxy-server'],
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 850 },
    hasTouch: process.argv.includes('--people-ui'),
  });
  page = await context.newPage();
  page.on('request', (request) => {
    const parameters = new URL(request.url()).searchParams;
    for (const name of ['sig', 'state', 'nonce', 'code']) {
      const value = parameters.get(name);
      if (value && value.length >= 16 && continuationSecrets.length < 200)
        continuationSecrets.push(value);
    }
    if (new URL(request.url()).pathname === '/api/auth/callback') {
      callbackHtml = request.headers().accept?.includes('text/html') ?? false;
      if (callbackTransport.length < 20)
        callbackTransport.push({ kind: request.resourceType(), html: callbackHtml });
    }
  });
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/api/auth/callback') {
      callbackStatus = response.status();
      if (callbackTransport.length < 20)
        callbackTransport.push({
          status: callbackStatus,
          json: response.headers()['content-type']?.includes('json'),
        });
    }
  });
  page.on('console', (message) => {
    if (consoleMessages.length < 100) consoleMessages.push(message.text().slice(0, 2000));
  });
  page.setDefaultTimeout(10000);
  async function login(label, password = fixture.password) {
    await context.clearCookies();
    await command('clear-rate-limits');
    await page.goto(`${origin}/api/auth/login`);
    await page.getByLabel('Email address', { exact: true }).fill(fixture.users[label].email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  const heading = (name) => page.getByRole('heading', { name, exact: true }).waitFor();
  async function mailLink(purpose, email) {
    const list = await (await fetch(`${mailUrl}/api/v1/messages`)).json();
    const item = list.messages.find(
      (message) =>
        message.Subject.includes(
          purpose === 'verify' ? 'Verify your account' : 'Reset your account',
        ) && message.To.some((recipient) => recipient.Address === email),
    );
    assert.ok(item, 'Expected captured email');
    const detail = await (await fetch(`${mailUrl}/api/v1/message/${item.ID}`)).json();
    const value = detail.Text.match(/https?:\/\/[^\s]+/)?.[0];
    assert.ok(value, 'Expected captured recovery link');
    return value;
  }

  async function restartProduct() {
    if (fullImages) {
      run('docker', ['restart', `${web}-product`]);
      productPort = Number(
        run('docker', [
          'inspect',
          '--format',
          '{{(index (index .NetworkSettings.Ports "3002/tcp") 0).HostPort}}',
          `${web}-product`,
        ]),
      );
      await waitFor(async () => (await fetch(`http://127.0.0.1:${productPort}/health/live`)).ok);
      return;
    }
    product.kill('SIGTERM');
    await once(product, 'exit');
    product = spawn(process.execPath, ['apps/turnstile-api/dist/main.js'], {
      env: productEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [product.stdout, product.stderr])
      stream.on('data', (chunk) => {
        productLogs = `${productLogs}${chunk}`.slice(-131072);
      });
    await waitFor(async () => (await fetch(`http://127.0.0.1:${productPort}/health/live`)).ok);
  }
  if (process.argv.includes('--module-cutover')) {
    stage = 'actual selected module cutover';
    await testModuleCutover({
      page,
      context,
      origin,
      fixture,
      login,
      environment,
      preparation: cutoverPreparation,
      ownerFile: cutoverOwnerFile,
      network: browserNetwork,
      web,
      temporary,
      productImage: process.env.AUTH_BROWSER_API_IMAGE,
      runtime: () => productRuntimeArguments,
      replace: async (bundle) => {
        for (const kind of ['product', 'reporter']) {
          const index = runtimeContainers.indexOf(`${web}-${kind}`);
          if (index !== -1) runtimeContainers.splice(index, 1);
        }
        const image = `sha256:${bundle.inventory.images.find((i) => i.role === 'turnstile-api').digest}`;
        productPort = await imageRuntime('product', image, productEnvironment, 3002);
        run('docker', [
          'run',
          '--detach',
          '--rm',
          '--name',
          web,
          ...(fullImages ? ['--network', browserNetwork] : []),
          '-p',
          '127.0.0.1::8080',
          `sha256:${bundle.inventory.images.find((i) => i.role === 'turnstile-web').digest}`,
        ]);
        webPort = Number(port(web, 8080));
        await waitFor(async () => (await fetch(`http://127.0.0.1:${webPort}/health/live`)).ok);
      },
      trackReporter: () => {
        if (!runtimeContainers.includes(`${web}-reporter`))
          runtimeContainers.push(`${web}-reporter`);
      },
    });
  } else if (process.argv.includes('--modules')) {
    assert.ok(fullImages, 'Module acceptance requires actual selected images');
    stage = 'Selected module ordinary-login journeys';
    await testModuleAccess({
      page,
      context,
      origin,
      fixture,
      moduleFixture,
      command,
      login,
      invoke: (code, input) =>
        new Promise((resolve, reject) => {
          const child = spawn(
            'docker',
            [...productMaintenanceArgs.slice(0, -1), '--input-type=module', '-e', code],
            { stdio: ['pipe', 'pipe', 'pipe'] },
          );
          let output = '',
            error = '';
          child.stdout.on('data', (c) => {
            output += c;
            if (output.length > 16384) child.kill();
          });
          child.stderr.on('data', (c) => {
            error = `${error}${c}`.slice(-32768);
          });
          const timer = setTimeout(() => child.kill(), 30000);
          child.once('error', reject);
          child.once('exit', (code) => {
            clearTimeout(timer);
            if (code === 0) {
              try {
                resolve(JSON.parse(output));
              } catch {
                reject(new Error('Invalid private module command result'));
              }
            } else {
              writeFile(
                join(dirname(process.env.MOD_I07_MODULE_FIXTURE), 'module-command-error.log'),
                error,
                { mode: 0o600 },
              ).then(() =>
                reject(
                  new Error(
                    `Private module command failed; inspect ${join(dirname(process.env.MOD_I07_MODULE_FIXTURE), 'module-command-error.log')}`,
                  ),
                ),
              );
            }
          });
          child.stdin.end(JSON.stringify(input));
        }),
      disable: async (ids) => {
        productEnvironment.TURNSTILE_DISABLED_MODULES = JSON.stringify(ids);
        run('docker', ['rm', '--force', `${web}-product`]);
        runtimeContainers.splice(runtimeContainers.indexOf(`${web}-product`), 1);
        productPort = await imageRuntime(
          'product',
          process.env.AUTH_BROWSER_API_IMAGE,
          productEnvironment,
          3002,
        );
      },
    });
  } else if (process.argv.includes('--people-ui')) {
    stage = 'People administration browser journeys';
    const result = await testPeople({
      page,
      context,
      origin,
      login,
      mailUrl,
      mailLink,
      fixture,
      restartProduct,
      clearRateLimits: () => command('clear-rate-limits'),
      activateFeature: async () => {
        const rolesStatus = await page.evaluate(
          async () => (await fetch('/api/people/roles')).status,
        );
        assert.equal(rolesStatus, 403, 'Legacy grants do not promote a People administrator');
        const invokeRelease = async (operation, input) => {
          await new Promise((resolve, reject) => {
            const child = spawn(
              fullImages ? 'docker' : process.execPath,
              fullImages
                ? [...productMaintenanceArgs, operation]
                : ['apps/turnstile-api/dist/modules/access/release-operator.js', operation],
              {
                env: environment,
                stdio: ['pipe', 'pipe', 'pipe'],
              },
            );
            let output = '';
            child.stdout.on('data', (chunk) => {
              output += chunk;
              if (output.length > 16384) child.kill();
            });
            child.stderr.on('data', () => {});
            const timer = setTimeout(() => child.kill(), 30000);
            child.once('error', reject);
            child.once('exit', (code) => {
              clearTimeout(timer);
              code === 0
                ? resolve(JSON.parse(output))
                : reject(new Error('Private release command failed'));
            });
            child.stdin.end(JSON.stringify(input));
          });
        };
        const proof = async () => {
          const session = await page.evaluate(async () =>
            (await fetch('/api/auth/session')).json(),
          );
          const cookie = (await context.cookies()).find(
            (value) => value.name === '__Host-turnstile',
          );
          assert.ok(cookie, 'A signed normal product login is required');
          return {
            operatorId: fixture.users.member.id,
            administratorUserId: fixture.users.member.id,
            administratorCookie: `${cookie.name}=${cookie.value}`,
            key: randomUUID(),
            expectedRevision: session.access.accessRevision,
          };
        };
        await invokeRelease('bootstrap-administrator', await proof());
        await invokeRelease('open', {
          ...(await proof()),
          releaseId: 'b'.repeat(64),
          incompatibleProcessesStopped: true,
        });
        const verified = await proof();
        await invokeRelease('verify-login', {
          operatorId: verified.operatorId,
          administratorUserId: verified.administratorUserId,
          administratorCookie: verified.administratorCookie,
        });
        console.log('Real private administrator handover and versioned release opening passed.');
      },
      setFault: (value) => {
        setFault(value);
      },
    });
    assert.ok(
      ![
        ...continuationSecrets,
        fixture.password,
        fixture.loginSecret,
        fixture.machineSecret,
        fixture.identitySecret,
        ...result.secrets,
      ].some(
        (value) =>
          value &&
          (productLogs.includes(value) ||
            authorityLogs.includes(value) ||
            consoleMessages.some((message) => message.includes(value))),
      ),
      'Sensitive browser data must not enter application logs',
    );
  } else if (process.argv.includes('--structured-onboarding')) {
    stage = 'fresh required-Department onboarding web journey';
    await testStructuredOnboarding({
      page,
      origin,
      login,
      restartProduct,
      clearRateLimits: () => command('clear-rate-limits'),
      setFault: (value) => {
        setFault(value);
      },
    });
  } else {
    stage = 'design-system fonts, keyboard access and responsive recovery form';
    await page.goto(`${origin}/forgot-password`);
    await heading('Forgot your password?');
    await page.evaluate(() => document.fonts.ready);
    const typography = await page.evaluate(() => ({
      body: getComputedStyle(document.body).fontFamily,
      heading: getComputedStyle(document.querySelector('h1')).fontFamily,
      loaded: [...document.fonts]
        .filter((face) => face.status === 'loaded')
        .map((face) => face.family),
      external: performance
        .getEntriesByType('resource')
        .some((entry) => new URL(entry.name).origin !== location.origin),
    }));
    assert.match(typography.body, /IBM Plex Sans Variable/);
    assert.match(typography.heading, /Noto Sans Variable/);
    assert.ok(typography.loaded.some((family) => family.includes('IBM Plex Sans Variable')));
    assert.ok(typography.loaded.some((family) => family.includes('Noto Sans Variable')));
    assert.equal(typography.external, false);
    await page.getByLabel('Email address', { exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.equal(
      await page
        .getByRole('button', { name: 'Send reset link' })
        .evaluate((node) => node === document.activeElement),
      true,
    );
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 850 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
      );
      assert.equal(await page.getByLabel('Email address', { exact: true }).isVisible(), true);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(
      await page
        .getByRole('button', { name: 'Send reset link' })
        .evaluate((node) => Number.parseFloat(getComputedStyle(node).transitionDuration) < 0.01),
      true,
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    console.log(
      'Design-system integration passed: bundled fonts under CSP, keyboard access, narrow/desktop layouts and reduced motion.',
    );

    const setAccess = async (label, permissions) =>
      run(process.execPath, ['apps/turnstile-api/dist/modules/auth/set-user-access.js'], {
        env: environment,
        input: JSON.stringify({
          operatorId: 'browser-fixture',
          userId: fixture.users[label].id,
          enabled: true,
          permissions,
        }),
      });
    stage = 'onboarding web journey';
    await testOnboarding({
      page,
      context,
      browser,
      origin,
      login,
      setAccess,
      clearRateLimits: () => command('clear-rate-limits'),
      restartProduct,
    });
    stage = 'ongoing settings web journey';
    await testSettings({
      page,
      context,
      browser,
      origin,
      login,
      setAccess,
      clearRateLimits: () => command('clear-rate-limits'),
      waitForAuthorityWindow: async () => {
        // Keep the full production limiter enabled. Expanded scenarios share its
        // 100/minute introspection budget; start access-transition checks in a new window.
        const deadline = Date.now() + 61000;
        while (Date.now() < deadline) await delay(Math.min(1000, deadline - Date.now()));
      },
    });
    stage = 'sign-in, secure session, machine proof and recoverable logout';
    await login('member');
    await heading('Welcome, member.');
    // StrictMode/focus/visibility share only pending work; completed checks are never cached.
    const sharedChecks = await page.evaluate(async () => {
      const original = window.fetch;
      let calls = 0;
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const completed = [];
      window.fetch = (input, options) => {
        const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
        if (path !== '/api/auth/session') return original(input, options);
        calls++;
        const response = gate.then(() => original(input, options));
        completed.push(response.then((value) => value.clone().json()));
        return response;
      };
      try {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('focus'));
        await new Promise((resolve) => setTimeout(resolve, 50));
        const concurrent = calls;
        release();
        await Promise.all(completed);
        await new Promise((resolve) => setTimeout(resolve, 0));
        window.dispatchEvent(new Event('focus'));
        await Promise.all(completed);
        return { concurrent, total: calls };
      } finally {
        window.fetch = original;
      }
    });
    assert.deepEqual(sharedChecks, { concurrent: 1, total: 2 });
    await page.addInitScript(() => {
      window.authPageSeen = false;
      new MutationObserver(() => {
        if (document.querySelector('.auth-layout')) window.authPageSeen = true;
      }).observe(document, { childList: true, subtree: true });
    });
    let releaseSession;
    const sessionGate = new Promise((resolve) => {
      releaseSession = resolve;
    });
    const delayedSession = async (route) => {
      await sessionGate;
      await route.continue();
    };
    await page.route('**/api/auth/session', delayedSession);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('status').filter({ hasText: 'Loading workspace…' }).waitFor();
    assert.equal(await page.locator('.auth-layout').count(), 0);
    releaseSession();
    await heading('Welcome, member.');
    await page.unroute('**/api/auth/session', delayedSession);
    let refreshChecks = 0;
    const observeRefresh = (request) => {
      if (new URL(request.url()).pathname === '/api/auth/session') refreshChecks++;
    };
    page.on('request', observeRefresh);
    for (let refresh = 0; refresh < 20; refresh++) {
      // Manager Home also reads canonical configuration for the legacy suggestion.
      // Give each artificial reload burst a fresh private fixture window; retain
      // production limits and real authorization on every HTTP request.
      if (refresh % 5 === 0) await command('clear-rate-limits');
      await page.reload();
      await heading('Welcome, member.');
      assert.equal(await page.evaluate(() => window.authPageSeen), false);
    }
    page.off('request', observeRefresh);
    assert.equal(refreshChecks, 20);
    await command('clear-rate-limits');
    console.log(
      'Authenticated refresh regression passed: neutral startup, 20 reloads, one check per reload and no sign-in flash.',
    );
    const cookies = await context.cookies();
    const productCookie = cookies.find((cookie) => cookie.name === '__Host-turnstile');
    assert.ok(
      productCookie?.secure &&
        productCookie.httpOnly &&
        productCookie.sameSite === 'Lax' &&
        productCookie.path === '/',
    );
    assert.ok(
      await page.evaluate(
        () =>
          !document.cookie.includes('turnstile=') &&
          !document.cookie.includes('session_token') &&
          localStorage.length === 0 &&
          sessionStorage.length === 0,
      ),
    );
    const html = await page.content();
    assert.ok(
      ![fixture.password, fixture.loginSecret, fixture.machineSecret].some((value) =>
        html.includes(value),
      ),
    );
    assert.equal(
      await page.evaluate(
        async () =>
          (
            await fetch('/api/auth/logout', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: '{}',
            })
          ).status,
      ),
      403,
    );
    stage = 'permission-gated document connection';
    await page.getByRole('button', { name: 'Check connection' }).click();
    await page.getByText('Connected. Document features will appear here when available.').waitFor();
    setFault('dms');
    await page.getByRole('button', { name: 'Check connection' }).click();
    await page
      .getByText(
        'The document service is temporarily unavailable. Your sign-in is still active. Try again later.',
      )
      .waitFor();
    stage = 'authority outage navigation and session recovery';
    setFault('authority');
    await page.reload();
    await heading('We can’t connect right now');
    await page.getByRole('link', { name: 'Sign in', exact: true }).waitFor();
    setFault('none');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await heading('Welcome, member.');
    setFault('authority');
    await page.reload();
    await heading('We can’t connect right now');
    setFault('none');
    // The single delayed retry also recovers without a focus event or manual click.
    await heading('Welcome, member.');
    setFault('authority');
    await page.reload();
    await heading('We can’t connect right now');
    setFault('none');
    await page.getByRole('button', { name: 'Try again' }).click();
    await heading('Welcome, member.');
    await page.goto(`${origin}/auth-unavailable`);
    await heading('Welcome, member.');
    assert.equal(new URL(page.url()).pathname, '/');
    setFault('logout');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Retry sign-out' }).waitFor();
    assert.equal(
      await page.evaluate(async () => (await fetch('/api/dms/capabilities')).status),
      401,
    );
    setFault('none');
    await page.getByRole('button', { name: 'Retry sign-out' }).click();
    await heading('You’re signed out');
    assert.equal(
      await page.evaluate(async () => (await fetch('/identity/get-session')).status),
      200,
    );
    console.log(
      'Browser journey 1 passed: signed continuation, HTTPS cookies, machine request, CSRF and partial/logout recovery.',
    );

    stage = 'email verification, recovery and reset revocation';
    await login('unverified');
    await page.getByText('Verify your email before signing in.').waitFor();
    await page.getByRole('button', { name: 'Resend verification email' }).click();
    await page.getByText('If the account needs verification, a new email is on its way.').waitFor();
    await page.goto(await mailLink('verify', fixture.users.unverified.email));
    await page.getByLabel('Email address', { exact: true }).fill(fixture.users.unverified.email);
    await page.getByLabel('Password', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await heading('Welcome, unverified.');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await heading('You’re signed out');
    await login('reset');
    await heading('Welcome, reset.');
    await page.goto(`${origin}/forgot-password`);
    await page.getByLabel('Email address', { exact: true }).fill(fixture.users.reset.email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await heading('Check your inbox');
    const resetLink = await mailLink('reset', fixture.users.reset.email);
    await page.goto(`${origin}/forgot-password`);
    await page.getByLabel('Email address', { exact: true }).fill('unknown@example.test');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await heading('Check your inbox');
    await page.goto(resetLink);
    await heading('Choose a new password');
    assert.equal(new URL(page.url()).search, '');
    const newPassword = randomBytes(24).toString('base64url');
    await page.getByLabel('New password', { exact: true }).fill(newPassword);
    await page.getByLabel('Confirm new password', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Update password' }).click();
    await heading('Password updated');
    await page.goto(origin);
    await heading('Your session has ended');
    await page.goto(resetLink);
    await heading('Request a fresh link');
    await login('reset', newPassword);
    await heading('Welcome, reset.');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await heading('You’re signed out');
    console.log(
      'Browser journey 2 passed: real Mailpit verification/reset, generic recovery, token cleanup/replay and old-session revocation.',
    );

    stage = 'unprovisioned access, signed-context tampering and expiry';
    await login('operator');
    stage = 'unauthorized browser callback';
    await heading('Access isn’t available yet');
    await page.getByRole('button', { name: 'Sign in with a different account' }).click();
    stage = 'switch authority account';
    await page.getByLabel('Email address', { exact: true }).waitFor();
    const tampered = new URL(page.url());
    tampered.searchParams.set('state', 'tampered');
    await page.goto(tampered.href);
    stage = 'signed-context tamper denial';
    await page.getByLabel('Email address', { exact: true }).fill(fixture.users.member.email);
    await page.getByLabel('Password', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(new URL(page.url()).pathname, '/sign-in');
    await login('member');
    stage = 'fresh login after tampered continuation';
    await heading('Welcome, member.');
    await page.evaluate(async () =>
      fetch('/identity/sign-out', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    stage = 'parent revocation expiry screen';
    await page.getByRole('button', { name: 'Check connection' }).click();
    await heading('Your session has ended');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/forgot-password`);
    await heading('Forgot your password?');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    let metrics;
    if (fullImages) {
      // Read the runtimes that actually served the requests, not the provisioning fixture.
      authorityLogs = run('docker', ['logs', `${web}-authority`]);
      productLogs = run('docker', ['logs', `${web}-product`]);
      metrics = {};
      for (const line of authorityLogs
        .split('\n')
        .filter((line) => line.startsWith('{"type":"security"'))) {
        const event = JSON.parse(line),
          key = `${event.event}.${event.outcome}`;
        metrics[key] = Math.max(metrics[key] ?? 0, event.count);
      }
    } else metrics = (await command('security-metrics')).metrics;
    assert.ok(
      metrics['identity.login.success'] > 0 &&
        metrics['identity.recovery.success'] > 0 &&
        metrics['identity.token.success'] > 0 &&
        metrics['machine.access.success'] > 0,
    );
    assert.ok(Object.keys(metrics).filter((key) => !key.includes('.latency_le_')).length <= 24);
    assert.ok(Object.keys(metrics).length <= 60);
    const sensitive = [
      ...continuationSecrets,
      fixture.password,
      fixture.loginSecret,
      fixture.machineSecret,
      newPassword,
      new URL(resetLink).pathname.split('/').at(-1),
    ];
    assert.ok(
      !sensitive.some(
        (value) =>
          value &&
          (productLogs.includes(value) ||
            authorityLogs.includes(value) ||
            consoleMessages.some((message) => message.includes(value))),
      ),
    );
    const events = `${productLogs}\n${authorityLogs}`
      .split('\n')
      .filter((line) => line.startsWith('{"type":"security"'))
      .map((line) => JSON.parse(line));
    assert.ok(
      events.length > 0 &&
        events.every((event) =>
          Object.keys(event).every((key) =>
            [
              'type',
              'event',
              'outcome',
              'status',
              'count',
              'requestId',
              'durationMs',
              'bucket',
            ].includes(key),
          ),
        ),
    );
    assert.ok(
      events.every(
        (event) =>
          event.durationMs === undefined ||
          (Number.isFinite(event.durationMs) &&
            event.durationMs >= 0 &&
            event.durationMs <= 30000 &&
            [50, 100, 300, 1000, 5000, 30000].includes(event.bucket)),
      ),
    );
    console.log(
      'Browser journey 3 passed: unauthorized/expired states, signed-context tamper denial, mobile layout and bounded/redacted events.',
    );
  }
  if (webCreated)
    console.log(
      'Production Nginx assets/CSP served the requested browser journeys over the local HTTPS gateway.',
    );
} catch (error) {
  console.error('Introspection status counts:', Object.fromEntries(introspectionStatuses));
  if (process.argv.includes('--people-ui') && error instanceof Error) {
    const callsite = error.stack?.match(/test-people-browser\.mjs:\d+:\d+/)?.[0];
    if (callsite) console.error('People browser callsite:', callsite);
  }
  // Browser exceptions may contain signed or recovery URLs. Do not print raw failures/traces.
  if (page) {
    const path = new URL(page.url()).pathname;
    const allowed = [
      '/',
      '/sign-in',
      '/forgot-password',
      '/reset-password',
      '/api/auth/callback',
      '/unauthorized',
      '/auth-unavailable',
      '/session-expired',
    ];
    const title = await page
      .getByRole('heading')
      .first()
      .textContent({ timeout: 100 })
      .catch(() => 'none');
    const titles = [
      'Access isn’t available yet',
      'Your session has ended',
      'Welcome back',
      'We can’t connect right now',
      'Welcome, member.',
      'Welcome, operator.',
      'Welcome, reset.',
      'Settings access required',
      'Settings are temporarily unavailable',
      'Setup is temporarily unavailable',
      'Setup overview',
      'Organization',
      'Join your workspace',
      'Create your account',
      'Verify your email',
      'Welcome, Browser recipient.',
      'Workspace regional defaults',
      'Organization structure',
      'Rename unit',
      'Remove unit?',
    ];
    console.error(
      JSON.stringify({
        page: allowed.includes(path) ? path : 'other',
        heading: titles.includes(title) ? title : 'other',
        callbackStatus,
        callbackHtml,
        callbackTransport,
      }),
    );
    const code = await page.evaluate(() => {
      try {
        return JSON.parse(document.body.textContent).code;
      } catch {
        return undefined;
      }
    });
    if (
      [
        'AUTH_UNAVAILABLE',
        'PRODUCT_ACCESS_DENIED',
        'PERMISSION_DENIED',
        'IDENTITY_REQUIRED',
        'LOGIN_REQUIRED',
        'LOGIN_TRANSACTION_INVALID',
      ].includes(code)
    )
      console.error(`Safe response code: ${code}`);
  }
  if (
    (process.argv.includes('--modules') || process.argv.includes('--module-cutover')) &&
    error instanceof Error
  )
    console.error(error.message.replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]'));
  console.error(
    `Auth browser verification failed during ${stage} (${error instanceof Error ? error.name : 'Error'}).`,
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const name of runtimeContainers.reverse())
    spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore' });
  for (const child of [product, authority])
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        once(child, 'exit'),
        delay(5000, undefined, { ref: false }).then(() => {
          if (child.exitCode === null) child.kill('SIGKILL');
        }),
      ]);
    }
  for (const [created, name] of [
    [mailCreated, mailpit],
    [webCreated, web],
  ])
    if (created) spawnSync('docker', ['rm', '-f', '-v', name], { stdio: 'ignore' });
  if (networkCreated) {
    spawnSync(
      'docker',
      ['network', 'disconnect', browserNetwork, process.env.ONBOARDING_ARCHIVE_CONTAINER],
      { stdio: 'ignore' },
    );
    spawnSync('docker', ['network', 'disconnect', browserNetwork, mailpit], { stdio: 'ignore' });
    if (cutoverPreparation?.centralIngress)
      spawnSync(
        'docker',
        ['network', 'disconnect', browserNetwork, cutoverPreparation.centralIngress],
        { stdio: 'ignore' },
      );
    spawnSync('docker', ['network', 'rm', browserNetwork], { stdio: 'ignore' });
  }
  gateway.closeAllConnections();
  await new Promise((done) => gateway.close(() => done()));
  await rm(temporary, { recursive: true, force: true });
}
