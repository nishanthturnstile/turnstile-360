import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canManageUnit,
  commandTarget,
  message,
  PeopleError,
  request,
} from '../src/features/people/client.ts';

const id = '20000000-0000-4000-8000-000000000001';
test('routes strict commands through the frozen method/path catalog', () => {
  const target = commandTarget({
    operation: 'member.suspend',
    id,
    expectedVersion: 1,
    expectedAccessRevision: 1,
    expectedOrganizationRevision: 2,
  });
  assert.equal(target.method, 'POST');
  assert.equal(target.path, `/api/people/members/${id}/suspend`);
  assert.throws(() => commandTarget({ operation: 'member.suspend', id, actorId: 'forged' }));
});
test('never automatically replays an uncertain mutation and scrubs dependency errors', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('sensitive provider message');
  };
  try {
    await assert.rejects(
      request(
        '/api/people/roles',
        { parse: (v) => v },
        { method: 'POST', csrf: 'fixture', key: id, body: {} },
      ),
      (e) =>
        e instanceof PeopleError &&
        e.code === 'PEOPLE_UNAVAILABLE' &&
        !e.message.includes('sensitive'),
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test('retains finite conflict and current-state readback without resending mutations', async () => {
  const original = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (_url, init) => {
    methods.push(init?.method ?? 'GET');
    return new Response(
      JSON.stringify({ code: 'PEOPLE_CONFLICT', reason: 'impact_stale', requestId: id }),
      { status: 409 },
    );
  };
  try {
    await assert.rejects(
      request('/api/people/roles', { parse: (v) => v }, { method: 'PATCH', body: {} }),
      (e) => e instanceof PeopleError && e.status === 409 && e.reason === 'impact_stale',
    );
    assert.deepEqual(methods, ['PATCH']);
  } finally {
    globalThis.fetch = original;
  }
});

test('unit edit controls respect read-only, exact-unit and subtree coverage', () => {
  const session = (permissions: string[], scope: object) =>
    ({ access: { grants: [{ permissions, scope }] } }) as never;
  assert.equal(
    canManageUnit(session(['turnstile:units:read'], { kind: 'company' }), 'child', ['site']),
    false,
  );
  assert.equal(
    canManageUnit(
      session(['turnstile:units:manage'], {
        kind: 'units',
        unitIds: ['site'],
        includeChildren: false,
      }),
      'child',
      ['site'],
    ),
    false,
  );
  assert.equal(
    canManageUnit(
      session(['turnstile:units:manage'], {
        kind: 'units',
        unitIds: ['site'],
        includeChildren: true,
      }),
      'child',
      ['site'],
    ),
    true,
  );
  assert.equal(
    canManageUnit(session(['turnstile:configuration:manage'], { kind: 'company' }), 'child', [
      'site',
    ]),
    true,
  );
});

test('catalog requests explicitly opt in to new capabilities', async () => {
  const original = globalThis.fetch;
  const observed = [];
  globalThis.fetch = async (_path, init) => {
    observed.push(new Headers(init?.headers));
    return new Response('{}', { status: 200 });
  };
  try {
    await request('/api/people/catalog', { parse: (value) => value });
    await request('/api/people/members', { parse: (value) => value });
    assert.equal(observed[0].get('x-turnstile-people-features'), 'imports-v1');
    assert.equal(observed[1].has('x-turnstile-people-features'), false);
  } finally {
    globalThis.fetch = original;
  }
});
test('a rejected successful response has refresh guidance and remains uncertain for writes', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('{}', { status: 200 });
  };
  try {
    await assert.rejects(
      request(
        '/api/people/members',
        {
          parse: () => {
            throw new Error('private response contents');
          },
        },
        { method: 'POST', body: {} },
      ),
      (error) => {
        assert.ok(error instanceof PeopleError);
        assert.equal(error.code, 'PEOPLE_RESPONSE_INVALID');
        assert.equal(error.status, 503); // Keep the existing uncertain-mutation recovery path.
        assert.match(message(error), /Refresh the page/);
        assert.doesNotMatch(message(error), /service is unavailable|private response/);
        return true;
      },
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
