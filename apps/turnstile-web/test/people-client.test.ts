import assert from 'node:assert/strict';
import test from 'node:test';
import { commandTarget, PeopleError, request } from '../src/features/people/client.ts';

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
