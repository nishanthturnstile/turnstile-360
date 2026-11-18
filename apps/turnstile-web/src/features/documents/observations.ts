import {
  DOCUMENTS_REQUEST_ID_HEADER,
  DOCUMENTS_ROUTES,
  type DocumentsWorkspaceCommand,
  documentsErrorSchema,
  documentsUploadExecutionSchema,
} from '@thaarei/turnstile-contracts/documents';
import { peopleIdSchema } from '@thaarei/turnstile-contracts/runtime';

type EvidenceId = (typeof DOCUMENTS_ROUTES)[number]['evidenceId'];
type Observation = {
  status: number | null;
  requestId: string | null;
  outcome: string;
};
type Observations = Partial<Record<EvidenceId, Observation>>;

const uuid = '[0-9a-fA-F-]{36}';
const reads = DOCUMENTS_ROUTES.flatMap(({ evidenceId, product }) =>
  product?.method === 'GET'
    ? [{ evidenceId, path: new RegExp(`^${product.path.replaceAll(/\{[^}]+\}/g, uuid)}$`) }]
    : [],
);
const none: Observations = {};
let scope: { observations: Observations } | undefined;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function startDocumentsObservations() {
  const current = { observations: none };
  scope = current;
  notify();
  return () => {
    if (scope !== current) return;
    scope = undefined;
    notify();
  };
}

export function subscribeDocumentsObservations(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function documentsObservations() {
  return scope?.observations ?? none;
}

export function traceDocumentRequest(
  path: string,
  signal: AbortSignal,
  method: 'GET' | 'POST',
  command?: DocumentsWorkspaceCommand['kind'],
) {
  const current = scope;
  if (!current) return;
  const pathname = path.split('?', 1)[0] ?? '';
  const matched =
    method === 'GET'
      ? reads.find(({ path }) => path.test(pathname))
      : DOCUMENTS_ROUTES.find(
          ({ product }) =>
            product?.method === 'POST' && 'command' in product && product.command === command,
        );
  if (!matched) return;

  return (response?: Response, body?: unknown, verified = false) => {
    if (signal.aborted || scope !== current) return;
    const error = response && !response.ok ? documentsErrorSchema.safeParse(body).data : undefined;
    const request = peopleIdSchema.safeParse(response?.headers.get(DOCUMENTS_REQUEST_ID_HEADER));
    const execution =
      method === 'POST' && verified
        ? documentsUploadExecutionSchema.safeParse(body).data
        : undefined;
    const outcome = execution
      ? execution.receipt.acknowledgement === 'accepted'
        ? 'Operation accepted'
        : 'Operation confirmed'
      : verified
        ? 'Response verified'
        : (error?.code ?? (response ? 'Response could not be verified' : 'No response received'));
    current.observations = {
      ...current.observations,
      [matched.evidenceId]: {
        status: response?.status ?? null,
        requestId: request.data ?? error?.requestId ?? null,
        outcome,
      },
    };
    notify();
  };
}
