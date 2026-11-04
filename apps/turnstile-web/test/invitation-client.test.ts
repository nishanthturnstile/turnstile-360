import assert from 'node:assert/strict';
import test from 'node:test';
import { restrictedInvitationContextSchema } from '@thaarei/turnstile-contracts';

test('removes the invitation fragment before any request and exchanges only on explicit action', async () => {
  const secret = 'A'.repeat(43);
  let removed = false;
  let calls = 0;
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { pathname: '/invitations/join', hash: `#${secret}` },
      history: {
        replaceState(_state: unknown, _title: string, path: string) {
          assert.equal(path, '/invitations/join');
          removed = true;
        },
      },
    },
  });
  globalThis.fetch = async (input, options) => {
    assert.equal(removed, true);
    calls++;
    assert.equal(input, '/api/invitations/exchange');
    assert.equal(options?.method, 'POST');
    assert.equal(options?.referrerPolicy, 'no-referrer');
    assert.deepEqual(JSON.parse(String(options?.body)), { credential: secret });
    return new Response(
      JSON.stringify({
        kind: 'invitation',
        phase: 'unavailable',
        state: 'cancelled',
        csrfToken: secret,
        expiresAt: '2026-11-04T12:00:00Z',
      }),
    );
  };
  try {
    const client = await import('../src/features/auth/invitation-client.ts');
    assert.equal(removed, true);
    assert.equal(calls, 0);
    assert.equal(client.invitationCredential(), secret);
    const result = await client.invitationRequest(
      '/api/invitations/exchange',
      restrictedInvitationContextSchema,
      { body: { credential: client.invitationCredential() } },
    );
    assert.equal(result.phase, 'unavailable');
    assert.equal(calls, 1);
    client.forgetInvitationCredential();
    assert.equal(client.invitationCredential(), undefined);
    removed = false;
    window.location.hash = `#${secret}`;
    client.captureInvitationCredential();
    assert.equal(removed, true);
    assert.equal(client.invitationCredential(), secret);
    assert.equal(calls, 1, 'Reopening a link must still require an explicit exchange');
    window.location.hash = '#invalid';
    client.captureInvitationCredential();
    assert.equal(
      client.invitationCredential(),
      undefined,
      'A new invalid link must not reuse an old credential',
    );
    client.forgetInvitationCredential();
  } finally {
    globalThis.fetch = originalFetch;
    Reflect.deleteProperty(globalThis, 'window');
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const passthrough = { parse: (value: unknown) => value };

test('cancels an oversized streamed response before EOF and scrubs transport failures without retry', async () => {
  const client = await import('../src/features/auth/invitation-client.ts');
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let chunks = 0;
  let cancelled = false;
  globalThis.fetch = async () => {
    calls++;
    return new Response(
      new ReadableStream(
        {
          pull(controller) {
            chunks++;
            // No EOF: the client must reject and cancel as soon as it crosses the bound.
            controller.enqueue(new Uint8Array(chunks === 1 ? 1_048_576 : 1));
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      ),
    );
  };
  try {
    await assert.rejects(
      client.invitationRequest('/api/invitations/context', passthrough),
      (error) =>
        error instanceof client.InvitationRequestError &&
        error.status === 503 &&
        error.code === 'INVITATION_UNAVAILABLE_RETRY',
    );
    assert.equal(chunks, 2);
    assert.equal(cancelled, true);
    assert.equal(calls, 1);
    globalThis.fetch = async () => {
      calls++;
      throw new Error('private upstream credential');
    };
    await assert.rejects(
      client.invitationRequest('/api/invitations/setup', passthrough, { body: {} }),
      (error) =>
        error instanceof client.InvitationRequestError &&
        error.message === 'INVITATION_UNAVAILABLE_RETRY',
    );
    assert.equal(calls, 2, 'An uncertain mutation must not be automatically retried');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a newer explicit exchange waits for the old cookie transition and ignores its result, error and cleanup', async (t) => {
  const client = await import('../src/features/auth/invitation-client.ts');
  for (const oldStatus of [200, 401, 409]) {
    await t.test(`superseded response ${oldStatus}`, async () => {
      const first = 'A'.repeat(43);
      const second = `${'B'.repeat(42)}A`;
      const originalFetch = globalThis.fetch;
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
          location: { pathname: '/invitations/join', hash: `#${first}` },
          history: { replaceState() {} },
        },
      });
      client.captureInvitationCredential();
      const a = deferred<Response>();
      const b = deferred<Response>();
      const startedA = deferred<void>();
      const startedB = deferred<void>();
      const calls: string[] = [];
      const callbacks: string[] = [];
      let signalA: AbortSignal | undefined;
      let displayed: unknown;
      let busy = false;
      globalThis.fetch = async (_path, options) => {
        const secret = JSON.parse(String(options?.body)).credential;
        calls.push(secret);
        if (secret === first) {
          signalA = options?.signal ?? undefined;
          startedA.resolve();
          return a.promise;
        }
        assert.equal(secret, second);
        startedB.resolve();
        return b.promise;
      };
      const flow = client.createInvitationFlow();
      const handlers = (id: string) => ({
        start() {
          busy = true;
          callbacks.push(`${id}:start`);
        },
        async error() {
          callbacks.push(`${id}:error`);
          displayed = 'old error';
        },
        settled() {
          busy = false;
          callbacks.push(`${id}:settled`);
        },
      });
      const exchange = (id: string) =>
        flow.run(async (purpose) => {
          const secret = client.invitationCredential();
          const value = await purpose.request('/api/invitations/exchange', passthrough, {
            body: { credential: secret },
          });
          client.forgetInvitationCredential(secret);
          displayed = value;
        }, handlers(id));
      try {
        const old = exchange('A');
        await startedA.promise;
        flow.replace();
        window.location.hash = `#${second}`;
        client.captureInvitationCredential();
        displayed = undefined;
        busy = false;
        const latest = exchange('B');
        assert.deepEqual(
          calls,
          [first],
          'Keep the old mutation barrier until its response settles',
        );
        assert.equal(signalA?.aborted, false, 'Preserve the in-flight mutation cookie response');
        a.resolve(
          new Response(JSON.stringify(oldStatus === 200 ? { invitation: 'A' } : { code: 'old' }), {
            status: oldStatus,
          }),
        );
        await old;
        await startedB.promise;
        assert.equal(displayed, undefined);
        assert.equal(busy, true, 'Old finally must not clear the newer pending action');
        assert.equal(client.invitationCredential(), second);
        b.resolve(new Response(JSON.stringify({ invitation: 'B' })));
        await latest;
        assert.deepEqual(displayed, { invitation: 'B' });
        assert.equal(client.invitationCredential(), undefined);
        assert.equal(busy, false);
        assert.deepEqual(callbacks, ['A:start', 'B:start', 'B:settled']);
        assert.deepEqual(calls, [first, second]);
      } finally {
        flow.replace();
        client.forgetInvitationCredential();
        globalThis.fetch = originalFetch;
        Reflect.deleteProperty(globalThis, 'window');
      }
    });
  }
});

test('superseded context reads abort and late setup handoffs cannot start another authority step', async () => {
  const client = await import('../src/features/auth/invitation-client.ts');
  const originalFetch = globalThis.fetch;
  const flow = client.createInvitationFlow();
  const initial = deferred<Response>();
  const setup = deferred<Response>();
  const entered = deferred<void>();
  const calls: string[] = [];
  let readSignal: AbortSignal | undefined;
  let displayed: unknown;
  globalThis.fetch = async (path, options) => {
    calls.push(String(path));
    if (calls.length === 1) {
      readSignal = options?.signal ?? undefined;
      return initial.promise;
    }
    entered.resolve();
    return setup.promise;
  };
  try {
    const purpose = flow.capture();
    const read = purpose
      .request('/api/invitations/context', passthrough)
      .then((value) => {
        displayed = value;
      })
      .catch(() => {
        if (purpose.current()) displayed = 'read failed';
      });
    flow.replace();
    assert.equal(readSignal?.aborted, true);
    initial.resolve(new Response(JSON.stringify({ invitation: 'old' })));
    await read;
    assert.equal(displayed, undefined);
    const work = flow.run(
      async (current) => {
        const handoff = await current.request(
          '/api/invitations/setup',
          { parse: (value) => value as { destination: string; receipt: string } },
          { body: {} },
        );
        displayed = await current.request(handoff.destination, passthrough, {
          body: { receipt: handoff.receipt },
        });
      },
      {
        start() {},
        async error() {
          displayed = 'setup failed';
        },
        settled() {
          displayed = 'setup settled';
        },
      },
    );
    await entered.promise;
    flow.replace();
    setup.resolve(
      new Response(
        JSON.stringify({ destination: '/identity/invitation-setup/exchange', receipt: 'old' }),
      ),
    );
    await work;
    assert.equal(displayed, undefined);
    assert.deepEqual(calls, ['/api/invitations/context', '/api/invitations/setup']);
  } finally {
    flow.replace();
    globalThis.fetch = originalFetch;
  }
});
