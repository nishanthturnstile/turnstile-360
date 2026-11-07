import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { parse, stringify } from 'yaml';
import { verifyLogPrivacy } from './fixtures/dms-distribution/log-privacy.mjs';
import { qualifyConsumers } from './fixtures/dms-distribution/qualification.mjs';
import { qualifyRecovery } from './fixtures/dms-distribution/recovery.mjs';

// Destructive only to a new, uniquely named fixture project. No host ports are bound.
const bundle = resolve(process.argv[2] ?? '');
const version = JSON.parse(readFileSync(join(bundle, 'RELEASE.json'), 'utf8')).version;
const rollbackIndex = process.argv.indexOf('--rollback-image');
const rollbackImage = rollbackIndex < 0 ? undefined : process.argv[rollbackIndex + 1];
const ocrIndex = process.argv.indexOf('--ocr-fixture');
const ocrFile = ocrIndex < 0 ? undefined : resolve(process.argv[ocrIndex + 1]);
const previousIndex = process.argv.indexOf('--previous-image');
const previousImage = previousIndex < 0 ? undefined : process.argv[previousIndex + 1];
const signaturesIndex = process.argv.indexOf('--signatures-dir');
const signaturesDirectory =
  signaturesIndex < 0 ? undefined : resolve(process.argv[signaturesIndex + 1]);
assert.ok(existsSync(join(bundle, 'images.lock')), 'Supply an assembled distribution bundle');
const evidenceIndex = process.argv.indexOf('--evidence-parent');
const evidenceParent =
  evidenceIndex < 0 ? tmpdir() : resolve(process.argv[evidenceIndex + 1] ?? '');
if (evidenceIndex >= 0) mkdirSync(evidenceParent, { recursive: true, mode: 0o700 });
const root = mkdtempSync(join(evidenceParent, 'dms-i18-qualification-'));
chmodSync(root, 0o700);
const install = join(root, 'install');
cpSync(bundle, install, { recursive: true, filter: (path) => !path.endsWith('/images.tar') });
const fixture = join(install, 'deploy', 'qualification');
mkdirSync(fixture, { mode: 0o700 });
cpSync('scripts/fixtures/dms-distribution', fixture, { recursive: true });
const tls = join(fixture, 'tls');
mkdirSync(tls, { mode: 0o700 });
const suffix = randomBytes(6).toString('hex'),
  network = `dms-i18-ingress-${suffix}`;
const secret = () => randomBytes(30).toString('base64url');
const stateFile = join(install, '.qualification.json');
const state = {
  operatorEmail: 'operator@dms.test',
  operatorPassword: secret(),
  nextPassword: secret(),
  applicationId: randomUUID(),
  scopes: ['dms:capabilities:read', 'dms:documents:read', 'dms:documents:write'],
};
const save = () => writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
const reload = () => Object.assign(state, JSON.parse(readFileSync(stateFile)));
save();
let sequence = 0,
  createdNetwork = false;
async function run(
  command,
  args,
  { input, allowFailure = false, cwd = install, env = process.env } = {},
) {
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (data) => {
      stdout = (stdout + data).slice(-4 * 1024 * 1024);
    });
    child.stderr.on('data', (data) => {
      stderr = (stderr + data).slice(-4 * 1024 * 1024);
    });
    child.on('error', reject);
    child.on('exit', (status) => resolveResult({ status, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(
      input === undefined ? undefined : typeof input === 'string' ? input : JSON.stringify(input),
    );
  });
  writeFileSync(join(root, `${++sequence}.log`), `${result.stdout}\n${result.stderr}`, {
    mode: 0o600,
  });
  if (!allowFailure && result.status !== 0)
    throw new Error(`Fixture step ${sequence} failed; private logs: ${root}`);
  return result;
}
const composeArgs = [
  'compose',
  '--project-directory',
  join(install, 'deploy'),
  '--env-file',
  '.env.dms.compose',
  '-f',
  'deploy/compose.dms-complete.yaml',
];
const compose = (args, options) => run('docker', [...composeArgs, ...args], options);
const dms = (action, input, options = {}) => run('./dms', [action], { input, ...options });
const operator = (action, values = {}) =>
  dms('operator', {
    action,
    operatorEmail: state.operatorEmail,
    operatorPassword: state.operatorPassword,
    ...values,
  });
