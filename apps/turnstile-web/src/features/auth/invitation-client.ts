import {
  PEOPLE_ERROR_STATUS,
  PEOPLE_LIMITS,
  peopleErrorSchema,
} from '@thaarei/turnstile-contracts';

// Capture before rendering and on same-document invitation arrivals. Never persist secrets.
let credential: string | undefined;
export function captureInvitationCredential() {
  if (window.location.pathname !== '/invitations/join') return;
  const fragment = window.location.hash.slice(1);
  credential = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(fragment) ? fragment : undefined;
  window.history.replaceState(null, '', '/invitations/join');
}
captureInvitationCredential();
export const invitationCredential = () => credential;
export const forgetInvitationCredential = (expected = credential) => {
  if (credential === expected) credential = undefined;
};
export class InvitationRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
type RequestOptions = { csrf?: string; body?: object; signal?: AbortSignal };
export async function invitationRequest<T>(
  path: string,
  schema: { parse(value: unknown): T },
  options: RequestOptions = {},
) {
  try {
    const response = await fetch(path, {
      method: options.body ? 'POST' : 'GET',
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(PEOPLE_LIMITS.requestTimeoutMs)])
        : AbortSignal.timeout(PEOPLE_LIMITS.requestTimeoutMs),
      headers: {
        accept: 'application/json',
        ...(options.body
          ? { 'content-type': 'application/json', 'x-csrf-token': options.csrf ?? '' }
          : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > PEOPLE_LIMITS.responseBytes) throw new Error();
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!response.ok) {
      const error = peopleErrorSchema.safeParse(value);
      throw new InvitationRequestError(
        response.status,
        error.success && PEOPLE_ERROR_STATUS[error.data.code] === response.status
          ? error.data.code
          : 'INVITATION_UNAVAILABLE_RETRY',
      );
    }
    return schema.parse(value);
  } catch (error) {
    if (error instanceof InvitationRequestError) throw error;
    throw new InvitationRequestError(503, 'INVITATION_UNAVAILABLE_RETRY');
  }
}

export interface InvitationPurpose {
  current(): boolean;
  check(): void;
  request<T>(
    path: string,
    schema: { parse(value: unknown): T },
    options?: RequestOptions,
  ): Promise<T>;
}

// Superseded reads may be aborted. Mutations settle before a newer explicit action
// starts, so their server cookie transitions cannot race the new credential exchange.
export function createInvitationFlow() {
  let generation = 0;
  let controller = new AbortController();
  let pending: Promise<void> = Promise.resolve();
  const running = new Set<number>();
  function capture(): InvitationPurpose {
    const expected = generation;
    const signal = controller.signal;
    const current = () => generation === expected && !signal.aborted;
    const check = () => {
      if (!current()) throw new Error('Invitation changed');
    };
    return {
      current,
      check,
      async request(path, schema, options = {}) {
        check();
        const result = await invitationRequest(path, schema, {
          ...options,
          ...(!options.body ? { signal } : {}),
        });
        check();
        return result;
      },
    };
  }
  return {
    capture,
    replace() {
      controller.abort();
      controller = new AbortController();
      generation += 1;
    },
    async run(
      work: (purpose: InvitationPurpose) => Promise<void>,
      handlers: {
        start(): void;
        error(error: unknown, purpose: InvitationPurpose): Promise<void>;
        settled(): void;
      },
    ) {
      const expected = generation;
      if (running.has(expected)) return;
      running.add(expected);
      const purpose = capture();
      handlers.start();
      const previous = pending;
      const task = (async () => {
        await previous;
        try {
          purpose.check();
          await work(purpose);
        } catch (error) {
          if (purpose.current()) await handlers.error(error, purpose);
        } finally {
          running.delete(expected);
          if (purpose.current()) handlers.settled();
        }
      })();
      pending = task.catch(() => {});
      await task;
    },
  };
}
export function invitationMessage(error: unknown) {
  if (error instanceof InvitationRequestError) {
    if (error.status === 429) return 'Too many attempts. Wait a minute, then try again.';
    if (error.status === 401)
      return 'Sign in again to continue. You can also reopen the current invitation from your email.';
    if (error.status === 409)
      return 'This invitation changed. Review the current invitation again before continuing.';
    if (error.status === 410)
      return 'This step is unavailable. Sign in if you already have an account, or reopen the latest invitation from your email.';
    if (error.status === 403)
      return 'This action could not be verified. Review the invitation again or switch accounts.';
  }
  return 'Invitations are temporarily unavailable. Please try again.';
}
