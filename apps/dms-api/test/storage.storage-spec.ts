import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer, request as rawRequest } from 'node:http';
import { join } from 'node:path';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { chromium } from '@playwright/test';
import fastify from 'fastify';
import { S3Storage } from '../src/modules/storage/s3-storage.js';
import {
  type ObjectReference,
  STORAGE_ROLES,
  type StorageRole,
  storageConfiguration,
  storageCredentials,
} from '../src/modules/storage/storage-configuration.js';
import { mountTransferIngress } from '../src/modules/storage/transfer-ingress.js';

describe('pinned SeaweedFS storage boundary', () => {
  const environment = { ...process.env };
  const clients = new Map<StorageRole, S3Storage>();
  const edge = fastify({ logger: false, requestTimeout: 30000 });
  const http = createServer((req, res) => edge.routing(req, res));
  const browserOrigin = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><title>Independent storage consumer</title>');
  });
  let origin = '';
  const ref = (area: ObjectReference['area'] = 'staging'): ObjectReference => ({
    area,
    tenantId: randomUUID(),
    applicationId: randomUUID(),
    id: randomUUID(),
  });
  const storage = (role: StorageRole) => {
    const client = clients.get(role);
    if (!client) throw new Error('Fixture unavailable');
    return client;
  };
  const raw = (role: StorageRole) =>
    new S3Client({
      endpoint: storageConfiguration(environment).endpoint,
      forcePathStyle: true,
      region: 'us-east-1',
      credentials: storageCredentials(environment, role),
      maxAttempts: 1,
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  beforeAll(async () => {
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    await new Promise<void>((resolve) => browserOrigin.listen(0, '127.0.0.1', resolve));
    const address = http.address(),
      browserAddress = browserOrigin.address();
    if (
      !address ||
      typeof address === 'string' ||
      !browserAddress ||
      typeof browserAddress === 'string'
    )
      throw new Error('Fixture listen failed');
    environment.DMS_STORAGE_PUBLIC_ORIGIN = `http://127.0.0.1:${address.port}`;
    origin = `http://127.0.0.1:${browserAddress.port}`;
    environment.DMS_STORAGE_BROWSER_ORIGINS = JSON.stringify([origin]);
    mountTransferIngress(edge, environment);
    await edge.ready();
    for (const role of STORAGE_ROLES)
      clients.set(
        role,
        new S3Storage(
          storageConfiguration(environment),
          role,
          storageCredentials(environment, role),
        ),
      );
  });
  afterAll(async () => {
    for (const client of clients.values()) client.close();
    http.closeAllConnections();
    browserOrigin.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => http.close(() => resolve())),
      new Promise<void>((resolve) => browserOrigin.close(() => resolve())),
      edge.close(),
    ]);
  });
  async function put(reference = ref(), body = Buffer.from('sample payload'), seconds = 900) {
    const cap = await storage('upload').upload(reference, body.length, 'application/pdf', seconds);
    const response = await fetch(cap.url, { method: 'PUT', headers: cap.headers, body });
    return { reference, cap, response, body };
  }
  it('enforces exact length/type/create-only signed headers and atomic concurrent replay', async () => {
    const reference = ref();
    const cap = await storage('upload').upload(reference, 3, 'application/pdf');
    expect(new URL(cap.url).searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-length;content-type;host;if-none-match',
    );
    expect(
      (await fetch(cap.url, { method: 'PUT', headers: cap.headers, body: 'toolong' })).status,
    ).toBe(403);
    expect(
      (
        await fetch(cap.url, {
          method: 'PUT',
          headers: { ...cap.headers, 'content-type': 'text/plain' },
          body: 'abc',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(cap.url, {
          method: 'PUT',
          headers: { 'content-type': 'application/pdf' },
          body: 'abc',
        })
      ).status,
    ).toBe(403);
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        fetch(cap.url, { method: 'PUT', headers: cap.headers, body: 'abc' }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 412, 412, 412]);
    const metadata = await storage('snapshot').head(reference);
    expect(metadata.size).toBe(3);
  });
  it('rejects unbounded framing and isolates artifact capabilities', async () => {
    const source = ref();
    const cap = await storage('upload').upload(source, 3, 'application/pdf');
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = rawRequest(cap.url, { method: 'PUT', headers: cap.headers }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      request.on('error', reject);
      request.write('abc');
      request.end(); // unknown length => chunked
    });
    expect(status).toBe(403);
    await expect(storage('snapshot').head(source)).rejects.toMatchObject({ code: 'not-found' });
    await expect(
      storage('upload').upload(source, 50 * 1024 * 1024 + 1, 'application/pdf'),
    ).rejects.toThrow();
    const artifact = ref('artifacts');
    await expect(storage('upload').upload(artifact, 3, 'application/json')).rejects.toMatchObject({
      code: 'denied',
    });
    const written = await storage('artifactWrite').upload(artifact, 3, 'application/json');
    expect(
      (await fetch(written.url, { method: 'PUT', headers: written.headers, body: '123' })).status,
    ).toBe(200);
    const read = await storage('artifactRead').download(artifact);
    expect(await (await fetch(read.url)).text()).toBe('123');
    expect(
      (await fetch(written.url, { method: 'PUT', headers: written.headers, body: '456' })).status,
    ).toBe(412);
    await storage('cleanup').deleteExact(artifact);
    expect((await fetch(read.url)).status).toBe(404);
  });

  it('accepts proxy metadata without changing the signed host or storage request', async () => {
    const headers = {
      forwarded: 'for=192.0.2.1;proto=https;host=untrusted.example',
      'x-forwarded-for': '192.0.2.1, 192.0.2.2',
      'x-forwarded-host': 'untrusted.example',
      'x-forwarded-port': '443',
      'x-forwarded-proto': 'https',
      'x-forwarded-server': 'proxy',
      'x-real-ip': '192.0.2.1',
    };
    const reference = ref();
    const cap = await storage('upload').upload(reference, 3, 'application/pdf');
    expect(
      (
        await fetch(cap.url, {
          method: 'PUT',
          headers: { ...cap.headers, ...headers },
          body: 'abc',
        })
      ).status,
    ).toBe(200);
    const head = await storage('snapshot').head(reference);
    const original = await storage('snapshot').snapshot(reference, head.etag);
    const download = await storage('originalRead').download(original.reference);
    const response = await fetch(download.url, { headers });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('abc');
    expect(
      (await fetch(download.url, { headers: { ...headers, 'x-amz-acl': 'public-read' } })).status,
    ).toBe(403);
  });

  it('snapshots only a matching source into a fresh private key and supports range/read-after-write/deletion', async () => {
    const upload = await put();
    expect(upload.response.status).toBe(200);
    await expect(
      storage('snapshot').snapshot(upload.reference, '"00000000000000000000000000000000"'),
    ).rejects.toMatchObject({ code: 'precondition' });
    const head = await storage('snapshot').head(upload.reference);
    const original = await storage('snapshot').snapshot(upload.reference, head.etag);
    expect(original.reference.id).not.toBe(upload.reference.id);
    expect(original.size).toBe(upload.body.length);
    const another = await storage('snapshot').snapshot(upload.reference, head.etag);
    expect(another.reference.id).not.toBe(original.reference.id);
    const snapshotClient = raw('snapshot');
    try {
      const overwrite = new CopyObjectCommand({
        Bucket: 'dms-originals',
        Key: `${original.reference.tenantId}/${original.reference.applicationId}/${original.reference.id}`,
        CopySource: `dms-staging/${upload.reference.tenantId}/${upload.reference.applicationId}/${upload.reference.id}`,
        CopySourceIfMatch: head.etag,
      });
      overwrite.middlewareStack.add(
        (next) => async (args) => {
          (args.request as { headers: Record<string, string> }).headers['if-none-match'] = '*';
          return next(args);
        },
        { step: 'build', name: 'fixtureCreateOnlyCopy' },
      );
      await expect(snapshotClient.send(overwrite)).rejects.toMatchObject({
        $metadata: { httpStatusCode: 412 },
      });
    } finally {
      snapshotClient.destroy();
    }
    const download = await storage('originalRead').downloadOriginal(
      original.reference,
      '../résumé\r\nInjected: unsafe.html',
    );
    const ranged = await fetch(download.url, { headers: { range: 'bytes=0-5' } });
    expect(ranged.status).toBe(206);
    expect(await ranged.text()).toBe('sample');
    expect(ranged.headers.get('content-type')).toBe('application/octet-stream');
    expect(ranged.headers.get('content-disposition')).toContain("filename*=UTF-8''");
    expect(ranged.headers.get('content-disposition')).not.toMatch(/[\r\n/]/);
    expect(ranged.headers.get('cache-control')).toBe('private, no-store');
    expect(ranged.headers.get('referrer-policy')).toBe('no-referrer');
    expect(ranged.headers.get('x-content-type-options')).toBe('nosniff');
    const suffix = await fetch(download.url, { headers: { range: 'bytes=-7' } });
    expect(suffix.status).toBe(206);
    expect(await suffix.text()).toBe('payload');
    expect((await fetch(download.url, { headers: { range: 'bytes=0-1,3-4' } })).status).toBe(403);
    const altered = new URL(download.url);
    altered.searchParams.set('response-content-type', 'text/html');
    expect((await fetch(altered)).status).toBe(403);

    expect(Buffer.from(await (await fetch(download.url)).arrayBuffer())).toEqual(upload.body);
    await storage('cleanup').deleteExact(upload.reference);
    expect((await fetch(download.url)).status).toBe(200); // deleting staging cannot delete its snapshot
    await storage('cleanup').deleteExact(original.reference);
    expect((await fetch(download.url)).status).toBe(404);
    await storage('cleanup').deleteExact(original.reference);
  });
  it('denies anonymous access, list/admin/vendor bypass and unsigned header/query injection', async () => {
    const cap = (await put()).cap;
    for (const suffix of [
      '&extract=true',
      '&acl',
      '&uploads',
      '&x-amz-acl=public-read',
      '&X-Amz-Expires=900',
    ])
      expect(
        (
          await fetch(cap.url + suffix, {
            method: 'PUT',
            headers: cap.headers,
            body: 'sample payload',
          })
        ).status,
      ).toBe(403);
    for (const header of [
      'x-amz-acl',
      'x-amz-copy-source',
      'x-seaweedfs-extract',
      'x-amz-meta-injected',
      'authorization',
      'transfer-encoding',
    ]) {
      if (header === 'transfer-encoding') continue; // Node fetch rejects conflicting framing before it reaches ingress.
      expect(
        (
          await fetch(cap.url, {
            method: 'PUT',
            headers: { ...cap.headers, [header]: 'injected' },
            body: 'sample payload',
          })
        ).status,
      ).toBe(403);
    }
    for (const path of [
      '/',
      '/dms-originals',
      '/status',
      '/dir/assign',
      '/buckets/dms-originals',
      '/admin',
      '/metrics',
    ])
      expect((await fetch(environment.DMS_STORAGE_PUBLIC_ORIGIN + path)).status).toBe(403);
    expect((await fetch(new URL(cap.url).origin + new URL(cap.url).pathname)).status).toBe(403);
    expect(
      (
        await fetch(cap.url, {
          method: 'PUT',
          headers: { ...cap.headers, origin: 'https://unapproved.example' },
          body: 'sample payload',
        })
      ).status,
    ).toBe(403);
    const rawUrl = environment.DMS_STORAGE_ENDPOINT as string;
    expect((await fetch(`${rawUrl}/dms-staging`)).status).toBe(403);
    const name = environment.DMS_STORAGE_TEST_CONTAINER as string;
    const internal = spawnSync(
      'docker',
      [
        'exec',
        name,
        '/bin/sh',
        '-c',
        'ip=$(hostname -i | awk \'{print $1}\'); for port in 8888 9333 9340 7333 12535; do if wget -q -T 1 -O /dev/null "http://$ip:$port/"; then exit 1; fi; done',
      ],
      { encoding: 'utf8' },
    );
    expect(internal.status).toBe(0);
  });
  it('fails closed if a private backend no longer requires authentication', async () => {
    let writes = 0;
    const unsigned = createServer((request, response) => {
      if (request.method === 'PUT') writes++;
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) => unsigned.listen(0, '127.0.0.1', resolve));
    const address = unsigned.address();
    if (!address || typeof address === 'string') throw new Error('Missing unsigned fixture');
    const unsafeEnvironment = {
      ...environment,
      DMS_STORAGE_ENDPOINT: `http://127.0.0.1:${address.port}`,
    };
    const unsafe = fastify({ logger: false });
    mountTransferIngress(unsafe, unsafeEnvironment);
    await unsafe.ready();
    const signer = new S3Storage(
      storageConfiguration(unsafeEnvironment),
      'upload',
      storageCredentials(environment, 'upload'),
    );
    try {
      const cap = await storage('upload').upload(ref(), 3, 'application/pdf');
      const target = new URL(cap.url);
      const denied = await unsafe.inject({
        method: 'PUT',
        url: target.pathname + target.search,
        headers: { ...cap.headers, 'content-length': '3' },
        payload: 'abc',
      });
      expect(denied.statusCode).toBe(503);
      expect(writes).toBe(0);
      await expect(signer.upload(ref(), 3, 'application/pdf')).rejects.toMatchObject({
        code: 'unavailable',
      });
    } finally {
      signer.close();
      await unsafe.close();
      await new Promise<void>((resolve) => unsigned.close(() => resolve()));
    }
  });

  it('enforces provider IAM independently of adapter guards', async () => {
    const reference = ref();
    const key = `${reference.tenantId}/${reference.applicationId}/${reference.id}`;
    for (const role of STORAGE_ROLES) {
      const client = raw(role);
      try {
        const listed = await client.send(new ListBucketsCommand({}));
        expect(listed.Buckets).toEqual([]);
        await expect(
          client.send(new ListObjectsV2Command({ Bucket: 'dms-originals' })),
        ).rejects.toMatchObject({ $metadata: { httpStatusCode: 403 } });
        if (role !== 'originalRead' && role !== 'snapshot')
          await expect(
            client.send(new GetObjectCommand({ Bucket: 'dms-originals', Key: key })),
          ).rejects.toMatchObject({ $metadata: { httpStatusCode: 403 } });
        if (role !== 'snapshot')
          await expect(
            client.send(
              new PutObjectCommand({ Bucket: 'dms-originals', Key: key, Body: 'forbidden' }),
            ),
          ).rejects.toMatchObject({ $metadata: { httpStatusCode: 403 } });
        if (role !== 'cleanup')
          await expect(
            client.send(new DeleteObjectCommand({ Bucket: 'dms-originals', Key: key })),
          ).rejects.toMatchObject({ $metadata: { httpStatusCode: 403 } });
      } finally {
        client.destroy();
      }
    }
  });
  it('expires capabilities and transfers known-size bytes from real Chromium and Python', async () => {
    const expired = await storage('upload').upload(ref(), 3, 'application/pdf', 1);
    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect(
      (await fetch(expired.url, { method: 'PUT', headers: expired.headers, body: 'abc' })).status,
    ).toBe(403);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(origin);
      const reference = ref();
      const cap = await storage('upload').upload(reference, 3, 'application/pdf');
      const outcome = await page.evaluate(async (cap) => {
        const file = new Blob(['abc'], { type: 'application/pdf' });
        const response = await fetch(cap.url, {
          method: 'PUT',
          headers: cap.headers,
          body: file,
          credentials: 'omit',
        });
        return { status: response.status, etag: response.headers.get('etag') };
      }, cap);
      expect(outcome.status).toBe(200);
      expect(outcome.etag).toBeTruthy();
      const head = await storage('snapshot').head(reference);
      expect(head.size).toBe(3);
      const snapshot = await storage('snapshot').snapshot(reference, head.etag);
      const download = await storage('originalRead').download(snapshot.reference);
      expect(
        await page.evaluate(
          async (cap) => await (await fetch(cap.url, { credentials: 'omit' })).text(),
          download,
        ),
      ).toBe('abc');
    } finally {
      await browser.close();
    }
    const reference = ref();
    const cap = await storage('upload').upload(reference, 3, 'application/pdf');
    const directory = environment.DMS_STORAGE_TEST_DIRECTORY;
    if (!directory) throw new Error('Missing fixture directory');
    const inputPath = join(directory, 'python-upload.bin');
    await writeFile(inputPath, 'abc', { mode: 0o600 });
    async function pythonTransfer(capability: unknown, path: string, range?: string) {
      const child = spawn(
        'python3',
        ['../../examples/dms/transfer.py', path, ...(range ? [range] : [])],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', () => {});
      child.stdin.end(JSON.stringify(capability));
      const [code] = await once(child, 'close');
      expect(code).toBe(0);
      return output.trim();
    }
    expect(await pythonTransfer(cap, inputPath)).toBe('200');
    const head = await storage('snapshot').head(reference);
    const snapshot = await storage('snapshot').snapshot(reference, head.etag);
    const download = await storage('originalRead').download(snapshot.reference);
    const outputPath = join(directory, 'python-download.bin');
    expect(await pythonTransfer(download, outputPath, 'bytes=0-1')).toBe('206');
    expect((await readFile(outputPath)).toString()).toBe('ab');
  });
});
