import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseDocument } from 'yaml';

const configurations = new Map();
for (const file of [
  'deploy/compose.local.yaml',
  'deploy/compose.dev.yaml',
  'deploy/compose.dokploy.yaml',
  'deploy/compose.mailpit.yaml',
]) {
  const document = parseDocument(readFileSync(file, 'utf8'), { uniqueKeys: true, merge: true });
  assert.equal(document.errors.length, 0, `${file}: invalid YAML`);
  const configuration = document.toJS();
  configurations.set(file, configuration);
  assert.ok(Object.keys(configuration.services).length > 0, `${file}: no services`);
  for (const [name, service] of Object.entries(configuration.services)) {
    if (!service.build) continue;
    const context = resolve(dirname(file), service.build.context);
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
