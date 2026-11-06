import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import fastify from 'fastify';
import { parse } from 'yaml';
import { STORAGE_ROLES } from '../src/modules/storage/storage-configuration.js';
import {
  configureStorage,
  seaweedIdentityConfiguration,
} from '../src/modules/storage/storage-provision.js';
import { mountTransferIngress } from '../src/modules/storage/transfer-ingress.js';

// Real pinned storage for PostgreSQL + authenticated HTTP lifecycle tests. Never uses
// installed credentials/data/ports. Only identity-file paths enter Docker arguments.
export async function uploadStorageFixture() {
  const name = `thaarei-upload-test-${randomBytes(6).toString('hex')}`;
  const root = resolve('../..');
  const folder = await mkdtemp(join(tmpdir(), 'thaarei-upload-'));
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DMS_STORAGE_ENDPOINT: 'http://127.0.0.1:1',
    DMS_STORAGE_PUBLIC_ORIGIN: 'http://127.0.0.1:1',
    DMS_STORAGE_REGION: 'us-east-1',
    DMS_STORAGE_PATH_STYLE: 'true',
    DMS_STORAGE_ALLOW_HTTP: 'true',
    DMS_STORAGE_STAGING_BUCKET: 'dms-staging',
    DMS_STORAGE_ORIGINALS_BUCKET: 'dms-originals',
    DMS_STORAGE_ARTIFACTS_BUCKET: 'dms-artifacts',
    DMS_STORAGE_BROWSER_ORIGINS: '[]',
  };
  for (const role of [...STORAGE_ROLES, 'bootstrap']) {
    const prefix = `DMS_STORAGE_${role.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;
    environment[`${prefix}_ACCESS_KEY_ID`] = randomBytes(12).toString('hex');
    environment[`${prefix}_SECRET_ACCESS_KEY`] = randomBytes(36).toString('base64url');
  }
  const faults = { loseDeleteAck: 0, failHead: 0 };
  let upstream = '';
  const proxy = createServer((req, res) => {
    const original = req.url?.startsWith('/dms-originals/');
    if (original && req.method === 'HEAD' && faults.failHead > 0) {
      faults.failHead--;
      res.writeHead(503);
      res.end();
      req.resume();
      return;
    }
    const lose = original && req.method === 'DELETE' && faults.loseDeleteAck > 0;
    if (lose) faults.loseDeleteAck--;
    const forwarded = request(
      new URL(req.url ?? '/', upstream),
      { method: req.method, headers: req.headers },
      (response) => {
        if (lose) {
          response.resume();
          response.on('end', () => res.destroy());
          return;
        }
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    forwarded.on('error', () => res.destroy());
    req.pipe(forwarded);
  });
  const edge = fastify({ logger: false, requestTimeout: 30000 });
  const server = createServer((req, res) => edge.routing(req, res));
  let created = false;
  const run = (args: string[]) => {
    const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 30000 });
    if (result.status !== 0) throw new Error('Disposable upload storage container command failed');
    return result.stdout.trim();
  };
  const close = async () => {
    proxy.closeAllConnections();
    if (proxy.listening) await new Promise<void>((r) => proxy.close(() => r()));
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((r) => server.close(() => r()));
    await edge.close();
    if (created) run(['rm', '--force', name]);
    await rm(folder, { recursive: true, force: true });
  };
  try {
    const image = parse(await readFile(join(root, 'deploy/compose.local.yaml'), 'utf8')).services
      .seaweedfs.image as string;
    const config = join(folder, 'identities.json');
    await writeFile(config, JSON.stringify(seaweedIdentityConfiguration(environment)), {
      mode: 0o600,
    });
    run([
      'run',
      '--detach',
      '--rm',
      '--name',
      name,
      '--mount',
      `type=bind,src=${config},dst=/run/secrets/storage-identities.json,readonly`,
      '--mount',
      `type=bind,src=${join(root, 'deploy/storage/seaweed-entrypoint.sh')},dst=/run/dms-seaweed.sh,readonly`,
      '-p',
      '127.0.0.1::8333',
      '--entrypoint',
      '/bin/sh',
      image,
      '/run/dms-seaweed.sh',
    ]);
    created = true;
    const port = run([
      'inspect',
      '--format',
      '{{(index (index .NetworkSettings.Ports "8333/tcp") 0).HostPort}}',
      name,
    ]);
    upstream = `http://127.0.0.1:${port}`;
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
    const proxyAddress = proxy.address();
    if (!proxyAddress || typeof proxyAddress === 'string')
      throw new Error('Private fault transport unavailable');
    environment.DMS_STORAGE_ENDPOINT = `http://127.0.0.1:${proxyAddress.port}`;
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        await configureStorage(environment);
        ready = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    if (!ready) throw new Error('Disposable upload storage unavailable');
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Transfer fixture unavailable');
    environment.DMS_STORAGE_PUBLIC_ORIGIN = `http://127.0.0.1:${address.port}`;
    mountTransferIngress(edge, environment);
    await edge.ready();
    return { environment, close, faults };
  } catch (error) {
    await close();
    throw error;
  }
}