const application = (input) => dms('application', input);
const driver = (mode, allowFailure = false) =>
  compose(
    [
      '--profile',
      'tools',
      'run',
      '--rm',
      '--no-deps',
      '-T',
      '--user',
      `${process.getuid()}:${process.getgid()}`,
      'dms-maintenance',
      '/fixture/driver.mjs',
      mode,
    ],
    { allowFailure },
  );
async function until(mode, seconds = 180) {
  const deadline = Date.now() + seconds * 1000;
  do {
    if ((await driver(mode, true)).status === 0) {
      reload();
      return;
    }
    await setTimeout(3000);
  } while (Date.now() < deadline);
  throw new Error(`Fixture ${mode} timed out; private logs: ${root}`);
}
try {
  await run('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '2',
    '-subj',
    '/CN=DMS fixture CA',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-addext',
    'keyUsage=critical,keyCertSign,cRLSign',
    '-keyout',
    join(tls, 'ca.key'),
    '-out',
    join(tls, 'ca.crt'),
  ]);
  await run('openssl', [
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-subj',
    '/CN=identity.dms.test',
    '-keyout',
    join(tls, 'key.pem'),
    '-out',
    join(tls, 'server.csr'),
  ]);
  writeFileSync(
    join(tls, 'extensions'),
    'subjectAltName=DNS:identity.dms.test,DNS:files.dms.test,DNS:mail.dms.test\nextendedKeyUsage=serverAuth\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\n',
  );
  await run('openssl', [
    'x509',
    '-req',
    '-days',
    '2',
    '-in',
    join(tls, 'server.csr'),
    '-CA',
    join(tls, 'ca.crt'),
    '-CAkey',
    join(tls, 'ca.key'),
    '-CAcreateserial',
    '-extfile',
    join(tls, 'extensions'),
    '-out',
    join(tls, 'cert.pem'),
  ]);
  // Only disposable fixture certificates are readable by the nonroot mail/proxy users.
  chmodSync(join(tls, 'key.pem'), 0o444);
  await run('docker', ['network', 'create', network]);
  createdNetwork = true;
  await dms('init', {
    authorityOrigin: 'https://identity.dms.test',
    transferOrigin: 'https://files.dms.test',
    customerKey: `qualification-${suffix}`,
    ingressNetwork: network,
    smtp: { host: 'mail.dms.test', port: 1025, mode: 'starttls', from: 'dms@dms.test' },
  });
  const caVolume = './qualification/tls/ca.crt:/fixture/ca.crt:ro';
  const services = {
    mailpit: {
      image:
        'axllent/mailpit:v1.33.0@sha256:9b3a463be15354c0f0eba91697d80e3e0d8a5623ef0e627cacc836bc17fd5231',
      environment: {
        MP_QUIET: 'true',
        MP_MAX_MESSAGES: '50',
        MP_SMTP_TLS_CERT: '/tls/cert.pem',
        MP_SMTP_TLS_KEY: '/tls/key.pem',
        MP_SMTP_REQUIRE_STARTTLS: 'true',
      },
      volumes: [
        './qualification/tls/cert.pem:/tls/cert.pem:ro',
        './qualification/tls/key.pem:/tls/key.pem:ro',
      ],
      networks: { default: { aliases: ['mail.dms.test'] } },
    },
    'fixture-ingress': {
      image: `thaarei-dms-api:${version}`,
      command: ['node', '/fixture/proxy.mjs'],
      volumes: [
        './qualification/proxy.mjs:/fixture/proxy.mjs:ro',
        './qualification/tls/cert.pem:/tls/cert.pem:ro',
        './qualification/tls/key.pem:/tls/key.pem:ro',
      ],
      networks: {
        ingress: { aliases: ['identity.dms.test', 'files.dms.test'] },
        'authority-egress': { aliases: ['identity.dms.test', 'files.dms.test'] },
      },
    },
  };
  for (const name of ['dms-api', 'coordinator', 'dms-maintenance'])
    services[name] = {
      environment: { NODE_EXTRA_CA_CERTS: '/fixture/ca.crt' },
      volumes: [caVolume],
    };
  for (const name of ['dms-api', 'coordinator', 'dms-maintenance']) {
    Object.assign(services[name].environment, {
      CONTROL_PLANE_ORIGIN: 'https://central.fixture.test',
      CONTROL_PLANE_VERIFICATION_KEYS_FILE: '/fixture-policy/trust.json',
      CONTROL_PLANE_RECOVERY_MARKER_FILE: '/fixture-policy/marker',
    });
    services[name].volumes.push(
      './qualification/policy/trust.json:/fixture-policy/trust.json:ro',
      './qualification/policy/marker:/fixture-policy/marker:ro',
    );
  }
  mkdirSync(join(fixture, 'policy'), { mode: 0o700 });
  for (const file of ['trust.json', 'marker'])
    writeFileSync(join(fixture, 'policy', file), '', { mode: 0o600 });
  services['dms-maintenance'].volumes.push(
    './qualification/deployment.mjs:/app/qualification-deployment.mjs:ro',
  );
  services.coordinator.volumes.push(
    './qualification/observe.mjs:/app/qualification-observe.mjs:ro',
  );
  services['dms-maintenance'].volumes.push('./qualification/driver.mjs:/fixture/driver.mjs:ro');
  for (const name of ['work-publisher', 'scan-worker', 'extract-worker', 'heavy-worker'])
    services[name] = { environment: { SSL_CERT_FILE: '/fixture/ca.crt' }, volumes: [caVolume] };
  const writeOverlay = () => writeFileSync(join(fixture, 'compose.yaml'), stringify({ services }));
  if (previousImage) {
    services['dms-api'].image = previousImage;
  }
  writeOverlay();
  for (const name of ['compose.dms-complete.yaml', 'compose.dms-complete-structured.yaml']) {
    const path = join(install, 'deploy', name),
      document = parse(readFileSync(path, 'utf8'));
    document.include[0].path.push('qualification/compose.yaml');
    writeFileSync(path, stringify(document));
  }
  await dms('config');
  await dms('verify');
  await dms('provision');
  if (previousImage) {
    services['dms-maintenance'].image = previousImage;
    writeOverlay();
  }
  await dms('migrate');
  await dms('storage-init');
  console.log('Fresh private database, migrations and storage initialization passed');
  await compose(['up', '-d', '--no-build', 'mailpit', 'fixture-ingress', 'dms-api']);
  await until(previousImage ? 'foundation' : 'unready');
  await driver('discovery');
  await dms('provision-user', {
    email: state.operatorEmail,
    password: state.operatorPassword,
    role: 'admin',
    name: 'Distribution fixture operator',
  });
  await driver('verify');
  await dms('bootstrap-operator', {
    action: 'bootstrap',
    operatorEmail: state.operatorEmail,
    operatorPassword: state.operatorPassword,
  });
  for (const role of ['publisher', 'scanner', 'extractor', 'heavy']) {
    const file = `.credentials-${role}.json`;
    await dms('authority-client', {
      action: 'issue',
      kind: `work_${role}`,
      scopes: [
        {
          publisher: 'dms:work:publish',
          scanner: 'dms:work:scan',
          extractor: 'dms:work:extract',
          heavy: 'dms:work:heavy',
        }[role],
      ],
      clientId: `work-${role}`,
      applicationId: randomUUID(),
      operatorEmail: state.operatorEmail,
      operatorPassword: state.operatorPassword,
      credentialFile: `/configuration/${file}`,
    });
    await operator('work-authorize', { clientId: `work-${role}`, role });
    const credentials = JSON.parse(readFileSync(join(install, file)));
    const path = join(install, `.env.work-${role}`);
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace(
        /^DMS_WORK_CLIENT_SECRET=.*$/m,
        `DMS_WORK_CLIENT_SECRET=${credentials.clientSecret}`,
      ),
      { mode: 0o600 },
    );
  }
  await dms('authority-client', {
    action: 'issue',
    kind: 'machine',
    clientId: 'distribution-consumer',
    applicationId: state.applicationId,
    scopes: state.scopes,
    operatorEmail: state.operatorEmail,
    operatorPassword: state.operatorPassword,
    credentialFile: '/configuration/.credentials-consumer.json',
  });
  state.consumer = JSON.parse(readFileSync(join(install, '.credentials-consumer.json')));
  save();
  await application({
    action: 'register',
    applicationId: state.applicationId,
    clientId: state.consumer.clientId,
    name: 'Distribution fixture',
    scopes: state.scopes,
    operatorEmail: state.operatorEmail,
    operatorPassword: state.operatorPassword,
  });
  await application({
    action: 'issue-key',
    applicationId: state.applicationId,
    credentialFile: '/configuration/.enrollment.json',
  });
  state.enrollment = JSON.parse(readFileSync(join(install, '.enrollment.json')));
  save();
  console.log(
    'Canonical TLS issuer, private routes, Mailpit STARTTLS verification and private identity provisioning passed',
  );
  if (previousImage) {
    await driver('enroll');
    reload();
    const previousKid = state.kid;
    services['dms-api'].image = `thaarei-dms-api:${version}`;
    services['dms-maintenance'].image = `thaarei-dms-api:${version}`;
    writeOverlay();
    await dms('migrate');
    await compose([
      '--profile',
      'tools',
      'run',
      '--rm',
      '--no-deps',
      '-T',
      '--user',
      `${process.getuid()}:${process.getgid()}`,
      'dms-maintenance',
      '/app/qualification-deployment.mjs',
    ]);
    await compose(['up', '-d', '--no-build', 'dms-api']);
    await until('unready');
    await driver('refresh');
    reload();
    assert.equal(state.kid, previousKid, 'Upgrade changed signing-key identity');
    console.log(
      'Upgrade retained authority identity, signing keys, operator/work grants and enrolled consumer',
    );
  }
  if (!previousImage) {
    await compose([
      '--profile',
      'tools',
      'run',
      '--rm',
      '--no-deps',
      '-T',
      '--user',
      `${process.getuid()}:${process.getgid()}`,
      'dms-maintenance',
      '/app/qualification-deployment.mjs',
    ]);
  }
  // Real signed scanner databases only; no permissive daemon or mocked clean result.
  const incoming = join(install, 'signatures-incoming');
  mkdirSync(incoming, { mode: 0o777 });
  chmodSync(incoming, 0o777);
  if (signaturesDirectory) {
    for (const name of ['main.cvd', 'daily.cvd', 'bytecode.cvd'])
      cpSync(join(signaturesDirectory, name), join(incoming, name));
  } else
    await run('docker', [
      'run',
      '--rm',
      '--user',
      'clamav',
      '--mount',
      `type=bind,src=${incoming},dst=/signatures`,
      '--entrypoint',
      'freshclam',
      `thaarei-dms-bundled-scanner:${version}`,
      '--stdout',
      '--datadir=/signatures',
      '--no-dns',
      '--checks=1',
    ]);
  const { createHash } = await import('node:crypto');
  const sums = ['main.cvd', 'daily.cvd', 'bytecode.cvd']
    .map(
      (name) =>
        `${createHash('sha256')
          .update(readFileSync(join(incoming, name)))
          .digest('hex')}  ${name}`,
    )
    .join('\n');
  writeFileSync(join(incoming, 'SHA256SUMS'), `${sums}\n`, { mode: 0o644 });
  await compose(['--profile', 'tools', 'run', '--rm', '--no-deps', 'signature-import']);
  const link = () =>
    compose([
      '--profile',
      'tools',
      'run',
      '--rm',
      '--no-deps',
      '--entrypoint',
      '/bin/sh',
      'signature-import',
      '-ec',
      'readlink /var/lib/clamav/current',
    ]);
  const before = (await link()).stdout.trim();
  writeFileSync(join(incoming, 'SHA256SUMS'), `${sums.replace(/^[a-f0-9]{64}/, '0'.repeat(64))}\n`);
  assert.notEqual(
    (
      await compose(['--profile', 'tools', 'run', '--rm', '--no-deps', 'signature-import'], {
        allowFailure: true,
      })
    ).status,
    0,
    'Corrupt signature manifest accepted',
  );
  assert.equal(
    (await link()).stdout.trim(),
    before,
    'Rejected signature import changed active set',
  );
  writeFileSync(join(incoming, 'SHA256SUMS'), `${sums}\n`);
  await dms('up');
  await until('ready', 300);
  await dms('signatures-online');
  await setTimeout(6000);
  const updater = (
    await compose(['--profile', 'signature-updates', 'ps', '-q', 'signature-updater'])
  ).stdout.trim();
  const updaterState = JSON.parse((await run('docker', ['inspect', updater])).stdout)[0];
  assert.equal(updaterState.State.Running, true, 'Read-only online updater did not remain running');
  assert.equal(updaterState.RestartCount, 0, 'Online updater crashed during startup');
  await compose(['--profile', 'signature-updates', 'stop', 'signature-updater']);
  await operator('admission-policy-set', {
    expectedRevision: '0',
    policy: {
      enabled: true,
      storageBudgetBytes: 1073741824,
      applicationBudgetBytes: 536870912,
      scratchBudgetBytes: 4294967296,
      maxFileBytes: 52428800,
      activePerApplication: 4,
      activePerTenant: 16,
      queuedWork: 100,
      profiles: ['secure-only', 'searchable', 'structured'],
      contentTypes: [
        'text/plain',
        'text/csv',
        'application/pdf',
        'image/png',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.oasis.opendocument.text',
        'application/vnd.oasis.opendocument.presentation',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel.sheet.binary.macroenabled.12',
        'application/vnd.oasis.opendocument.spreadsheet',
        'application/vnd.ms-outlook',
        'message/rfc822',
        'application/rtf',
      ],
    },
  });
  await driver('golden');
  reload();
  await until('available', 300);
  console.log(
    'Offline signature import, processing readiness and canonical HTTPS golden document passed',
  );
  if (rollbackImage) {
    const before = state.kid;
    services['dms-api'].image = rollbackImage;
    writeOverlay();
    await compose(['up', '-d', '--no-build', 'dms-api']);
    await until('ready', 180);
    await driver('refresh');
    reload();
    await driver('available');
    assert.equal(state.kid, before, 'Application rollback changed signing identity');
    services['dms-api'].image = `thaarei-dms-api:${version}`;
    writeOverlay();
    await compose(['up', '-d', '--no-build', 'dms-api']);
    await until('ready', 180);
    await driver('refresh');
    reload();
    await driver('available');
    console.log(
      'Compatible application rollback/forward preserves current original, identity and enrollment',
    );
  }
  if (process.argv.includes('--qualification'))
    await qualifyConsumers({
      root,
      install,
      network,
      version,
      state,
      run,
      compose,
      dms,
      application,
      ocrFile,
    });
  if (process.argv.includes('--recovery')) {
    await qualifyRecovery({
      interruptCapture: process.argv.includes('--recovery-interrupt'),
      root,
      install,
      bundle,
      network,
      state,
      run,
      compose,
      dms,
      driver,
      until,
    });
    await until('ready', 300);
  }
  await compose(['restart', 'coordinator', 'work-broker', 'work-publisher']);
  await until('ready', 180);
  await driver('refresh');
  await driver('available');
  await compose(['stop', '-t', '15', 'heavy-worker']);
  await until('unready', 120);
  await driver('available');
  await compose(['up', '-d', '--no-build', 'heavy-worker']);
  await until('ready', 180);
  if (
    readFileSync(join(install, 'images.lock'), 'utf8').includes(
      'thaarei-dms-processing-structured:',
    )
  ) {
    writeFileSync(join(install, '.dms-profile'), 'structured\n', { mode: 0o600 });
    await dms('up');
    await until('ready', 300);
    await driver('refresh');
    const policyRead = await operator('admission-policy-read');
    assert.ok(
      JSON.parse(policyRead.stdout.trim().split('\n').at(-1)).effective.profiles.includes(
        'structured',
      ),
      'Private operator lacks installed structure profile',
    );
    await driver('structured');
    reload();
    await until('structured-result', 600);
    writeFileSync(join(install, '.dms-profile'), 'standard\n', { mode: 0o600 });
    await dms('up');
    await until('ready', 300);
    await driver('refresh');
    await driver('profile-off');
    console.log('Optional structured profile on/off and immutable accepted content passed');
  }
  await operator('operations-inspect');
  await driver('refresh');
  reload();
  const staged = await dms('authority-keys', {
    action: 'stage',
    operatorEmail: state.operatorEmail,
    operatorPassword: state.operatorPassword,
  });
  state.stagedKeyId = JSON.parse(staged.stdout.trim().split('\n').at(-1)).stagedKeyId;
  save();
  await driver('staged-key');
  const activate = {
    action: 'activate',
    keyId: state.stagedKeyId,
    operatorEmail: state.operatorEmail,
    operatorPassword: state.operatorPassword,
  };
  assert.notEqual(
    (await dms('authority-keys', activate, { allowFailure: true })).status,
    0,
    'Premature key activation accepted',
  );
  await setTimeout(60000);
  await dms('authority-keys', activate);
  await driver('new-key');
  reload();
  await driver('recovery');
  reload();
  await operator('operations-inspect');
  state.previousSecret = state.consumer.clientSecret;
  await dms('authority-client', {
    action: 'rotate',
    kind: 'machine',
    clientId: state.consumer.clientId,
    operatorEmail: state.operatorEmail,
    operatorPassword: state.operatorPassword,
    credentialFile: '/configuration/.credentials-consumer-rotated.json',
  });
  state.consumer = JSON.parse(readFileSync(join(install, '.credentials-consumer-rotated.json')));
  save();
  await driver('rotated');
  reload();
  await application({
    action: 'disable',
    applicationId: state.applicationId,
    operatorEmail: state.operatorEmail,
    operatorPassword: state.operatorPassword,
  });
  await driver('revoked');
  const containers = (await compose(['ps', '--format', 'json'])).stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  await verifyLogPrivacy(run, containers.find((container) => container.Service === 'dms-api').ID);
  for (const container of containers) {
    assert.ok(
      !container.Publishers?.some((port) => port.PublishedPort),
      'Unexpected published fixture port',
    );
    if (['mailpit', 'fixture-ingress'].includes(container.Service)) continue;
    const inspected = JSON.parse((await run('docker', ['inspect', container.ID])).stdout)[0];
    if (inspected.Config.Healthcheck && inspected.Config.Healthcheck.Test[0] !== 'NONE')
      assert.equal(
        inspected.State.Health.Status,
        'healthy',
        `${container.Service}: Docker health must match configured readiness`,
      );
    assert.ok(
      inspected.Config.User && !['0', '0:0', 'root'].includes(inspected.Config.User),
      'Root long-running service',
    );
    assert.ok(
      inspected.HostConfig.Memory > 0 && inspected.HostConfig.NanoCpus > 0,
      'Missing resource limits',
    );
  }
  console.log(
    'Service restarts, readiness isolation, signing/credential rotation, revocation and Mailpit recovery passed',
  );
  writeFileSync(
    join(root, 'RESULT.json'),
    JSON.stringify({ passed: true, version, checkedAt: new Date().toISOString() }),
    { mode: 0o600 },
  );
} finally {
  if (existsSync(join(install, '.env.dms.compose')))
    await compose(
      [
        '--profile',
        'tools',
        '--profile',
        'signature-updates',
        'down',
        '-v',
        '--remove-orphans',
        '--timeout',
        '15',
      ],
      { allowFailure: true },
    );
  if (createdNetwork) await run('docker', ['network', 'rm', network], { allowFailure: true });
  console.log(`Private qualification evidence: ${root}`);
}
