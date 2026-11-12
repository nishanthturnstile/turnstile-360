// Actual Docker command handlers through a Unix forwarding proxy; faults discard committed responses.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { Docker } from '../packages/installation-engine/dist/docker.js';
import { hash, writeJson } from '../packages/installation-engine/dist/files.js';
import { PrivateJobs } from '../packages/installation-engine/dist/jobs.js';

const root = mkdtempSync(join(tmpdir(), 'installation-jobs-')),
  state = join(root, '.installer'),
  socket = join(root, 'docker.sock');
mkdirSync(state, { mode: 0o700 });
let fault = 'create',
  created = 0,
  started = 0;
const proxy = http.createServer((request, response) => {
  const upstream = http.request(
    {
      socketPath: '/var/run/docker.sock',
      path: request.url,
      method: request.method,
      headers: request.headers,
    },
    (incoming) => {
      const creating =
          request.method === 'POST' && request.url.startsWith('/v1.52/containers/create?'),
        starting = request.method === 'POST' && /\/containers\/[^/]+\/start$/.test(request.url);
      if (creating && incoming.statusCode === 201) created++;
      if (starting && incoming.statusCode === 204) started++;
      if (
        (fault === 'create' && creating && incoming.statusCode === 201) ||
        (fault === 'start' && starting && incoming.statusCode === 204)
      ) {
        fault = null;
        incoming.resume();
        incoming.once('end', () => response.destroy());
        return;
      }
      response.writeHead(incoming.statusCode, incoming.headers);
      incoming.pipe(response);
    },
  );
  upstream.on('error', () => response.destroy());
  request.pipe(upstream);
});
await new Promise((done) => proxy.listen(socket, done));
const docker = new Docker(socket),
  image = process.argv[2];
assert.match(image ?? '', /^sha256:[a-f0-9]{64}$/);
const journal = {
    version: 1,
    engineVersion: '0.1.0',
    releaseDigest: 'a'.repeat(64),
    binding: {},
    settings: {},
    jobs: {},
    phase: 'preparing',
    privateRequest: 'request.json',
  },
  local = randomUUID();
const jobs = new PrivateJobs({
  docker,
  root,
  state,
  network: 'none',
  ingress: 'none',
  uid: process.getuid(),
  gid: process.getgid(),
  local,
  image: () => image,
  journal,
  save: () => writeJson(join(state, 'journal.json'), journal),
  current: async () => {},
});
const input = {
  authorityOrigin: 'https://turnstile.fixture.test',
  resourceOrigin: 'https://dms.fixture.test',
  transferOrigin: 'https://files.fixture.test',
  customerKey: 'private-jobs',
  tenantId: randomUUID(),
  localInstallationId: local,
  combined: true,
  ingressNetwork: 'fixture',
  smtp: { host: 'mailpit', port: 1025, mode: 'starttls', from: 'test@customer.test' },
  browserOrigins: ['https://turnstile.fixture.test'],
};
const entry = 'dist/infrastructure/distribution/initialize.js';
try {
  await assert.rejects(jobs.run('configuration', 'dms-api', entry, [], {}, input));
  assert.equal(created, 1);
  assert.equal(journal.jobs.configuration.phase, 'planned');
  fault = 'start';
  await assert.rejects(jobs.resume());
  assert.equal(created, 1);
  assert.equal(started, 1);
  // Force publication failure after the real initializer has executed; preserve exited container/outcome.
  const path = join(state, 'configuration.output.json');
  mkdirSync(path, { mode: 0o700 });
  await assert.rejects(jobs.resume());
  assert.equal(created, 1);
  assert.equal(started, 1);
  assert.ok(existsSync(join(root, '.env.dms')));
  const before = hash(readFileSync(join(root, '.env.dms')));
  rmSync(path, { recursive: true });
  await jobs.resume();
  assert.equal(journal.jobs.configuration.phase, 'complete');
  assert.equal(journal.jobs.configuration.exitCode, 0);
  await jobs.run('configuration', 'dms-api', entry, [], {}, input);
  assert.equal(created, 1);
  assert.equal(started, 1);
  assert.equal(hash(readFileSync(join(root, '.env.dms'))), before);
  assert.ok(
    !existsSync(join(state, 'configuration.input.json')) &&
      !existsSync(join(state, 'configuration.recipe.json')),
  );
  const obstructed = join(root, '.env.dms-download');
  rmSync(obstructed);
  mkdirSync(obstructed, { mode: 0o700 });
  await assert.rejects(jobs.run('restore-configuration', 'dms-api', entry, [], {}, input));
  assert.equal(journal.jobs['restore-configuration'].exitCode, 1);
  rmSync(obstructed, { recursive: true });
  await jobs.resume();
  assert.equal(journal.jobs['restore-configuration'].attempt, 2);
  assert.equal(hash(readFileSync(join(root, '.env.dms'))), before);
  await assert.rejects(
    jobs.run(
      'role-connect',
      'dms-api',
      'maintenance/provision-auth-database.mjs',
      [],
      parseEnv(readFileSync(join(root, '.env.provision'), 'utf8')),
    ),
  );
  assert.equal(journal.jobs['role-connect'].exitCode, 75);
  assert.equal(journal.jobs['role-connect'].replayable, true);
  await assert.rejects(jobs.resume());
  assert.equal(journal.jobs['role-connect'].attempt, 2);
  console.log(
    'Real Docker lost create/start responses and post-effect output failure resume one owning initializer without duplicate execution or changed secrets.',
  );
} finally {
  for (const job of Object.values(journal.jobs)) {
    const container = await docker.inspect(job.name).catch(() => null);
    if (container && !container.State.Running) await docker.remove(container.Id);
  }
  http.globalAgent.destroy();
  proxy.closeAllConnections();
  proxy.close();
}

// The forwarding adapter has deliberately abandoned sockets after committed effects.
process.exit(0);
