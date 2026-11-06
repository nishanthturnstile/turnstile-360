import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { FastifyInstance } from 'fastify';
import { storageAuthenticationRequired } from './storage-auth.js';
import { storageConfiguration } from './storage-configuration.js';

const sigQuery = new Set([
  'X-Amz-Algorithm',
  'X-Amz-Credential',
  'X-Amz-Date',
  'X-Amz-Expires',
  'X-Amz-SignedHeaders',
  'X-Amz-Signature',
  'X-Amz-Content-Sha256',
  'x-id',
  'response-content-type',
  'response-content-disposition',
]);
const safeHeaders = new Set([
  'host',
  'content-length',
  'content-type',
  'if-none-match',
  'range',
  'origin',
  'accept',
  'accept-encoding',
  'accept-language',
  'user-agent',
  'connection',
  'referer',
  'dnt',
  'priority',
  'pragma',
  'cache-control',
  // Dokploy/Traefik metadata is accepted but never trusted for authorization,
  // rate limiting, routing or signature Host, and is not forwarded to storage.
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
  'x-forwarded-server',
  'x-real-ip',
]);
const id = '[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}';

export function mountTransferIngress(server: FastifyInstance, environment: NodeJS.ProcessEnv) {
  const config = storageConfiguration(environment);
  const publicHost = new URL(config.publicOrigin).host;
  const endpoint = new URL(config.endpoint);
  const keyIds = {
    upload: environment.DMS_STORAGE_UPLOAD_ACCESS_KEY_ID,
    originalRead: environment.DMS_STORAGE_ORIGINAL_READ_ACCESS_KEY_ID,
    artifactRead: environment.DMS_STORAGE_ARTIFACT_READ_ACCESS_KEY_ID,
    artifactWrite: environment.DMS_STORAGE_ARTIFACT_WRITE_ACCESS_KEY_ID,
  };
  if (!keyIds.upload || !keyIds.originalRead || !keyIds.artifactRead)
    throw new Error('Explicit transfer signer identities required');
  if (
    new Set(Object.values(keyIds).filter(Boolean)).size !==
    Object.values(keyIds).filter(Boolean).length
  )
    throw new Error('Separate transfer signer identities required');
  let active = 0;
  const rates = new Map<string, { until: number; count: number }>();
  server.addHook('onRequest', async (request, reply) => {
    reply
      .header('cache-control', 'private, no-store')
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox");
    const deny = () => reply.code(403).send({ code: 'STORAGE_CAPABILITY_DENIED' });
    const now = Date.now();
    for (const [key, value] of rates) if (value.until <= now) rates.delete(key);
    const address = request.raw.socket.remoteAddress ?? 'unknown';
    const rate = rates.get(address) ?? { until: now + 60000, count: 0 };
    if ((!rates.has(address) && rates.size >= 2048) || ++rate.count > 120)
      return reply.header('retry-after', '60').code(429).send({ code: 'TRANSFER_BUSY' });
    rates.set(address, rate);
    const origin = request.headers.origin;
    if (origin !== undefined) {
      if (!config.origins.includes(origin)) return deny();
      reply
        .header('access-control-allow-origin', origin)
        .header('vary', 'Origin')
        .header(
          'access-control-expose-headers',
          'ETag, Content-Length, Content-Range, Accept-Ranges',
        );
    }
    if (request.method === 'OPTIONS') {
      if (
        !origin ||
        !['PUT', 'GET'].includes(String(request.headers['access-control-request-method']))
      )
        return deny();
      const headers = String(request.headers['access-control-request-headers'] ?? '')
        .toLowerCase()
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      if (headers.some((h) => !['content-type', 'if-none-match', 'range'].includes(h)))
        return deny();
      return reply
        .header('access-control-allow-methods', 'PUT, GET')
        .header('access-control-allow-headers', 'content-type, if-none-match, range')
        .header('access-control-max-age', '60')
        .code(204)
        .send();
    }
    if (!['PUT', 'GET'].includes(request.method) || request.url.length > 4096) return deny();
    const url = new URL(request.url, config.publicOrigin);
    if (
      !new RegExp(`^/(${Object.values(config.buckets).join('|')})/${id}/${id}/${id}$`).test(
        url.pathname,
      )
    )
      return deny();
    const seen = new Set<string>();
    for (const [key] of url.searchParams) {
      if (!sigQuery.has(key) || seen.has(key)) return deny();
      seen.add(key);
    }
    const params = url.searchParams;
    if (
      params.get('X-Amz-Algorithm') !== 'AWS4-HMAC-SHA256' ||
      !/^[a-f0-9]{64}$/.test(params.get('X-Amz-Signature') ?? '') ||
      !/^\d{8}T\d{6}Z$/.test(params.get('X-Amz-Date') ?? '') ||
      !/^[1-9][0-9]{0,2}$/.test(params.get('X-Amz-Expires') ?? '')
    )
      return deny();
    const expires = Number(params.get('X-Amz-Expires'));
    const credential = params.get('X-Amz-Credential')?.split('/');
    if (
      credential?.length !== 5 ||
      credential[2] !== config.region ||
      credential[3] !== 's3' ||
      credential[4] !== 'aws4_request'
    )
      return deny();
    const bucket = url.pathname.split('/')[1];
    const write = request.method === 'PUT';
    const key = write
      ? bucket === config.buckets.staging
        ? keyIds.upload
        : bucket === config.buckets.artifacts
          ? keyIds.artifactWrite
          : undefined
      : bucket === config.buckets.originals
        ? keyIds.originalRead
        : bucket === config.buckets.artifacts
          ? keyIds.artifactRead
          : undefined;
    if (!key || credential[0] !== key || expires > (write ? 900 : 120)) return deny();
    if (
      write &&
      (params.has('response-content-type') || params.has('response-content-disposition'))
    )
      return deny();
    const expected = write ? 'content-length;content-type;host;if-none-match' : 'host';
    if (params.get('X-Amz-SignedHeaders') !== expected) return deny();
    const counts = new Map<string, number>();
    for (let i = 0; i < request.raw.rawHeaders.length; i += 2) {
      const name = request.raw.rawHeaders[i]?.toLowerCase() ?? '';
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    for (const [header, count] of counts) {
      if (count > 1 || (!safeHeaders.has(header) && !/^sec-(?:fetch-|ch-ua)/.test(header)))
        return deny();
    }
    if (
      write &&
      (request.headers['if-none-match'] !== '*' ||
        !/^[1-9][0-9]{0,8}$/.test(String(request.headers['content-length'] ?? '')) ||
        Number(request.headers['content-length']) > 50 * 1024 * 1024 ||
        !request.headers['content-type'])
    )
      return deny();
    if (!write && request.headers['content-length'] && request.headers['content-length'] !== '0')
      return deny();
    if (request.headers.range && (write || !/^bytes=(?:\d+-\d*|-\d+)$/.test(request.headers.range)))
      return deny();
    const headers: Record<string, string> = { host: publicHost };
    for (const name of write ? ['content-length', 'content-type', 'if-none-match'] : ['range']) {
      const value = request.headers[name];
      if (typeof value === 'string') headers[name] = value;
    }
    if (active >= 8)
      return reply.header('retry-after', '1').code(429).send({ code: 'TRANSFER_BUSY' });
    active++;
    try {
      if (!(await storageAuthenticationRequired(endpoint)))
        return reply.code(503).send({ code: 'STORAGE_UNAVAILABLE' });
      reply.hijack();
      for (const [name, value] of Object.entries(reply.getHeaders()))
        if (value !== undefined) reply.raw.setHeader(name, value);
      await proxy(
        request.raw,
        reply.raw,
        endpoint,
        url.pathname + url.search,
        request.method,
        headers,
      );
    } finally {
      active--;
    }
  });
  server.all('/*', async () => ({ code: 'STORAGE_CAPABILITY_DENIED' }));
}
async function proxy(
  input: import('node:http').IncomingMessage,
  output: import('node:http').ServerResponse,
  endpoint: URL,
  path: string,
  method: string,
  headers: Record<string, string>,
) {
  return new Promise<void>((resolve) => {
    const fail = () => {
      if (!output.headersSent) output.writeHead(503);
      output.end();
      resolve();
    };
    const upstream = (endpoint.protocol === 'https:' ? httpsRequest : httpRequest)(
      {
        protocol: endpoint.protocol,
        hostname: endpoint.hostname,
        port: endpoint.port,
        path,
        method,
        headers,
        timeout: 30000,
      },
      (response) => {
        const status = response.statusCode ?? 503;
        if (status >= 300) {
          response.resume();
          output.writeHead(status);
          output.end();
          resolve();
          return;
        }
        output.statusCode = status;
        for (const name of [
          'content-type',
          'content-length',
          'etag',
          'content-range',
          'accept-ranges',
        ]) {
          const value = response.headers[name];
          if (value) output.setHeader(name, value);
        }
        // Ignore storage metadata's media type/disposition. A signed response override
        // supplies the safe name; mutable unsigned query edits fail S3 verification.
        const query = new URL(path, 'http://transfer.invalid').searchParams;
        const disposition = query.get('response-content-disposition');
        output.setHeader('content-type', 'application/octet-stream');
        output.setHeader(
          'content-disposition',
          disposition?.startsWith('attachment;') && !/[\r\n]/.test(disposition)
            ? disposition
            : 'attachment',
        );
        response.on('error', () => {
          output.destroy();
          resolve();
        });
        response.on('end', resolve);
        response.pipe(output);
      },
    );
    upstream.on('timeout', () => upstream.destroy());
    upstream.on('error', fail);
    input.on('aborted', () => upstream.destroy());
    output.on('close', () => {
      upstream.destroy();
      resolve();
    });
    if (method === 'PUT') input.pipe(upstream);
    else upstream.end();
  });
}
