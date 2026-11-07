import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseDocument } from 'yaml';

const configurations = new Map();
for (const file of [
  'deploy/compose.dms.yaml',
  'deploy/compose.dms-complete.yaml',
  'deploy/compose.dms-complete-structured.yaml',
  'deploy/distribution/compose.runtime.yaml',
  'deploy/distribution/compose.structured.yaml',
  'deploy/compose.storage.yaml',
  'deploy/compose.dms-uploads.yaml',
  'deploy/compose.dms-downloads.yaml',
  'deploy/compose.dms-work.yaml',
  'deploy/compose.dms-assessment.yaml',
  'deploy/compose.dms-results.yaml',
  'deploy/compose.dms-structure.yaml',
  'deploy/compose.control-plane.yaml',
  'deploy/compose.dms-control-plane.yaml',
  'deploy/compose.customer-complete.yaml',
  'deploy/compose.dms-activated.yaml',
  'deploy/distribution/compose.turnstile.yaml',
  'deploy/compose.local.yaml',
  'deploy/compose.dev.yaml',
  'deploy/compose.dokploy.yaml',
  'deploy/compose.mailpit.yaml',
]) {
  const document = parseDocument(readFileSync(file, 'utf8'), { uniqueKeys: true, merge: true });
  assert.equal(document.errors.length, 0, `${file}: invalid YAML`);
  const configuration = document.toJS();
  configurations.set(file, configuration);
  if (configuration.include) {
    for (const entry of configuration.include)
      for (const path of entry.path)
        assert.ok(existsSync(resolve(dirname(file), path)), `${file}: missing include`);
    continue;
  }
  assert.ok(Object.keys(configuration.services).length > 0, `${file}: no services`);
  for (const service of Object.values(configuration.services))
    if (Array.isArray(service.env_file))
      service.env_file = service.env_file.map((entry) => {
        if (typeof entry === 'string') return entry;
        assert.equal(entry.format, 'raw');
        return entry.path;
      });
  for (const [name, service] of Object.entries(configuration.services)) {
    if (!service.build) continue;
    const context = resolve(
      file.startsWith('deploy/distribution/') ? 'deploy' : dirname(file),
      service.build.context,
    );
    assert.ok(
      existsSync(resolve(context, service.build.dockerfile)),
      `${name}: missing Dockerfile`,
    );
  }
  console.log(`${file}: YAML and build paths valid`);
}

// These host bindings are reserved for this application; never fall back to another port.
const ports = JSON.parse(readFileSync('deploy/development-ports.json', 'utf8'));
assert.equal(new Set(Object.values(ports)).size, 9, 'Development host ports must be distinct');
const infrastructure = configurations.get('deploy/compose.local.yaml').services;
const applications = configurations.get('deploy/compose.dev.yaml').services;
for (const [service, bindings] of [
  [applications['turnstile-web'], [[ports.web, 5173]]],
  [applications['dms-api'], [[ports.dmsApi, 3001]]],
  [applications['turnstile-api'], [[ports.turnstileApi, 3002]]],
  [infrastructure.postgres, [[ports.postgres, 5432]]],
  [
    infrastructure.mailpit,
    [
      [ports.smtp, 1025],
      [ports.mailpit, 8025],
    ],
  ],
  [
    infrastructure.rabbitmq,
    [
      [ports.amqp, 5672],
      [ports.rabbitmq, 15672],
    ],
  ],
  [infrastructure.seaweedfs, [[ports.s3, 8333]]],
]) {
  for (const [host, internal] of bindings) {
    assert.ok(host >= 23600 && host <= 23608, 'Use the reserved Turnstile development range');
    assert.notEqual(host, internal, 'Do not publish a service on its default port');
  }
  assert.deepEqual(
    service.ports,
    bindings.map(([host, internal]) => `127.0.0.1:${host}:${internal}`),
  );
}
console.log('Fixed local host bindings 23600–23608 match the reserved development ports');

assert.deepEqual(
  configurations.get('deploy/compose.mailpit.yaml').services.mailpit.ports,
  [`127.0.0.1:${ports.mailpit}:8025`],
  'Pilot inbox must use the same reserved host port',
);

