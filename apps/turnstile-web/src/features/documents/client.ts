import {
  DOCUMENTS_ACCESS_HEADER,
  DOCUMENTS_LIMITS,
  type DocumentsOperationMode,
  type DocumentsUploadReceipt,
  type DocumentsWorkspaceCommand,
  documentsErrorSchema,
  documentsUploadExecutionSchema,
  documentsUploadReceiptSchema,
} from '@thaarei/turnstile-contracts/documents';
import { traceDocumentRequest } from './observations';
export class DocumentsError extends Error {
  readonly status: number;
  readonly code: string;
  readonly guidance: string | undefined;
  constructor(status: number, code: string, guidance?: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.guidance = guidance;
  }
}
export async function documentsRead<T>(
  path: string,
  schema: { parse(value: unknown): T },
  signal: AbortSignal,
  command?: { csrf: string; body: unknown; kind?: DocumentsWorkspaceCommand['kind'] },
): Promise<T> {
  const trace = traceDocumentRequest(path, signal, command ? 'POST' : 'GET', command?.kind);
  let response: Response | undefined;
  let body: unknown;
  try {
    response = await fetch(path, {
      ...(command ? { method: 'POST', body: JSON.stringify(command.body) } : {}),
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.any([signal, AbortSignal.timeout(DOCUMENTS_LIMITS.browserTimeoutMs)]),
      headers: {
        accept: 'application/json',
        [DOCUMENTS_ACCESS_HEADER]: '3',
        ...(command ? { 'content-type': 'application/json', 'x-csrf-token': command.csrf } : {}),
      },
    });
    body = await readDocumentsBody(response);
    if (!response.ok) {
      const error = documentsErrorSchema.safeParse(body);
      throw new DocumentsError(
        response.status,
        error.success ? error.data.code : 'DOCUMENTS_UNAVAILABLE',
        error.success ? error.data.guidance : undefined,
      );
    }
    const parsed = schema.parse(body);
    trace?.(response, parsed, true);
    return parsed;
  } catch (error) {
    trace?.(response, body);
    throw error;
  }
}

async function readDocumentsBody(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new DocumentsError(503, 'DOCUMENTS_UNAVAILABLE');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > DOCUMENTS_LIMITS.responseBytes)
        throw new DocumentsError(503, 'DOCUMENTS_UNAVAILABLE');
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(joined));
}
export function documentsErrorMessage(error: unknown) {
  if (error instanceof DocumentsError) {
    if (error.guidance === 'manual_review')
      return 'This operation needs administrator review. Keep its operation ID.';
    if (error.guidance === 'retry_same_intent')
      return 'The outcome is pending. Retry the saved operation.';
    if (error.code === 'DOCUMENTS_RESTORE_EXPIRED')
      return 'The document restore window has expired.';
    if (error.code === 'DOCUMENTS_RESULT_UNAVAILABLE')
      return 'Extracted content is unavailable for this version or run.';
    if (error.code === 'DOCUMENTS_PROFILE_UNAVAILABLE')
      return 'This processing profile is unavailable for the selected version.';
    if (error.code === 'DOCUMENTS_PROCESSING_ACTIVE')
      return 'Processing is already in progress for this version.';
    if (error.status === 410) return 'This saved operation is no longer available.';
    if (error.status === 429) return 'There are too many pending operations. Check saved uploads.';
    if (error.status === 409)
      return 'The saved operation or your access changed. Check the current state.';
    if (error.code === 'DEPLOYMENT_RESTRICTED')
      return 'Document access is restricted by installation policy.';
    if (error.status === 401)
      return 'Your session needs to be checked. Sign in again if requested.';
    if (error.status === 403) return 'Your current access does not allow this document or section.';
    if (error.status === 404) return 'This document is unavailable with your current access.';
    if (error.status === 413)
      return 'The request is too large. Reduce the metadata or split the batch.';

    if (error.status === 400) return 'Check the submitted fields and try again.';
  }
  return 'The document service is temporarily unavailable. Your sign-in is still active. Try again.';
}

export function draftDocumentCommand(
  command: DocumentsWorkspaceCommand,
  csrf: string,
  signal: AbortSignal,
  mode: DocumentsOperationMode = 'ordinary',
) {
  return documentsRead('/api/documents/operations', documentsUploadReceiptSchema, signal, {
    csrf,
    body: { mode, command },
  });
}
export function executeDocumentCommand(
  operation: DocumentsUploadReceipt,
  csrf: string,
  signal: AbortSignal,
) {
  const { id, digest } = operation.receipt;
  return documentsRead(
    `/api/documents/operations/${id}/execute`,
    documentsUploadExecutionSchema,
    signal,
    {
      csrf,
      body: { digest },
      kind: operation.receipt.kind,
    },
  );
}
