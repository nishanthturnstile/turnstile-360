import type { DmsErrorCode } from '@thaarei/dms-contracts';

export type DmsClientErrorCode =
  | 'DMS_UNAVAILABLE'
  | 'DMS_ACCESS_DENIED'
  | 'DMS_MACHINE_AUTH_FAILED'
  | 'DMS_INVALID_RESPONSE'
  | 'DMS_ENROLLMENT_FAILED'
  | 'DMS_CONFIGURATION_INVALID'
  | 'DMS_REQUEST_INVALID';

// Never retain upstream bodies, headers, URLs, credentials or exception causes.
export class DmsClientError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly code: DmsClientErrorCode,
    readonly status?: number,
    readonly domainCode?: DmsErrorCode,
  ) {
    super(code);
    this.name = 'DmsClientError';
    this.retryable =
      code === 'DMS_UNAVAILABLE' || status === 503 || domainCode === 'ENROLLMENT_IN_PROGRESS';
  }
}

export function fixedUrl(value: string, allowHttp: boolean): string {
  try {
    const url = new URL(value);
    if (
      !(url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      value.includes('*') ||
      value !== `${url.origin}${url.pathname === '/' ? '' : url.pathname}`
    )
      throw new Error();
    return value;
  } catch {
    throw new DmsClientError('DMS_CONFIGURATION_INVALID');
  }
}

export function timeout(value = 5000) {
  if (!Number.isInteger(value) || value < 1 || value > 10000)
    throw new DmsClientError('DMS_CONFIGURATION_INVALID');
  return value;
}

export async function jsonRequest(
  url: string,
  init: RequestInit,
  transport: typeof fetch,
  timeoutMs: number,
): Promise<{ status: number; body: unknown }> {
  try {
    const response = await transport(url, {
      ...init,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const reader = response.body?.getReader();
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      if (reader)
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 16384) {
            await reader.cancel();
            throw new DmsClientError('DMS_INVALID_RESPONSE');
          }
          chunks.push(value);
        }
    } finally {
      reader?.releaseLock();
    }
    let body: unknown;
    if (response.headers.get('content-type')?.split(';')[0]?.trim() === 'application/json') {
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        /* Invalid bodies never enter errors or diagnostics. */
      }
    }
    return { status: response.status, body };
  } catch (error) {
    if (error instanceof DmsClientError) throw error;
    throw new DmsClientError('DMS_UNAVAILABLE');
  }
}