// Development has one public entry point. Production keeps its own isolated images.
const root = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(root.scripts.dev, 'docker compose up --build --watch');
for (const command of ['dev:auth', 'dev:dms', 'dev:turnstile', 'infra:up', 'infra:down'])
  assert.ok(!(command in root.scripts), `Obsolete development command: ${command}`);
for (const file of [
  'scripts/dev-auth.mjs',
  'scripts/dev.mjs',
  'scripts/dev-supervisor.mjs',
  'apps/dms-api/turbo.json',
  'apps/turnstile-api/turbo.json',
  'apps/turnstile-web/.env.example',
])
  assert.ok(!existsSync(file), `Obsolete development configuration: ${file}`);
const turbo = JSON.parse(readFileSync('turbo.json', 'utf8'));
assert.ok(!turbo.tasks.dev, 'Compose must own development watching');
for (const name of ['dms-api', 'turnstile-api']) {
  const manifest = JSON.parse(readFileSync(`apps/${name}/package.json`, 'utf8'));
  assert.ok(!manifest.scripts.dev, `${name}: no independent host watcher`);
}
const defaults = parseDocument(readFileSync('compose.yaml', 'utf8'), {
  uniqueKeys: true,
  merge: true,
});
assert.equal(defaults.errors.length, 0, 'Invalid default Compose configuration');
assert.equal(defaults.toJS().name, 'turnstile-local', 'Preserve the local data project');
assert.deepEqual(defaults.toJS().include, [
  { path: ['./deploy/compose.local.yaml', './deploy/compose.dev.yaml'] },
]);
const production = configurations.get('deploy/compose.dokploy.yaml').services;
for (const name of ['dms-api', 'turnstile-api', 'turnstile-web']) {
  assert.equal(applications[name].build.dockerfile, 'deploy/Dockerfile.dev');
  assert.equal(production[name].build.dockerfile, `apps/${name}/Dockerfile`);
  assert.ok(!production[name].develop, `${name}: production must not watch development files`);
  assert.ok(!production[name].ports, `${name}: Dokploy owns production ingress`);
  assert.ok(
    !production[name].environment?.DEV_CONTAINER,
    `${name}: no development entry point in production`,
  );
}
console.log('Single Compose development entry and separate production deployment paths validated');

const standalone = configurations.get('deploy/compose.dms.yaml').services;
assert.deepEqual(Object.keys(standalone).sort(), ['dms-api', 'postgres']);
assert.equal(standalone['dms-api'].build.context, '..');
assert.equal(standalone['dms-api'].environment.AUTH_MODE, 'standalone');
for (const service of Object.values(standalone)) assert.ok(!service.ports, 'Dokploy owns ingress');
console.log('Standalone foundation has only DMS and PostgreSQL, private service ports');

const storage = configurations.get('deploy/compose.storage.yaml');
assert.deepEqual(Object.keys(storage.services).sort(), ['dms-transfer', 'storage']);
for (const service of Object.values(storage.services))
  assert.ok(!service.ports, 'Storage profile uses private service ports');
assert.equal(storage.networks.storage.internal, true);
assert.deepEqual(storage.services.storage.networks, ['storage']);
assert.deepEqual(storage.services['dms-transfer'].command, ['node', 'dist/main.transfer.js']);
assert.ok(
  !storage.services.storage.env_file,
  'Credential configuration is a private mounted secret',
);
console.log(
  'Secured storage has private S3, loopback internals and a separate credential-free transfer ingress',
);

const uploads = configurations.get('deploy/compose.dms-uploads.yaml');
assert.deepEqual(Object.keys(uploads.services), ['dms-api']);
assert.deepEqual(uploads.services['dms-api'].networks, ['default', 'storage']);
assert.deepEqual(uploads.services['dms-api'].env_file, ['../.env.dms', '../.env.dms-upload']);
assert.equal(uploads.services['dms-api'].ports, undefined);
const signerTemplate = readFileSync('deploy/dms-upload.env.example', 'utf8');
assert.deepEqual(
  signerTemplate
    .split('\n')
    .filter((line) => /^DMS_STORAGE_.*SECRET_ACCESS_KEY=/.test(line))
    .map((line) => line.split('=')[0]),
  ['DMS_STORAGE_UPLOAD_SECRET_ACCESS_KEY'],
);
console.log(
  'Optional upload overlay connects only the API signer to private storage and keeps secrets role-specific',
);

