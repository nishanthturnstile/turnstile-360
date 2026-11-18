// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: Uncached disposable orchestration; private fixture paths never enter Turbo task hashes.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';
import { exportSPKI, generateKeyPair, SignJWT } from 'jose';
import pg from 'pg';
import { parse } from 'yaml';
import { verifyDecision } from '../packages/deployment-control/dist/index.js';
import { verifyCentralMachines } from './fixtures/control-plane-machines.mjs';
import { verifyModuleAssignments } from './fixtures/control-plane-module-assignments.mjs';
import { verifyModuleMachines } from './fixtures/control-plane-module-machines.mjs';
import { verifyModuleTransitions } from './fixtures/control-plane-module-transitions.mjs';
import { verifyCentralCatalogues } from './fixtures/control-plane-modules.mjs';
import { verifyOfflineImage } from './fixtures/control-plane-offline.mjs';
import { verifyCentralRegistry } from './fixtures/control-plane-registry.mjs';
import { verifyControlPlaneUi } from './fixtures/control-plane-ui.mjs';
import { verifyDmsCentralHttp } from './fixtures/dms-central-http.mjs';
import { verifyInstallationHandover } from './fixtures/installation-handover.mjs';
import { verifyCombinedPreparation } from './fixtures/installation-preparation.mjs';
import { moduleCutoverControl } from './fixtures/module-cutover-control.mjs';
import { verifyTurnstileCentralHttp } from './fixtures/turnstile-central-http.mjs';
import { verifyInstalledModuleDecisions } from './fixtures/turnstile-module-decisions.mjs';
import { verifyInstallationIntent } from './installation-intent.mjs';

