type PutCapability = {
  url: string;
  method: 'PUT';
  headers: { 'content-type': string; 'if-none-match': '*' };
  size: number;
  expiresAt: string;
};

export async function sha256(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export function transferSignal(signal: AbortSignal, expiresAt: string) {
  const remaining = Date.parse(expiresAt) - Date.now();
  if (remaining <= 0) throw new Error('Transfer expired');
  return AbortSignal.any([signal, AbortSignal.timeout(Math.min(remaining, 300000))]);
}

export async function verifiedDocumentBytes(
  cap: { url: string; size: number; sha256: string; expiresAt: string },
  maximum: number,
  signal: AbortSignal,
) {
  if (!Number.isSafeInteger(cap.size) || cap.size < 1 || cap.size > maximum)
    throw new Error('Invalid transfer size');
  const transfer = transferSignal(signal, cap.expiresAt);
  const response = await fetch(cap.url, {
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    signal: transfer,
  });
  if (!response.ok) throw new Error('Download unavailable');
  const stream = response.body?.getReader();
  if (!stream) throw new Error('Download unavailable');
  const bytes = new Uint8Array(cap.size);
  let offset = 0;
  try {
    for (;;) {
      const chunk = await stream.read();
      if (chunk.done) break;
      if (offset + chunk.value.length > bytes.length) throw new Error('Download size changed');
      bytes.set(chunk.value, offset);
      offset += chunk.value.length;
    }
  } finally {
    await stream.cancel().catch(() => {});
    stream.releaseLock();
  }
  if (offset !== cap.size || (await sha256(bytes.buffer)) !== cap.sha256)
    throw new Error('Download integrity check failed');
  transfer.throwIfAborted();
  return bytes;
}

export async function putDocumentFile(
  cap: PutCapability,
  file: File,
  signal: AbortSignal,
  onProgress?: (sent: number) => void,
) {
  if (cap.size !== file.size) throw new Error('Transfer size mismatch');
  const url = new URL(cap.url);
  // Upload progress uses XHR. Credential omission requires the separate transfer
  // origin. Its owned ingress drops upstream Location headers.
  if (url.origin === location.origin || url.username || url.password || url.hash)
    throw new Error('Invalid transfer origin');
  const transfer = transferSignal(signal, cap.expiresAt);
  transfer.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const fail = () => reject(new Error('Transfer failed'));
    const abort = () => {
      request.abort();
      reject(transfer.reason);
    };
    if (onProgress) {
      request.upload.onprogress = ({ loaded }) => {
        if (!transfer.aborted) onProgress(Math.min(file.size, loaded));
      };
    }
    request.open(cap.method, cap.url);
    request.withCredentials = false;
    for (const [name, value] of Object.entries(cap.headers)) request.setRequestHeader(name, value);
    request.onload = () => {
      // A 412 can be the prior upload. Completion still verifies the staged descriptor.
      if (
        request.responseURL === url.href &&
        ((request.status >= 200 && request.status < 300) || request.status === 412)
      ) {
        resolve();
      } else fail();
    };
    request.onerror = fail;
    request.onabort = fail;
    request.onloadend = () => transfer.removeEventListener('abort', abort);
    transfer.addEventListener('abort', abort, { once: true });
    try {
      request.send(file);
    } catch (error) {
      transfer.removeEventListener('abort', abort);
      reject(error);
    }
  });
}