const workProfile = configurations.get('deploy/compose.dms-work.yaml');
assert.equal(workProfile.services['work-broker'].image, infrastructure.rabbitmq.image);
for (const [name, service] of Object.entries(workProfile.services))
  assert.equal(service.ports, undefined, `${name}: work listeners must remain private`);
assert.deepEqual(workProfile.services.coordinator.command, ['node', 'dist/main.coordinator.js']);
for (const name of ['work-publisher', 'scan-worker', 'extract-worker', 'heavy-worker'])
  assert.deepEqual(workProfile.services[name].networks, ['work', 'broker']);
assert.equal(workProfile.networks.work.internal, true);
assert.equal(workProfile.networks.broker.internal, true);
assert.ok(
  readFileSync('deploy/work/rabbitmq.conf', 'utf8').includes('management.tcp.ip = 127.0.0.1'),
);
assert.ok(
  readFileSync('apps/dms-processing/Dockerfile', 'utf8').includes(
    'uv sync --locked --no-dev --no-editable',
  ),
);
console.log(
  'Private coordinator and broker/worker topology, pinned broker and locked processing runtime validated',
);

const assessment = configurations.get('deploy/compose.dms-assessment.yaml');
for (const service of Object.values(assessment.services)) assert.equal(service.ports, undefined);
assert.equal(assessment.networks['dms-scan'].internal, true);
assert.equal(assessment.services['dms-scan'].read_only, true);
assert.ok(assessment.services['dms-scan'].image.includes('@sha256:'));
assert.deepEqual(assessment.services['dms-scan'].networks, ['dms-scan']);
assert.deepEqual(assessment.services['signature-updater'].networks, ['signature-egress']);
console.log('Assessment daemon and signature updater use separate private/outbound networks');

const downloads = configurations.get('deploy/compose.dms-downloads.yaml');
assert.deepEqual(Object.keys(downloads.services), ['dms-api']);
assert.equal(downloads.services['dms-api'].ports, undefined);
assert.deepEqual(downloads.services['dms-api'].env_file, [
  '../.env.dms',
  '../.env.dms-upload',
  '../.env.dms-download',
]);
const readTemplate = readFileSync('deploy/dms-download.env.example', 'utf8');
assert.deepEqual(
  readTemplate
    .split('\n')
    .filter((line) => /^DMS_STORAGE_.*SECRET_ACCESS_KEY=/.test(line))
    .map((line) => line.split('=')[0]),
  ['DMS_STORAGE_ORIGINAL_READ_SECRET_ACCESS_KEY'],
);
console.log('Optional current-original download signer has only its dedicated read credential');

const results = configurations.get('deploy/compose.dms-results.yaml');
assert.deepEqual(Object.keys(results.services), ['dms-api']);
assert.equal(results.services['dms-api'].ports, undefined);
const resultKeys = readFileSync('deploy/dms-results.env.example', 'utf8')
  .split('\n')
  .filter((line) => /^DMS_STORAGE_.*SECRET_ACCESS_KEY=/.test(line))
  .map((line) => line.split('=')[0]);
assert.deepEqual(resultKeys, ['DMS_STORAGE_ARTIFACT_READ_SECRET_ACCESS_KEY']);
const structure = configurations.get('deploy/compose.dms-structure.yaml');
assert.deepEqual(Object.keys(structure.services), ['dms-api', 'coordinator', 'heavy-worker']);
assert.equal(structure.services['heavy-worker'].build.target, 'structured');
assert.equal(structure.services['heavy-worker'].image, 'thaarei-dms-processing-structured:local');
assert.equal(structure.services['heavy-worker'].read_only, true);
assert.equal(structure.services['heavy-worker'].mem_limit, '4096m');
for (const service of Object.values(structure.services)) assert.equal(service.ports, undefined);
console.log(
  'Optional results use only artifact-read signing; structure has a separate opt-in offline heavy image and bounded resources',
);

const complete = configurations.get('deploy/distribution/compose.runtime.yaml');
for (const [name, service] of Object.entries(complete.services)) {
  assert.equal(service.ports, undefined, `${name}: no public host binding`);
  if (!service.profiles) assert.equal(service.logging.options['max-file'], '3');
}
for (const name of ['dms-api', 'coordinator', 'dms-transfer'])
  assert.equal(complete.services[name].image, 'thaarei-dms-api:0.20.0');