const fixtureLicenceEnd = new Date(Date.now() + 365 * 86400000).toISOString();

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const app = join(root, 'apps/thaarei-control-plane');
const temporary = await mkdtemp(join(tmpdir(), 'thaarei-central-http-'));
const name = `thaarei-central-test-${randomBytes(6).toString('hex')}`;
const containers = [];
const image = process.env.CONTROL_PLANE_TEST_IMAGE;
const qualifyTwoClients = process.env.CONTROL_PLANE_QUALIFY_TWO_CLIENTS === 'true';
const containerQualification = process.env.CONTROL_PLANE_QUALIFY_CONTAINERS === 'true';
assert.ok(
  !containerQualification || image,
  'Container qualification requires the central candidate image',
);
const customerNetworks = [];
let networkCreated = false;
let next;
let proxy;
let database;
const env = {
  ...process.env,
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
  CONTROL_PLANE_PROFILE: 'test',
  CONTROL_PLANE_TRUST_PROXY: 'true',
};
async function run(command, args, extra = {}) {
  return (
    await exec(command, args, {
      cwd: root,
      env,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120000,
      ...extra,
    })
  ).stdout.trim();
}
async function freePort() {
  const server = net.createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
async function docker(service, image, ports, extra = [], network = name) {
  const id = `${name}-${service}`;
  await run('docker', [
    'run',
    '--detach',
    '--rm',
    '--name',
    id,
    '--network',
    network,
    ...ports.flatMap((port) => ['-p', `127.0.0.1::${port}`]),
    ...extra,
    image,
  ]);
  containers.push(id);
  const result = {};
  for (const port of ports)
    result[port] = await run('docker', [
      'inspect',
      '--format',
      `{{(index (index .NetworkSettings.Ports "${port}/tcp") 0).HostPort}}`,
      id,
    ]);
  return result;
}
function totp(uri) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const letter of new URL(uri).searchParams.get('secret'))
    bits += alphabet.indexOf(letter.toUpperCase()).toString(2).padStart(5, '0');
  const secret = Buffer.from(bits.match(/.{8}/g).map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac('sha1', secret).update(counter).digest();
  const offset = hash[19] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
try {
  await run('docker', ['network', 'create', name]);
  networkCreated = true;
  const services = parse(await readFile(join(root, 'deploy/compose.local.yaml'), 'utf8')).services;
  env.POSTGRES_PASSWORD = randomBytes(36).toString('base64url');
  const ports = await docker(
    'postgres',
    services.postgres.image,
    [5432],
    [
      '--tmpfs',
      '/var/lib/postgresql:rw,size=1g',
      '-e',
      'POSTGRES_PASSWORD',
      '-e',
      'POSTGRES_DB=central_fixture',
    ],
  );
  await run('openssl', [
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
    '/CN=localhost',
    '-addext',
    `subjectAltName=DNS:localhost,DNS:turnstile.fixture.test,DNS:dms.fixture.test,DNS:files.fixture.test,DNS:mailpit,DNS:central.fixture.test,DNS:${name}-mail,IP:127.0.0.1`,
  ]);
  if (containerQualification) {
    env.NODE_EXTRA_CA_CERTS = join(temporary, 'cert.pem');
    env.CONTROL_PLANE_PROFILE = 'production';
  }
  const mail = await docker(
    'mail',
    services.mailpit.image,
    [1025, 8025],
    [
      '-e',
      'MP_MAX_MESSAGES=100',
      '-e',
      'MP_DISABLE_VERSION_CHECK=true',
      ...(containerQualification
        ? [
            '--mount',
            `type=bind,source=${join(temporary, 'cert.pem')},target=/run/cert.pem,readonly`,
            '--mount',
            `type=bind,source=${join(temporary, 'key.pem')},target=/run/key.pem,readonly`,
            '-e',
            'MP_SMTP_TLS_CERT=/run/cert.pem',
            '-e',
            'MP_SMTP_TLS_KEY=/run/key.pem',
            '-e',
            'MP_SMTP_REQUIRE_STARTTLS=true',
          ]
        : []),
    ],
  );
  for (let i = 0; i < 80; i++) {
    try {
      await run('docker', [
        'exec',
        `${name}-postgres`,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'postgres',
        '-d',
        'central_fixture',
      ]);
      break;
    } catch {
      if (i === 79) throw new Error('Fixture PostgreSQL unavailable');
      await setTimeout(100);
    }
  }
  const migrationPassword = randomBytes(36).toString('base64url');
  const runtimePassword = randomBytes(36).toString('base64url');
  env.CONTROL_PLANE_PROVISION_DATABASE_URL = `postgresql://postgres:${env.POSTGRES_PASSWORD}@127.0.0.1:${ports[5432]}/central_fixture`;
  env.CONTROL_PLANE_MIGRATION_DATABASE_URL = `postgresql://control_plane_migrator:${migrationPassword}@127.0.0.1:${ports[5432]}/central_fixture`;
  env.CONTROL_PLANE_DATABASE_URL = `postgresql://control_plane_runtime:${runtimePassword}@127.0.0.1:${ports[5432]}/central_fixture`;
  await writeFile(
    join(temporary, 'provision.json'),
    JSON.stringify({ migrationPassword, runtimePassword }),
    { mode: 0o600 },
  );
  const provision = spawn(process.execPath, ['scripts/provision-control-plane.mjs'], {
    cwd: root,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  provision.stdin.end(JSON.stringify({ migrationPassword, runtimePassword }));
  let provisionOutput = '';
  provision.stderr.on('data', (chunk) => {
    provisionOutput += chunk;
  });
  assert.equal(await new Promise((done) => provision.on('close', done)), 0, provisionOutput);
  await run(process.execPath, ['--conditions=react-server', 'src/server/migrate.ts'], { cwd: app });
  await run(process.execPath, ['--conditions=react-server', 'src/server/migrate.ts'], { cwd: app });
  database = new pg.Pool({ connectionString: env.CONTROL_PLANE_MIGRATION_DATABASE_URL, max: 2 });
  const limited = new pg.Pool({ connectionString: env.CONTROL_PLANE_DATABASE_URL, max: 1 });
  try {
    await assert.rejects(
      limited.query('CREATE TABLE control_plane.forbidden(id text)'),
      /permission denied/,
    );
    await assert.rejects(
      limited.query('DELETE FROM control_plane.staff_audit'),
      /permission denied/,
    );
    await assert.rejects(
      limited.query('UPDATE control_plane.staff_audit SET reason=reason'),
      /permission denied/,
    );
    await assert.rejects(
      limited.query('DELETE FROM control_plane.module_authority WHERE false'),
      /permission denied/,
    );
    await assert.rejects(
      limited.query('UPDATE control_plane.module_authority SET document=NULL WHERE false'),
      /permission denied/,
    );
  } finally {
    await limited.end();
  }
  const key = await readFile(join(temporary, 'key.pem'));
  const ca = await readFile(join(temporary, 'cert.pem'));
  let upstream = await freePort();
  let dropMachineRotation = false;
  let dropMachineReport = false;
  proxy = https.createServer({ key, cert: ca }, (request, response) => {
    const forward = http.request(
      {
        hostname: '127.0.0.1',
        port: upstream,
        path: request.url,
        method: request.method,
        headers: {
          ...request.headers,
          'x-forwarded-for': '127.0.0.1',
          'x-forwarded-proto': 'https',
        },
      },
      (incoming) => {
        incoming.on('error', () => response.destroy());
        if (
          dropMachineRotation &&
          request.url === '/api/machine/v1/rotate' &&
          incoming.statusCode === 200
        ) {
          dropMachineRotation = false;
          incoming.resume();
          response.destroy();
          return;
        }
        if (
          dropMachineReport &&
          request.url === '/api/machine/v1/sync' &&
          incoming.statusCode === 200
        ) {
          dropMachineReport = false;
          incoming.resume();
          response.destroy();
          return;
        }
        response.writeHead(incoming.statusCode, incoming.headers);
        incoming.pipe(response);
      },
    );
    forward.on('error', () => {
      response.writeHead(503);
      response.end();
    });
    request.pipe(forward);
  });
  await new Promise((done) => proxy.listen(0, '127.0.0.1', done));
  const ingressPort = await freePort();
  const origin = containerQualification
    ? `https://central.fixture.test:${ingressPort}`
    : `https://localhost:${proxy.address().port}`;
  const faultsFile = join(temporary, 'faults.json');
  const faults = { unavailable: false, rotation: false, report: false };
  const updateFault = (key, value) => {
    // Read the ingress's acknowledgement too, so consumed one-shot faults stay consumed.
    Object.assign(faults, JSON.parse(requireFaults()));
    faults[key] = value;
    writeFileSync(faultsFile, JSON.stringify(faults), { mode: 0o600 });
  };
  const requireFaults = () => readFileSync(faultsFile, 'utf8');
  writeFileSync(faultsFile, JSON.stringify(faults), { mode: 0o600 });
  const dnsFile = join(temporary, 'central-dns.cjs');
  if (containerQualification) {
    await writeFile(
      dnsFile,
      `const dns=require('node:dns'); const lookup=dns.lookup; dns.lookup=function(host,options,callback){if(host!=='central.fixture.test')return lookup.apply(this,arguments);if(typeof options==='function'){callback=options;options={};}process.nextTick(()=>options?.all?callback(null,[{address:'127.0.0.1',family:4}]):callback(null,'127.0.0.1',4));};`,
    );
    env.NODE_OPTIONS = `--require ${dnsFile}`;
  }

  env.CONTROL_PLANE_PUBLIC_ORIGIN = origin;
  env.CONTROL_PLANE_DMS_SUPPORTED_VERSIONS = '["supported-release"]';
  env.CONTROL_PLANE_TURNSTILE_SUPPORTED_VERSIONS = '["tcp-i06"]';
  env.CONTROL_PLANE_AUTH_SECRET_FILE = join(temporary, 'auth-secret');
  await writeFile(env.CONTROL_PLANE_AUTH_SECRET_FILE, randomBytes(48).toString('base64url'), {
    mode: 0o600,
  });
  env.CONTROL_PLANE_SMTP_URL = `smtp://127.0.0.1:${mail[1025]}`;
  env.CONTROL_PLANE_SMTP_FROM = 'staff@thaarei.test';
  const moduleReleaseKeys = await generateKeyPair('RS256');
  const cutoverFixture = process.env.MOD_I08_SELECTED_FIXTURE
    ? JSON.parse(await readFile(process.env.MOD_I08_SELECTED_FIXTURE, 'utf8'))
    : null;
  const installationFixture = process.env.MOD_I09_INSTALLATION_FIXTURE
    ? JSON.parse(await readFile(process.env.MOD_I09_INSTALLATION_FIXTURE, 'utf8'))
    : null;
  const preparationFixture = process.env.MOD_I05_PREPARATION_FIXTURE
    ? JSON.parse(await readFile(process.env.MOD_I05_PREPARATION_FIXTURE, 'utf8'))
    : null;
  env.CONTROL_PLANE_MODULE_RELEASE_TRUST_FILE = join(temporary, 'module-release-trust.json');
  await writeFile(
    env.CONTROL_PLANE_MODULE_RELEASE_TRUST_FILE,
    JSON.stringify({
      issuer: 'https://releases.fixture.test',
      keys: [
        { kid: 'module-release-test', publicKey: await exportSPKI(moduleReleaseKeys.publicKey) },
        ...(preparationFixture?.releaseTrust.keys ?? []),
        ...(installationFixture?.releaseTrust.keys ?? []),
        ...(cutoverFixture?.releaseTrust.keys ?? []),
      ],
    }),
    { mode: 0o600 },
  );
  env.CONTROL_PLANE_MODULE_REFERENCE_DIRECTORY = join(temporary, 'module-references');
  await mkdir(env.CONTROL_PLANE_MODULE_REFERENCE_DIRECTORY, { mode: 0o755 });
  const signModuleEvidence = (payload, seconds = 600, purpose = 'catalogue') =>
    new SignJWT(payload)
      .setProtectedHeader({
        alg: 'RS256',
        typ: `thaarei-module-${purpose}+jwt`,
        kid: 'module-release-test',
      })
      .setIssuer('https://releases.fixture.test')
      .setAudience(`urn:thaarei:module-${purpose}`)
      .setIssuedAt()
      .setNotBefore(Math.floor(Date.now() / 1000))
      .setExpirationTime(Math.floor(Date.now() / 1000) + seconds)
      .sign(moduleReleaseKeys.privateKey);
  env.CONTROL_PLANE_SIGNING_KEY_FILE = join(temporary, 'deployment-signer.json');
  env.CONTROL_PLANE_RECOVERY_MARKER_FILE = join(temporary, 'recovery-marker');
  env.CONTROL_PLANE_PUBLIC_KEYS_OUTPUT_FILE = join(temporary, 'public-keys.json');
  await writeFile(env.CONTROL_PLANE_RECOVERY_MARKER_FILE, randomBytes(48).toString('base64url'), {
    mode: 0o600,
  });
  const authority = spawn(
    process.execPath,
    ['--conditions=react-server', 'src/server/machine-operator.ts'],
    { cwd: app, env, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let authorityError = '';
  authority.stderr.on('data', (s) => {
    authorityError += s;
  });
  authority.stdin.end(
    JSON.stringify({ action: 'initialize', reason: 'isolated protocol fixture' }),
  );
  assert.equal(await new Promise((done) => authority.on('close', done)), 0, authorityError);
  const publicTrust = JSON.parse(await readFile(env.CONTROL_PLANE_PUBLIC_KEYS_OUTPUT_FILE, 'utf8'));

  const password = randomBytes(30).toString('base64url');
  const operator = async (input, overrides = {}) => {
    const child = spawn(process.execPath, ['--conditions=react-server', 'src/server/operator.ts'], {
      cwd: app,
      env: { ...env, ...overrides },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (s) => {
      out += s;
    });
    child.stderr.on('data', (s) => {
      err += s;
    });
    child.stdin.end(JSON.stringify(input));
    const code = await new Promise((done) => child.on('close', done));
    return { code, out, err };
  };
  const bootstrap = {
    action: 'bootstrap',
    email: 'admin@thaarei.test',
    name: 'Administrator',
    password,
    reason: 'isolated fixture bootstrap',
  };
  const created = await operator(bootstrap, {
    CONTROL_PLANE_AUTH_SECRET_FILE: join(temporary, 'missing-bootstrap-secret'),
  });
  assert.equal(created.code, 0, created.err);
  assert.match(created.out, /Account created; verification delivery pending/);
  const bootstrapReceipt = JSON.parse(created.out.trim().split('\n').at(-1));
  assert.equal(bootstrapReceipt.status, 'verification-required');
  assert.equal(
    (await database.query('SELECT user_id FROM control_plane.staff')).rows[0].user_id,
    bootstrapReceipt.id,
  );

  assert.notEqual((await operator(bootstrap)).code, 0, 'Repeated bootstrap must fail');
  const nextEnv = { ...env };
  delete nextEnv.CONTROL_PLANE_PUBLIC_KEYS_OUTPUT_FILE;
  delete nextEnv.CONTROL_PLANE_PROVISION_DATABASE_URL;
  delete nextEnv.CONTROL_PLANE_MIGRATION_DATABASE_URL;
  delete nextEnv.POSTGRES_PASSWORD;
  let serverOutput = '';
  if (image) {
    const containerEnv = {
      ...nextEnv,
      CONTROL_PLANE_DATABASE_URL: nextEnv.CONTROL_PLANE_DATABASE_URL.replace(
        `127.0.0.1:${ports[5432]}`,
        `${name}-postgres:5432`,
      ),
      CONTROL_PLANE_SMTP_URL: `smtp://${name}-mail:1025`,
      CONTROL_PLANE_MODULE_RELEASE_TRUST_FILE: '/run/module-release-trust.json',
      CONTROL_PLANE_MODULE_REFERENCE_DIRECTORY: '/run/module-references',
      CONTROL_PLANE_AUTH_SECRET_FILE: '/run/control-plane-auth',
      CONTROL_PLANE_SIGNING_KEY_FILE: '/run/deployment-signer',
      CONTROL_PLANE_RECOVERY_MARKER_FILE: '/run/recovery-marker',
    };
    const runtimeFile = join(temporary, 'runtime.env');
    await writeFile(
      runtimeFile,
      Object.entries(containerEnv)
        .filter(([key]) => key.startsWith('CONTROL_PLANE_'))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n'),
      { mode: 0o600 },
    );
    const maintenanceFile = join(temporary, 'maintenance.env');
    await writeFile(
      maintenanceFile,
      `CONTROL_PLANE_MIGRATION_DATABASE_URL=${env.CONTROL_PLANE_MIGRATION_DATABASE_URL.replace(`127.0.0.1:${ports[5432]}`, `${name}-postgres:5432`)}\n`,
      { mode: 0o600 },
    );
    await run('docker', [
      'run',
      '--rm',
      '--network',
      name,
      '--env-file',
      maintenanceFile,
      image,
      'node',
      '--conditions=react-server',
      'src/server/migrate.ts',
    ]);
    const appPorts = await docker(
      'app',
      image,
      [3000],
      [
        '--read-only',
        '--tmpfs',
        '/tmp',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges:true',
        '--env-file',
        runtimeFile,
        ...(containerQualification
          ? [
              '-e',
              'NODE_EXTRA_CA_CERTS=/run/fixture-ca.pem',
              '--mount',
              `type=bind,source=${join(temporary, 'cert.pem')},target=/run/fixture-ca.pem,readonly`,
            ]
          : []),
        '--mount',
        `type=bind,source=${env.CONTROL_PLANE_AUTH_SECRET_FILE},target=/run/control-plane-auth,readonly`,
        '--mount',
        `type=bind,source=${env.CONTROL_PLANE_MODULE_RELEASE_TRUST_FILE},target=/run/module-release-trust.json,readonly`,
        '--mount',
        `type=bind,source=${env.CONTROL_PLANE_MODULE_REFERENCE_DIRECTORY},target=/run/module-references,readonly`,
        '--mount',
        `type=bind,source=${env.CONTROL_PLANE_SIGNING_KEY_FILE},target=/run/deployment-signer,readonly`,
        '--mount',
        `type=bind,source=${env.CONTROL_PLANE_RECOVERY_MARKER_FILE},target=/run/recovery-marker,readonly`,
      ],
    );
    upstream = Number(appPorts[3000]);
    if (containerQualification) {
      await run('docker', [
        'run',
        '--detach',
        '--rm',
        '--name',
        `${name}-ingress`,
        '--network',
        name,
        '--network-alias',
        'central.fixture.test',
        '-p',
        `127.0.0.1:${ingressPort}:${ingressPort}`,
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges:true',
        '-e',
        `QUALIFICATION_UPSTREAM=${name}-app`,
        '-e',
        `QUALIFICATION_PORT=${ingressPort}`,
        '--mount',
        `type=bind,source=${join(temporary, 'cert.pem')},target=/qualification/cert.pem,readonly`,
        '--mount',
        `type=bind,source=${join(temporary, 'key.pem')},target=/qualification/key.pem,readonly`,
        '--mount',
        `type=bind,source=${faultsFile},target=/qualification/faults.json`,
        '--mount',
        `type=bind,source=${join(root, 'scripts/fixtures/control-plane-ingress.mjs')},target=/ingress.mjs,readonly`,
        image,
        'node',
        '/ingress.mjs',
      ]);
      containers.push(`${name}-ingress`);
    }
  } else {
    next = spawn(
      process.execPath,
      [
        join(app, 'node_modules/next/dist/bin/next'),
        'start',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(upstream),
      ],
      { cwd: app, env: nextEnv, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    next.stdout.on('data', (s) => {
      serverOutput += s;
    });
    next.stderr.on('data', (s) => {
      serverOutput += s;
    });
  }
  function client() {
    const jar = new Map();
    return {
      jar,
      async call(path, input, options = {}) {
        const method = options.method ?? (input === undefined ? 'GET' : 'POST');
        const result = await new Promise((done, reject) => {
          const request = https.request(
            `${origin}${path}`,
            {
              ca,
              agent: false,
              ...(containerQualification
                ? {
                    lookup: (_host, _options, callback) =>
                      callback(null, [{ address: '127.0.0.1', family: 4 }]),
                  }
                : {}),
              method,
              headers: {
                cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
                ...(input === undefined ? {} : { 'content-type': 'application/json', origin }),
                ...options.headers,
              },
            },
            (response) => {
              response.on('error', reject);
              if (options.dropResponse) {
                response.destroy();
                request.destroy();
                reject(new Error('Fixture discarded a committed response'));
                return;
              }
              for (const cookie of response.headers['set-cookie'] ?? []) {
                const part = cookie.split(';')[0];
                const index = part.indexOf('=');
                jar.set(part.slice(0, index), part.slice(index + 1));
              }
              let text = '';
              response.on('data', (s) => {
                text += s;
              });
              response.on('end', () =>
                done({
                  status: response.statusCode,
                  headers: response.headers,
                  text,
                  json: () => JSON.parse(text),
                }),
              );
            },
          );
          request.on('error', (error) => {
            error.message += ` (fixture route ${path})`;
            reject(error);
          });
          if (input !== undefined) request.write(JSON.stringify(input));
          request.end();
        });
        return result;
      },
    };
  }
  const anonymous = client();
  for (let i = 0; i < 100; i++) {
    const response = await anonymous.call('/health/live').catch(() => ({ status: 503 }));
    if (response.status === 200) break;
    if (i === 99) throw new Error(`Next startup failed: ${serverOutput}`);
    await setTimeout(100);
  }
  assert.equal((await anonymous.call('/health/ready')).status, 200);
  assert.match((await anonymous.call('/access')).headers['cache-control'], /no-store/);
  assert.equal((await anonymous.call('/api/session')).status, 401);
  assert.equal((await anonymous.call('/api/staff')).status, 401);
  assert.equal((await anonymous.call('/')).status, 307);
  assert.equal((await anonymous.call('/staff')).status, 307);
  assert.equal(
    (
      await anonymous.call('/api/auth/sign-up/email', {
        email: 'outsider@customer.test',
        password,
        name: 'Customer',
      })
    ).status,
    404,
  );
  assert.equal((await anonymous.call('/api/auth/get-session')).status, 404);
  assert.equal((await anonymous.call('/api/auth/two-factor/disable', { password })).status, 404);
  assert.equal(
    (
      await anonymous.call(
        '/api/auth/sign-in/email',
        { email: bootstrap.email, password },
        { headers: { origin: 'https://evil.test' } },
      )
    ).status,
    403,
  );
  assert.equal(
    (await anonymous.call('/api/staff', {}, { headers: { origin: 'https://evil.test' } })).status,
    403,
  );
  const mailOrigin = `http://127.0.0.1:${mail[8025]}`;
  async function emailLink(to, pattern) {
    for (let i = 0; i < 40; i++) {
      let list;
      try {
        list = await (await fetch(`${mailOrigin}/api/v1/messages`)).json();
      } catch (error) {
        if (error.cause?.code !== 'ECONNREFUSED') throw error;
        await setTimeout(100);
        continue;
      }
      for (const item of list.messages ?? []) {
        if (!item.To?.some((entry) => entry.Address === to)) continue;
        const message = await (await fetch(`${mailOrigin}/api/v1/message/${item.ID}`)).json();
        const link = message.Text?.match(pattern)?.[0];
        if (link) return link;
      }
      await setTimeout(100);
    }
    throw new Error('Expected email not delivered');
  }
  assert.equal(
    (await anonymous.call('/api/auth/send-verification-email', { email: bootstrap.email })).status,
    200,
    'Committed bootstrap must resume verification after delivery configuration is repaired',
  );
  const admin = client();
  assert.notEqual(
    (await admin.call('/api/auth/sign-in/email', { email: bootstrap.email, password })).status,
    200,
    'Unverified staff denied',
  );
  const verify = await emailLink(
    bootstrap.email,
    /https:\/\/[^\s]+\/api\/auth\/verify-email\?[^\s]+/,
  );
  assert.ok((await admin.call(new URL(verify).pathname + new URL(verify).search)).status < 400);
  async function signIn(person, email, password) {
    let response = await person.call('/api/auth/sign-in/email', { email, password });
    if (response.status === 429) {
      const retry = Number(response.headers['retry-after']);
      assert.ok(retry >= 0 && retry <= 60, 'Bounded rate-limit retry required');
      await setTimeout(retry * 1000 + 100);
      response = await person.call('/api/auth/sign-in/email', { email, password });
    }
    assert.equal(response.status, 200, response.text);
    return response;
  }
  async function verifyTotp(person, uri) {
    let response = await person.call('/api/auth/two-factor/verify-totp', { code: totp(uri) });
    if (response.status === 429) {
      const retry = Number(response.headers['retry-after']);
      assert.ok(
        Number.isFinite(retry) && retry >= 0 && retry <= 60,
        'Bounded MFA rate-limit retry required',
      );
      await setTimeout(retry * 1000 + 100);
      response = await person.call('/api/auth/two-factor/verify-totp', { code: totp(uri) });
    }
    return response;
  }
  async function enroll(person, email, pass) {
    const login = await signIn(person, email, pass);
    assert.equal(login.status, 200, login.text);
    assert.ok(!login.text.includes('token'));
    assert.equal(
      (await person.call('/api/session')).status,
      403,
      'Enrollment session cannot read staff',
    );
    const setup = await person.call('/api/auth/two-factor/enable', { password: pass });
    assert.equal(setup.status, 200, setup.text);
    const codes = setup.json();
    const verified = await verifyTotp(person, codes.totpURI);
    assert.equal(verified.status, 200, verified.text);
    assert.ok(!verified.text.includes('token'));
    assert.ok(
      (verified.headers['set-cookie'] ?? []).some(
        (cookie) =>
          cookie.includes('Secure') &&
          cookie.includes('HttpOnly') &&
          cookie.includes('SameSite=Lax'),
      ),
    );
    assert.equal((await person.call('/api/session')).status, 200);
    return codes;
  }
  const adminCodes = await enroll(admin, bootstrap.email, password);
  assert.equal((await admin.call('/')).status, 200);
  assert.equal((await admin.call('/staff')).status, 200);
  const adminId = (await admin.call('/api/session')).json().id;
  const removed = await admin.call(
    '/api/staff',
    { id: adminId, revision: 1, role: 'viewer', active: true, reason: 'last admin test' },
    { method: 'PATCH' },
  );
  assert.equal(removed.status, 409, removed.text);
  const admit = await admin.call('/api/staff', {
    email: 'viewer@thaarei.test',
    name: 'Viewer',
    role: 'viewer',
    reason: 'fixture admission',
  });
  assert.equal(admit.status, 201, admit.text);
  const member = admit.json();
  const viewer = client();
  await viewer.call('/api/auth/send-verification-email', { email: member.email });
  const memberVerify = await emailLink(
    member.email,
    /https:\/\/[^\s]+\/api\/auth\/verify-email\?[^\s]+/,
  );
  await viewer.call(new URL(memberVerify).pathname + new URL(memberVerify).search);
  await viewer.call('/api/auth/request-password-reset', { email: member.email });
  const reset = await emailLink(
    member.email,
    /https:\/\/[^\s]+\/api\/auth\/reset-password\/[^\s]+/,
  );
  // Better Auth's reset link redirects to the fixed screen with its token. Follow manually to keep token out of test output.
  const resetStart = await viewer.call(new URL(reset).pathname + new URL(reset).search);
  const resetUrl = new URL(resetStart.headers.location, origin);
  const resetToken = resetUrl.searchParams.get('token');
  assert.ok(resetToken);
  const viewerPassword = randomBytes(30).toString('base64url');
  assert.equal(
    (
      await viewer.call('/api/auth/reset-password', {
        token: resetToken,
        newPassword: viewerPassword,
      })
    ).status,
    200,
  );
  assert.notEqual(
    (
      await viewer.call('/api/auth/reset-password', {
        token: resetToken,
        newPassword: viewerPassword,
      })
    ).status,
    200,
  );
  const viewerCodes = await enroll(viewer, member.email, viewerPassword);
  await verifyCentralRegistry({
    admin,
    viewer,
    anonymous,
    database,
    runtimeUrl: env.CONTROL_PLANE_DATABASE_URL,
    reauthenticateAdmin: async () => {
      const checked = await verifyTotp(admin, adminCodes.totpURI);
      assert.equal(checked.status, 200, checked.text);
    },
  });
  const moduleCatalogues = await verifyCentralCatalogues({
    admin,
    viewer,
    anonymous,
    database,
    runtimeUrl: env.CONTROL_PLANE_DATABASE_URL,
    origin,
    signEvidence: signModuleEvidence,
    reauthenticateAdmin: async () => {
      const checked = await verifyTotp(admin, adminCodes.totpURI);
      assert.equal(checked.status, 200, checked.text);
    },
  });
  await verifyModuleAssignments({
    verifyIntent: async (token, expected) =>
      verifyInstallationIntent(
        token,
        JSON.parse(await readFile(env.CONTROL_PLANE_PUBLIC_KEYS_OUTPUT_FILE, 'utf8')),
        expected,
      ),
    referenceDirectory: env.CONTROL_PLANE_MODULE_REFERENCE_DIRECTORY,
    signDelivery: (payload, seconds) => signModuleEvidence(payload, seconds, 'delivery'),
    admin,
    viewer,
    anonymous,
    database,
    origin,
    runtimeUrl: env.CONTROL_PLANE_DATABASE_URL,
    signEvidence: signModuleEvidence,
    ...moduleCatalogues,
    reauthenticateAdmin: async () => {
      const checked = await verifyTotp(admin, adminCodes.totpURI);
      assert.equal(checked.status, 200, checked.text);
    },
  });
  await verifyControlPlaneUi({
    admin,
    viewer,
    origin,
    reauthenticateAdmin: async () =>
      assert.equal((await verifyTotp(admin, adminCodes.totpURI)).status, 200),
  });
  const moduleReleaseTrust = JSON.parse(
    await readFile(env.CONTROL_PLANE_MODULE_RELEASE_TRUST_FILE, 'utf8'),
  );
  await verifyModuleMachines({
    admin,
    viewer,
    anonymous,
    database,
    publicTrust,
    releaseTrust: {
      version: 1,
      revision: 1,
      issuer: moduleReleaseTrust.issuer,
      keys: moduleReleaseTrust.keys.map((k) => ({
        kid: k.kid,
        pem: k.publicKey,
        status: 'active',
        lastIssuedAt: null,
      })),
    },
    signDelivery: (payload) => signModuleEvidence(payload, 86400, 'delivery'),
    reauthenticateAdmin: async () => {
      const response = await verifyTotp(admin, adminCodes.totpURI);
      assert.equal(response.status, 200, response.text);
    },
  });
  await verifyModuleTransitions({
    admin,
    viewer,
    anonymous,
    database,
    referenceDirectory: env.CONTROL_PLANE_MODULE_REFERENCE_DIRECTORY,
    signEvidence: signModuleEvidence,
    reauthenticateAdmin: async () =>
      assert.equal((await verifyTotp(admin, adminCodes.totpURI)).status, 200),
    reauthenticateViewer: async () =>
      assert.equal((await verifyTotp(viewer, viewerCodes.totpURI)).status, 200),
  });
  if (cutoverFixture) {
    assert.ok(containerQualification, 'Actual cutover needs canonical central ingress');
    const control = await moduleCutoverControl({
      fixture: cutoverFixture,
      admin,
      origin,
      publicTrust,
      temporary,
      referenceDirectory: env.CONTROL_PLANE_MODULE_REFERENCE_DIRECTORY,
      signEvidence: signModuleEvidence,
      reauthenticateAdmin: async () =>
        assert.equal((await verifyTotp(admin, adminCodes.totpURI)).status, 200),
      run,
      centralIngress: `${name}-ingress`,
    });
    try {
      console.log(
        await run(
          process.execPath,
          ['scripts/test-auth-database.mjs', '--browser', '--module-cutover'],
          {
            env: {
              ...env,
              MOD_I08_CONTROL_FILE: control.file,
              MOD_I08_SELECTED_FIXTURE: process.env.MOD_I08_SELECTED_FIXTURE,
              AUTH_BROWSER_FULL_IMAGES: 'true',
              AUTH_BROWSER_DMS_IMAGE: 'thaarei-mod-i08-dms:qualification',
              AUTH_BROWSER_API_IMAGE: `sha256:${cutoverFixture.bundles[0].inventory.images.find((i) => i.role === 'turnstile-api').digest}`,
              AUTH_BROWSER_WEB_IMAGE: `sha256:${cutoverFixture.bundles[0].inventory.images.find((i) => i.role === 'turnstile-web').digest}`,
            },
            timeout: 900000,
          },
        ),
      );
    } finally {
      await control.close();
    }
  }
  if (process.env.MOD_I06_SELECTED_FIXTURE) {
    assert.ok(
      containerQualification,
      'Selected image qualification requires real container ingress',
    );
    await verifyInstalledModuleDecisions({
      fixture: JSON.parse(await readFile(process.env.MOD_I06_SELECTED_FIXTURE, 'utf8')),
      admin,
      anonymous,
      database,
      publicTrust,
      temporary,
      env,
      run,
      origin,
      postgres: `${name}-postgres`,
      network: name,
      reauthenticateAdmin: async () => {
        const checked = await verifyTotp(admin, adminCodes.totpURI);
        assert.equal(checked.status, 200, checked.text);
      },
      dropRotation: () => updateFault('rotation', true),
      dropReport: () => updateFault('report', true),
      centralUnavailable: async (operation) => {
        updateFault('unavailable', true);
        try {
          return await operation();
        } finally {
          updateFault('unavailable', false);
        }
      },
    });
  }
  if (installationFixture)
    await verifyInstallationHandover({
      fixture: installationFixture,
      admin,
      anonymous,
      origin,
      publicTrust,
      temporary,
      referenceDirectory: env.CONTROL_PLANE_MODULE_REFERENCE_DIRECTORY,
      signEvidence: signModuleEvidence,
      reauthenticateAdmin: async () =>
        assert.equal((await verifyTotp(admin, adminCodes.totpURI)).status, 200),
      run,
      centralIngress: `${name}-ingress`,
      mailContainer: `${name}-mail`,
      mailUrl: `http://127.0.0.1:${mail[8025]}`,
      services,
    });
  if (preparationFixture)
    await verifyCombinedPreparation({
      admin,
      anonymous,
      origin,
      fixture: preparationFixture,
      temporary,
      run,
      referenceDirectory: env.CONTROL_PLANE_MODULE_REFERENCE_DIRECTORY,
      publicTrust: JSON.parse(await readFile(env.CONTROL_PLANE_PUBLIC_KEYS_OUTPUT_FILE, 'utf8')),
      signEvidence: signModuleEvidence,
      reauthenticateAdmin: async () => {
        const response = await verifyTotp(admin, adminCodes.totpURI);
        assert.equal(response.status, 200, response.text);
      },
    });
  await verifyCentralMachines({
    admin,
    viewer,
    anonymous,
    database,
    publicTrust,
    temporary,
    origin,
    runtimeUrl: env.CONTROL_PLANE_DATABASE_URL,
    markerFile: env.CONTROL_PLANE_RECOVERY_MARKER_FILE,
    verifyOffline: async (state, binding) =>
      verifyOfflineImage({
        image: process.env.DMS_CONTROL_TEST_IMAGE,
        run,
        temporary,
        signerFile: env.CONTROL_PLANE_SIGNING_KEY_FILE,
        state,
        binding,
        trust: publicTrust,
      }),
    backup: () =>
      run('docker', [
        'exec',
        `${name}-postgres`,
        'pg_dump',
        '-U',
        'postgres',
        '-d',
        'central_fixture',
        '--schema=control_plane',
        '--clean',
        '--if-exists',
      ]),
    restore: async (sql) => {
      const child = spawn(
        'docker',
        [
          'exec',
          '-i',
          `${name}-postgres`,
          'psql',
          '-X',
          '-v',
          'ON_ERROR_STOP=1',
          '-U',
          'postgres',
          '-d',
          'central_fixture',
        ],
        { stdio: ['pipe', 'ignore', 'ignore'] },
      );
      child.stdin.end(sql);
      assert.equal(
        await new Promise((resolve) => child.once('close', resolve)),
        0,
        'Disposable central schema restore failed',
      );
    },
    reconcile: async () => {
      const child = spawn(
        process.execPath,
        ['--conditions=react-server', 'src/server/machine-operator.ts'],
        { cwd: app, env, stdio: ['pipe', 'ignore', 'ignore'] },
      );
      child.stdin.end(
        JSON.stringify({
          action: 'reconcile',
          reason: 'TCP-I08 isolated pre-denial backup recovery; independent evidence unavailable',
        }),
      );
      assert.equal(
        await new Promise((resolve) => child.once('close', resolve)),
        0,
        'Private authority reconciliation failed',
      );
    },
  });
  if (cutoverFixture) {
    const probe = JSON.parse(
      await readFile(join(cutoverFixture.runDirectory, 'central-restore-probe.json'), 'utf8'),
    );
    const response = await anonymous.call(
      '/api/machine/v1/sync',
      {
        version: 2,
        reportId: randomUUID(),
        binding: probe.binding,
        epoch: probe.epoch,
        applied: null,
        installed: probe.installed,
      },
      { headers: { authorization: `Bearer ${probe.secret}` } },
    );
    assert.equal(
      response.status,
      401,
      'Central recovery must retire the actual customer module credential',
    );
    const saved = (
      await database.query(
        'SELECT minimum_version FROM control_plane.module_authority WHERE product_id=$1',
        [probe.binding.productId],
      )
    ).rows[0];
    assert.equal(saved.minimum_version, 2);
    console.log(
      'Actual module-managed customer remained fenced after central restore with missing independent evidence; its v2 floor persisted and restored receipts could not renew its retired credential.',
    );
  }
  async function verifyCustomer(label, customerContainers = containerQualification) {
    const customerTemporary = join(temporary, label);
    await mkdir(customerTemporary, { mode: 0o700 });
    // The fixture CA remains owned by the central ingress; customer state/roles live in a different cluster.
    await writeFile(join(customerTemporary, 'cert.pem'), ca, { mode: 0o600 });
    let customerNetwork = name;
    if (customerContainers) {
      customerNetwork = `${name}-${label}`;
      await run('docker', ['network', 'create', customerNetwork]);
      customerNetworks.push(customerNetwork);
      await run('docker', [
        'network',
        'connect',
        '--alias',
        'central.fixture.test',
        customerNetwork,
        `${name}-ingress`,
      ]);
    }
    let customerEnv = env,
      customerPostgres = `${name}-postgres`;
    if (qualifyTwoClients) {
      const customerPorts = await docker(
        `${label}-postgres`,
        services.postgres.image,
        [5432],
        ['--tmpfs', '/var/lib/postgresql:rw,size=1g', '-e', 'POSTGRES_PASSWORD'],
        customerNetwork,
      );
      customerPostgres = `${name}-${label}-postgres`;
      customerEnv = {
        ...env,
        CONTROL_PLANE_PROVISION_DATABASE_URL: `postgresql://postgres:${env.POSTGRES_PASSWORD}@127.0.0.1:${customerPorts[5432]}/postgres`,
      };
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          await run('docker', [
            'exec',
            customerPostgres,
            'pg_isready',
            '-h',
            '127.0.0.1',
            '-U',
            'postgres',
          ]);
          break;
        } catch {
          await setTimeout(100);
        }
      }
    }
    if (customerContainers && !qualifyTwoClients)
      await run('docker', ['network', 'connect', customerNetwork, customerPostgres]);
    const sharedInstallation = await verifyDmsCentralHttp({
      containerQualification: customerContainers,
      signerFile: env.CONTROL_PLANE_SIGNING_KEY_FILE,
      qualifyRecovery: qualifyTwoClients,
      admin,
      origin,
      publicTrust,
      temporary: customerTemporary,
      env: customerEnv,
      run,
      freePort,
      network: customerNetwork,
      postgres: customerPostgres,
      dropReport: () => {
        dropMachineReport = true;
        if (containerQualification) updateFault('report', true);
      },
      dropRotation: () => {
        dropMachineRotation = true;
        if (containerQualification) updateFault('rotation', true);
      },
      centralUnavailable: async (operation) => {
        const live = upstream;
        upstream = 1;
        if (containerQualification) updateFault('unavailable', true);
        try {
          return await operation();
        } finally {
          upstream = live;
          if (containerQualification) updateFault('unavailable', false);
        }
      },
    });
    await verifyTurnstileCentralHttp({
      containerQualification: customerContainers,
      signerFile: env.CONTROL_PLANE_SIGNING_KEY_FILE,
      qualifyRecovery: qualifyTwoClients,
      installationBinding: sharedInstallation,
      admin,
      origin,
      publicTrust,
      temporary: customerTemporary,
      env: customerEnv,
      run,
      freePort,
      network: customerNetwork,
      postgres: customerPostgres,
      dropReport: () => {
        dropMachineReport = true;
        if (containerQualification) updateFault('report', true);
      },
      dropRotation: () => {
        dropMachineRotation = true;
        if (containerQualification) updateFault('rotation', true);
      },
      centralUnavailable: async (operation) => {
        const live = upstream;
        upstream = 1;
        if (containerQualification) updateFault('unavailable', true);
        try {
          return await operation();
        } finally {
          upstream = live;
          if (containerQualification) updateFault('unavailable', false);
        }
      },
    });
    return JSON.parse(await readFile(join(customerTemporary, 'dms-private/product.json'), 'utf8'));
  }
  // The module cutover already qualifies its actual selected API/web/reporter. Its
  // separate v1 compatibility fixture uses source, never a downgraded selected image.
  // The complete TCP image qualifier still supplies both legacy candidate images.
  const compatibilityContainers = containerQualification && !cutoverFixture && !installationFixture;
  if (cutoverFixture || installationFixture)
    console.log(
      'Separate legacy v1 compatibility uses source; selected customer containers were qualified above.',
    );
  const customerA = await verifyCustomer('customer-a', compatibilityContainers);
  if (qualifyTwoClients) {
    const customerB = await verifyCustomer('customer-b', compatibilityContainers);
    for (const [one, other] of [
      [customerA, customerB],
      [customerB, customerA],
    ]) {
      const machineHeaders = { headers: { authorization: `Bearer ${one.current.secret}` } };
      assert.equal(
        (
          await anonymous.call(
            `/api/reports?clientId=${other.binding.clientId}`,
            undefined,
            machineHeaders,
          )
        ).status,
        401,
        'Machine credentials cannot read staff customer reports',
      );
      assert.equal(
        (
          await anonymous.call(
            '/api/registry',
            {
              requestId: randomUUID(),
              reason: 'Cross-customer machine authority challenge',
              type: 'product.policy',
              id: other.binding.productId,
              revision: 1,
              decision: 'approve',
              licenceExpiresAt: fixtureLicenceEnd,
            },
            machineHeaders,
          )
        ).status,
        401,
        'Machine credentials cannot approve another product',
      );
      const crossed = await anonymous.call(
        '/api/machine/v1/sync',
        {
          version: 1,
          reportId: randomUUID(),
          binding: other.binding,
          report: {
            product: 'dms',
            observedAt: new Date().toISOString(),
            buildVersion: 'tcp-i08',
            processingReady: false,
            pendingJobs: 0,
            failedJobs: 0,
            outbox: 0,
            storageFreeBytes: null,
            scratchFreeBytes: null,
            reportEpoch: one.current.epoch,
            sequence: 1,
          },
          epoch: one.current.epoch,
          applied: null,
        },
        { headers: { authorization: `Bearer ${one.current.secret}` } },
      );
      await assert.rejects(
        verifyDecision(
          one.decision.accepted.token,
          other.binding,
          other.current.epoch,
          publicTrust,
          Math.floor(Date.now() / 1000),
        ),
        'A real customer grant cannot authorize another installation',
      );
      assert.equal(
        crossed.status,
        409,
        'One real customer credential cannot submit another customer binding',
      );
    }
    console.log(
      'Two separate customer PostgreSQL clusters/product registrations passed cross-client machine binding denial. Container ingress/two-host target acceptance remains separate.',
    );
  }
  assert.equal((await viewer.call('/api/staff')).status, 403);
  assert.equal(
    (
      await viewer.call('/api/staff', {
        email: 'denied@thaarei.test',
        name: 'Denied',
        role: 'admin',
        reason: 'bypass',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await viewer.call(
        '/api/staff',
        { id: adminId, revision: 1, role: 'viewer', active: false, reason: 'bypass' },
        { method: 'PATCH' },
      )
    ).status,
    403,
  );
  // Keep the native cookie alive while changing membership to prove authorization is live.
  await database.query("UPDATE control_plane.staff SET role='admin' WHERE user_id=$1", [member.id]);
  assert.equal((await viewer.call('/api/staff')).status, 200);
  const concurrent = await Promise.all([
    admin.call(
      '/api/staff',
      {
        id: adminId,
        revision: 1,
        role: 'viewer',
        active: true,
        reason: 'concurrent self demotion',
      },
      { method: 'PATCH' },
    ),
    viewer.call(
      '/api/staff',
      {
        id: member.id,
        revision: 1,
        role: 'viewer',
        active: true,
        reason: 'concurrent self demotion',
      },
      { method: 'PATCH' },
    ),
  ]);
  assert.deepEqual(concurrent.map((entry) => entry.status).sort(), [200, 409]);
  assert.equal(
    (
      await database.query(
        "SELECT count(*)::int AS count FROM control_plane.staff WHERE role='admin' AND active",
      )
    ).rows[0].count,
    1,
  );
  // Restore the fixture's roles, leaving ordinary production guards enabled.
  await database.query(
    "UPDATE control_plane.staff SET role=CASE WHEN user_id=$1 THEN 'admin' ELSE 'viewer' END",
    [adminId],
  );
  assert.equal(
    (await viewer.call('/api/staff')).status === 403 ||
      (await viewer.call('/api/session')).status === 401,
    true,
  );
  if ((await admin.call('/api/session')).status !== 200) {
    await signIn(admin, bootstrap.email, password);
    assert.equal((await verifyTotp(admin, adminCodes.totpURI)).status, 200);
  }
  if ((await viewer.call('/api/session')).status !== 200) {
    await signIn(viewer, member.email, viewerPassword);
    assert.equal((await verifyTotp(viewer, viewerCodes.totpURI)).status, 200);
  }
  const memberRevision = (
    await database.query('SELECT revision FROM control_plane.staff WHERE user_id=$1', [member.id])
  ).rows[0].revision;
  await database.query(
    "UPDATE control_plane.staff_session SET mfa_at=now()-interval '11 minutes' WHERE session_id IN (SELECT id FROM control_plane.session WHERE user_id=$1)",
    [adminId],
  );
  assert.equal(
    (
      await admin.call('/api/staff', {
        email: 'notfresh@thaarei.test',
        name: 'Denied',
        role: 'viewer',
        reason: 'freshness',
      })
    ).status,
    403,
  );
  assert.equal((await verifyTotp(admin, adminCodes.totpURI)).status, 200);
  assert.equal(
    (
      await admin.call(
        '/api/staff',
        { id: member.id, role: member.role, revision: 99, active: false, reason: 'stale' },
        { method: 'PATCH' },
      )
    ).status,
    409,
  );
  const before = (
    await database.query('SELECT count(*)::int AS count FROM control_plane.staff_audit')
  ).rows[0].count;
  const disabled = await admin.call(
    '/api/staff',
    {
      id: member.id,
      revision: memberRevision,
      role: 'viewer',
      active: false,
      reason: 'fixture disable',
    },
    { method: 'PATCH' },
  );
  assert.equal(disabled.status, 200, disabled.text);
  assert.equal(
    (await viewer.call('/api/reports')).status,
    401,
    'Staff disablement immediately closes reports',
  );
  assert.equal(
    (await viewer.call('/api/session')).status,
    401,
    'Disabled staff old session denied',
  );
  assert.equal(
    (await database.query('SELECT count(*)::int AS count FROM control_plane.staff_audit')).rows[0]
      .count,
    before + 1,
  );
  const logout = await admin.call('/api/auth/sign-out', {});
  assert.equal(logout.status, 200);
  assert.equal((await admin.call('/api/session')).status, 401);
  const login = await signIn(admin, bootstrap.email, password);
  assert.equal(login.json().twoFactorRedirect, true);
  assert.equal((await admin.call('/api/session')).status, 401, 'Password alone cannot bypass MFA');
  assert.equal(
    (
      await admin.call('/api/auth/two-factor/verify-backup-code', {
        code: adminCodes.backupCodes[0],
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await admin.call('/api/auth/two-factor/verify-backup-code', {
        code: adminCodes.backupCodes[0],
      })
    ).status !== 200,
    true,
  );
  assert.equal((await admin.call('/api/session')).status, 200);
  await database.query(
    "UPDATE control_plane.staff_session SET last_seen_at=now()-interval '31 minutes'",
  );
  assert.equal((await admin.call('/api/session')).status, 403);
  assert.equal(
    (await verifyTotp(admin, adminCodes.totpURI)).status,
    401,
    'Idle session cannot reopen with a factor alone',
  );
  const recovered = await operator({
    ...bootstrap,
    action: 'recover',
    reason: 'fixture maintenance recovery',
  });
  assert.equal(recovered.code, 0, recovered.err);
  await enroll(admin, bootstrap.email, password);
  assert.equal((await admin.call('/api/session')).status, 200);
  assert.ok(
    !serverOutput.includes(password) &&
      !serverOutput.includes(viewerPassword) &&
      !serverOutput.includes(env.CONTROL_PLANE_DATABASE_URL),
    'Server output must redact secrets',
  );
  assert.equal(
    (await database.query('SELECT count(*)::int AS count FROM control_plane.rate_limit')).rows[0]
      .count > 0,
    true,
    'Persistent rate limits used',
  );
  // A saturated native budget must reject before SMTP, even when the relay is down.
  // Earlier authentication journeys can leave a budget close to expiry. Start this
  // outage case with a fresh native window before saturating it over real HTTP.
  await database.query('DELETE FROM control_plane.rate_limit');
  const recoveryPaths = ['/api/auth/request-password-reset', '/api/auth/send-verification-email'];
  for (const path of recoveryPaths) {
    let limited = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await anonymous.call(path, { email: 'unknown@thaarei.test' });
      if (response.status === 429) {
        limited = true;
        break;
      }
      assert.equal(response.status, 200, response.text);
    }
    assert.ok(limited, 'Recovery endpoints must have a bounded persistent rate budget');
  }
  await run('docker', ['stop', `${name}-mail`]);
  for (const path of recoveryPaths) {
    assert.equal(
      (await anonymous.call(path, { email: 'unknown@thaarei.test' })).status,
      429,
      'An exhausted budget must not probe an unavailable SMTP relay',
    );
  }
  await database.query('DELETE FROM control_plane.rate_limit');
  for (const path of recoveryPaths) {
    const unavailable = await anonymous.call(path, { email: 'unknown@thaarei.test' });
    assert.equal(unavailable.status, 503, unavailable.text);
    assert.equal(unavailable.json().error, 'Unable to complete authentication');
  }
  assert.equal(
    (await database.query('SELECT sum(count)::int AS count FROM control_plane.rate_limit')).rows[0]
      .count,
    2,
    'Relay failures must still consume the native rate budget',
  );
  assert.ok(viewerCodes.backupCodes.length > 0);
  if (image) {
    serverOutput = await run('docker', ['logs', `${name}-app`]);
    assert.ok(
      !serverOutput.includes(password) && !serverOutput.includes(viewerPassword),
      'Image logs must redact credentials',
    );
  }
  console.log(
    'Central Next HTTP: private bootstrap/admission, verification/reset, mandatory TOTP/backup recovery, live roles, last-admin/audit, idle MFA fencing, secure proxy cookies, CSRF and safe DTO checks passed.',
  );
} catch (error) {
  if (image && containers.includes(`${name}-app`)) {
    const logs = await exec('docker', ['logs', `${name}-app`])
      .then((result) => result.stdout + result.stderr)
      .catch(() => 'Container logs unavailable');
    console.error(logs.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[redacted database URL]'));
  }
  throw error;
} finally {
  if (next && next.exitCode === null) {
    next.kill('SIGTERM');
    await new Promise((done) => next.once('close', done));
  }
  if (proxy) await new Promise((done) => proxy.close(done));
  if (database) await database.end();
  for (const container of containers.reverse())
    await exec('docker', ['rm', '--force', container]).catch(() => {});
  for (const customerNetwork of customerNetworks)
    await exec('docker', ['network', 'rm', customerNetwork]).catch(() => {});
  if (networkCreated) await exec('docker', ['network', 'rm', name]).catch(() => {});
  await rm(temporary, { recursive: true, force: true });
}
