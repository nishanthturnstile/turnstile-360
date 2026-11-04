import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSession, ProductError, productRequest } from '../src/features/auth/product.ts';

const sessionAt = (revision = 4) => ({
  user: { id: 'fixture-user', name: 'Fixture', email: 'fixture@example.test' },
  permissions: ['turnstile:access'],
  csrfToken: 'A'.repeat(43),
  session: { expiresAt: '2026-11-04T12:00:00Z', idleExpiresAt: '2026-11-04T11:00:00Z' },
  access: {
    catalogVersion: 1,
    accessRevision: revision,
    fingerprint: (revision === 4 ? 'a' : 'b').repeat(64),
    grants: [
      {
        sourceId: '20000000-0000-4000-8000-000000000001',
        permissions: ['turnstile:access'],
        scope: { kind: 'company' },
      },
    ],
  },
});

test('validates canonical session context and surfaces access changes without replaying a mutation', async () => {
  const original = globalThis.fetch;
  let requests = 0;
  const session = sessionAt();
  let body: unknown = { ...session, access: undefined };
  let status = 200;
  globalThis.fetch = async () => {
    requests++;
    return new Response(JSON.stringify(body), { status });
  };
  try {
    await assert.rejects(
      loadSession(),
      (error) => error instanceof ProductError && error.code === 'AUTH_UNAVAILABLE',
    );
    body = session;
    assert.deepEqual((await loadSession()).access, session.access);
    body = {
      code: 'ACCESS_CONTEXT_CHANGED',
      requestId: '20000000-0000-4000-8000-000000000002',
      reason: 'state',
      accessRevision: 5,
    };
    status = 409;
    const before = requests;
    await assert.rejects(
      productRequest('/api/organization', {
        method: 'PATCH',
        csrf: session.csrfToken,
        body: { name: 'Retained draft' },
      }),
      (error) =>
        error instanceof ProductError &&
        error.status === 409 &&
        error.code === 'ACCESS_CONTEXT_CHANGED',
    );
    assert.equal(requests, before + 1);
  } finally {
    globalThis.fetch = original;
  }
});

for (const fails of [false, true]) {
  test(`fresh session read drains an older ${fails ? 'failure' : 'success'} before fetching post-mutation context`, async () => {
    const original = globalThis.fetch;
    const releases: (() => void)[] = [];
    let requests = 0;
    let active = 0;
    let maximumActive = 0;
    let secondStarted!: () => void;
    const second = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });
    globalThis.fetch = async () => {
      const index = requests++;
      active++;
      maximumActive = Math.max(maximumActive, active);
      const release = new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      if (index === 1) secondStarted();
      await release;
      active--;
      if (index === 0 && fails) throw new Error('Old session dependency failed');
      return new Response(JSON.stringify(sessionAt(index === 0 ? 4 : 5)));
    };
    try {
      const old = loadSession();
      // Ordinary concurrent readers retain the existing single-flight contract.
      assert.equal(loadSession(), old);
      const settledOld = old.then(
        (value) => value,
        (error: unknown) => error,
      );
      const fresh = loadSession({ fresh: true });
      assert.equal(loadSession(), fresh, 'Ordinary readers must join the freshness barrier');
      await Promise.resolve();
      assert.equal(requests, 1, 'Fresh reads must wait for the old response to settle');
      releases[0]?.();
      await second;
      const oldResult = await settledOld;
      if (fails) assert.ok(oldResult instanceof ProductError);
      else assert.deepEqual(oldResult, sessionAt(4));
      const ordinary = loadSession();
      assert.equal(requests, 2, 'Ordinary reads share the fresh in-flight request');
      releases[1]?.();
      const [current, shared] = await Promise.all([fresh, ordinary]);
      assert.deepEqual(current, sessionAt(5));
      assert.equal(shared, current);
      assert.equal(maximumActive, 1, 'Session fetches must never overlap');
      assert.equal(requests, 2);
    } finally {
      for (const release of releases) release();
      globalThis.fetch = original;
    }
  });
}
