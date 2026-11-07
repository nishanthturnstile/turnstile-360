import 'server-only';
import { isIP } from 'node:net';
import { ZodError } from 'zod';
import { AccessError } from './access.ts';
import { runtime } from './runtime.ts';
export function json(value: unknown, status = 200, headers?: Headers) {
  const output = new Headers(headers);
  output.set('cache-control', 'no-store');
  output.set('referrer-policy', 'no-referrer');
  return Response.json(value, { status, headers: output });
}
export function checkOrigin(headers: Headers) {
  if (
    headers.get('origin') !== runtime().config.origin ||
    headers.get('sec-fetch-site') === 'cross-site'
  )
    throw new AccessError(403, 'Origin denied');
}
export async function body(request: Request, limit = 16384) {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new AccessError(415, 'JSON required');
  const reader = request.body?.getReader();
  if (!reader) throw new AccessError(400, 'Body required');
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new AccessError(413, 'Body too large');
    }
    chunks.push(chunk.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new AccessError(400, 'Invalid JSON');
  }
}
export function authHeaders(input: Headers) {
  const headers = new Headers(input);
  const forwarded = runtime().config.trustProxy
    ? input.get('x-forwarded-for')?.trim()
    : '127.0.0.1';
  if (!forwarded || !isIP(forwarded)) throw new AccessError(400, 'Invalid proxy client address');
  headers.set('x-forwarded-for', forwarded);
  headers.delete('x-real-ip');
  headers.delete('forwarded');
  headers.delete('authorization');
  return headers;
}
export async function endpoint(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AccessError) return json({ error: error.message }, error.status);
    if (error instanceof ZodError) return json({ error: 'Invalid input' }, 400);
    return json({ error: 'Service unavailable' }, 503);
  }
}

export async function machineEndpoint(fn: () => Promise<Response>) {
  const response = await endpoint(fn);
  if (response.ok) return response;
  const codes: Record<number, string> = {
    400: 'INVALID_INPUT',
    401: 'MACHINE_CREDENTIAL_REQUIRED',
    403: 'DENIED',
    404: 'NOT_FOUND',
    409: 'RECONCILIATION_REQUIRED',
    413: 'BODY_TOO_LARGE',
    415: 'JSON_REQUIRED',
  };
  return json({ version: 1, error: codes[response.status] ?? 'UNAVAILABLE' }, response.status);
}