assert.equal(complete.services.storage.user, '10001:10001');
assert.equal(complete.services['work-broker'].user, 'rabbitmq');
assert.equal(complete.services['dms-scan'].user, 'clamav');
assert.deepEqual(complete.services['dms-scan'].healthcheck.test, [
  'CMD',
  'clamdscan',
  '--config-file=/etc/clamav/clamd.conf',
  '--ping=1:1',
]);
const completeStructure = configurations.get('deploy/distribution/compose.structured.yaml');
assert.equal(
  completeStructure.services['dms-maintenance'].environment.DMS_STRUCTURE_ENABLED,
  'true',
);
assert.ok(completeStructure.services['heavy-worker'].networks.includes('authority-egress'));
assert.equal(complete.networks.ingress.external, true);
console.log(
  'Complete standalone entry points have versioned images, nonroot services, bounded logs/resources and explicit private bootstrap',
);

const central = configurations.get('deploy/compose.control-plane.yaml');
assert.deepEqual(Object.keys(central.services).sort(), ['control-plane', 'postgres']);
for (const service of Object.values(central.services))
  assert.ok(!service.ports, 'Central production has private ports only');
assert.equal(central.services['control-plane'].build.context, '..');
assert.equal(central.services['control-plane'].read_only, true);
assert.ok(!central.services['control-plane'].environment.CONTROL_PLANE_MIGRATION_DATABASE_URL);
assert.ok(!central.services['control-plane'].environment.CONTROL_PLANE_PUBLIC_KEYS_OUTPUT_FILE);
assert.equal(
  central.services['control-plane'].environment.CONTROL_PLANE_SIGNING_KEY_FILE,
  '/run/secrets/control-plane-signing',
);
assert.equal(
  central.services['control-plane'].environment.CONTROL_PLANE_RECOVERY_MARKER_FILE,
  '/run/secrets/control-plane-recovery',
);
console.log(
  'Central app has isolated persistence, protected secret delivery and no migration runtime credential',
);

const activation = configurations.get('deploy/compose.dms-control-plane.yaml');
assert.ok(!activation.services['dms-api'].environment.CONTROL_PLANE_MACHINE_SECRET_FILE);
assert.ok(
  activation.services.coordinator.volumes.some((v) => v.endsWith(':/run/deployment-private:ro')),
);
assert.ok(
  activation.services['dms-maintenance'].volumes.some((v) =>
    v.endsWith(':/run/deployment-private'),
  ),
);
const combined = configurations.get('deploy/distribution/compose.turnstile.yaml');
assert.equal(combined.services['dms-api'].environment.AUTH_MODE, 'combined');
assert.ok(combined.services['turnstile-api'].environment.IDENTITY_SERVICE_API_URL);
assert.ok(combined.services['turnstile-api'].environment.IDENTITY_SERVICE_RESOURCE_URL);
for (const service of Object.values(combined.services))
  assert.ok(!service.ports, 'Customer ingress belongs to Dokploy');
console.log(
  'Complete combined customer profile preserves DMS authority/private identity and isolates central machine credentials',
);

const turnstileControl = parseDocument(
  readFileSync('deploy/compose.turnstile-control-plane.yaml', 'utf8'),
).toJS();
assert.ok(
  !turnstileControl.services['turnstile-api'].environment
    .TURNSTILE_CONTROL_PLANE_MACHINE_SECRET_FILE,
);
assert.ok(
  turnstileControl.services['turnstile-api'].volumes.every(
    (v) => !v.includes('/run/turnstile-private'),
  ),
);
const reporter = turnstileControl.services['turnstile-reporter'];
assert.ok(reporter.volumes.some((v) => v.endsWith(':/run/turnstile-private:ro')));
assert.deepEqual(reporter.command, ['node', 'dist/main.reporter.js']);
assert.equal(reporter.read_only, true);
assert.ok(reporter.env_file.every((v) => v.path === '../.env.turnstile.reporter'));
assert.ok(
  turnstileControl.services['turnstile-deployment'].volumes.some((v) =>
    v.endsWith(':/run/turnstile-private'),
  ),
);
for (const service of Object.values(turnstileControl.services)) assert.ok(!service.ports);
console.log(
  'Turnstile activation has a separate private reporter, public-only API trust and protected setup mounts',
);
