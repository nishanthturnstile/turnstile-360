import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryObserver } from '@tanstack/react-query';
import {
  capturePeopleWrite,
  subscribePeopleWrites,
  writeDomains,
} from '../src/features/people/cache-events.ts';
import { request } from '../src/features/people/client.ts';
import {
  createPeopleQueryClient,
  invalidatePeopleDomains,
  peopleQueryKey,
  peopleScope,
  refreshVerifiedPeopleQueries,
  retirePeopleScopes,
} from '../src/features/people/query-cache.ts';

const scope = peopleScope('alice', 'grants-1');
const key = (url: string, revision = 1) => peopleQueryKey(scope, revision, url);
function testClient() {
  const client = createPeopleQueryClient();
  const defaults = client.getDefaultOptions();
  assert.equal(defaults.queries?.gcTime, 300_000);
  assert.equal(defaults.queries?.staleTime, 30_000);
  // These tests exercise cancellation, not elapsed garbage collection. A cancelled
  // fetch may schedule GC after removal; avoid keeping the Node runner alive for it.
  client.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, gcTime: Infinity } });
  return client;
}

test('fresh tab revisits and concurrent metadata readers reuse one wire response', async () => {
  const client = testClient();
  let calls = 0;
  const options = {
    queryKey: key('/api/people/catalog'),
    queryFn: async () => {
      calls++;
      return { items: [{ role: { id: 'reader' } }] };
    },
  };
  try {
    const [first, second] = await Promise.all([
      client.fetchQuery(options),
      client.fetchQuery(options),
    ]);
    assert.equal(calls, 1);
    assert.equal(first, second);
    await client.fetchQuery(options);
    assert.equal(calls, 1);
    const flat = new QueryObserver(client, {
      ...options,
      select: (wire) => wire.items.map((item) => item.role),
    });
    const nested = new QueryObserver(client, options);
    assert.deepEqual(flat.getCurrentResult().data, [{ id: 'reader' }]);
    assert.deepEqual(nested.getCurrentResult().data, first);
    assert.equal(calls, 1, 'different consumer projections do not fetch or corrupt shared data');
  } finally {
    client.clear();
  }
});

test('filters, cursors, revisions, subjects and permission generations isolate cache entries', () => {
  const base = key('/api/people/members?status=active&roleId=reader');
  assert.deepEqual(base, key('/api/people/members?roleId=reader&status=active'));
  for (const other of [
    key('/api/people/members?roleId=admin&status=active'),
    key('/api/people/members?roleId=reader&status=suspended'),
    key('/api/people/members?roleId=reader&status=active&cursor=next'),
    key('/api/people/members?roleId=reader&status=active', 2),
    peopleQueryKey(peopleScope('bob', 'grants-1'), 1, String(base.at(-1))),
    peopleQueryKey(peopleScope('alice', 'grants-2'), 1, String(base.at(-1))),
  ])
    assert.notDeepEqual(base, other);
});

test('owning writes mark dependent reads stale without loading unrelated or inactive tabs', async () => {
  const client = testClient();
  const paths = ['/api/people/members', '/api/people/roles/one/usage', '/api/people/audit'];
  try {
    for (const path of [...paths, '/api/structure/units', '/api/organization'])
      client.setQueryData(key(path), { fixture: true });
    const other = peopleQueryKey(peopleScope('bob', 'other'), 1, paths[0] ?? '');
    client.setQueryData(other, { fixture: true });
    await invalidatePeopleDomains(client, scope, writeDomains('/api/people/members/one', 'PATCH'));
    for (const path of paths) assert.equal(client.getQueryState(key(path))?.isInvalidated, true);
    for (const queryKey of [key('/api/structure/units'), key('/api/organization'), other])
      assert.equal(client.getQueryState(queryKey)?.isInvalidated, false);
    assert.deepEqual(writeDomains('/api/people/impact', 'POST'), []);
    assert.deepEqual(writeDomains('/api/structure/move-impact', 'POST'), []);
    assert.deepEqual(writeDomains('/api/people/members'), []);
    assert.deepEqual(writeDomains('/api/people/imports/job/resume', 'POST'), ['imports']);
    assert.ok(writeDomains('/api/structure/units/unit', 'PATCH').includes('organization'));
  } finally {
    client.clear();
  }
});

test('verified background refresh retains visible data, deduplicates and waits on inactive tabs', async () => {
  const client = testClient();
  const queryKey = key('/api/people/members');
  client.setQueryData(queryKey, ['before']);
  client.setQueryData(key('/api/people/invitations'), []);
  let release: (data: string[]) => void = () => {};
  let calls = 0;
  const observer = new QueryObserver(client, {
    queryKey,
    queryFn: () => {
      calls++;
      return new Promise<string[]>((resolve) => {
        release = resolve;
      });
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    await invalidatePeopleDomains(client, scope, ['members', 'invitations']);
    assert.equal(calls, 0);
    const first = refreshVerifiedPeopleQueries(client, scope);
    const second = refreshVerifiedPeopleQueries(client, scope);
    assert.equal(calls, 1);
    assert.deepEqual(observer.getCurrentResult().data, ['before']);
    assert.equal(observer.getCurrentResult().isFetching, true);
    release(['after']);
    await Promise.all([first, second]);
    assert.deepEqual(observer.getCurrentResult().data, ['after']);
    assert.equal(client.getQueryState(key('/api/people/invitations'))?.isInvalidated, true);
  } finally {
    unsubscribe();
    client.clear();
  }
});

test('permission loss aborts real request transport and discards late protected responses', async () => {
  const client = testClient();
  const original = globalThis.fetch;
  let signal: AbortSignal | undefined;
  let release: (value: Response) => void = () => {};
  globalThis.fetch = async (_url, init) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>((resolve) => {
      release = resolve;
    });
  };
  try {
    const pending = client.fetchQuery({
      queryKey: key('/api/people/members'),
      queryFn: ({ signal }) => request('/api/people/members', { parse: (v) => v }, { signal }),
    });
    const settled = pending.catch(() => undefined);
    retirePeopleScopes(client, peopleScope('alice', 'grants-2'), true);
    assert.equal(signal?.aborted, true);
    release(new Response(JSON.stringify({ protected: 'old grant' }), { status: 200 }));
    await settled;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(client.getQueryCache().getAll().length, 0);
    client.setQueryData(
      peopleQueryKey(peopleScope('alice', 'grants-2'), 2, '/api/people/members'),
      [],
    );
    retirePeopleScopes(client, peopleScope('alice', 'grants-2'), false);
    assert.equal(
      client.getQueryCache().getAll().length,
      0,
      'auth unavailability also clears reads',
    );
  } finally {
    globalThis.fetch = original;
    client.clear();
  }
});

test('a late read from before an intervening write cannot make the old rows fresh again', async () => {
  const client = testClient();
  const queryKey = key('/api/people/members');
  client.setQueryData(queryKey, ['before']);
  let release: (value: string[]) => void = () => {};
  const pending = client
    .fetchQuery({
      queryKey,
      staleTime: 0,
      queryFn: () =>
        new Promise<string[]>((resolve) => {
          release = resolve;
        }),
    })
    .catch(() => undefined);
  try {
    await invalidatePeopleDomains(client, scope, ['members']);
    await client.fetchQuery({ queryKey, queryFn: async () => ['saved'] });
    release(['old reply']);
    await pending;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(client.getQueryData(queryKey), ['saved']);
    assert.equal(client.getQueryState(queryKey)?.isInvalidated, false);
  } finally {
    client.clear();
  }
});

test('transport errors are not retried and only acknowledged valid writes invalidate', async () => {
  const original = globalThis.fetch;
  const notifications: unknown[] = [];
  const stop = subscribePeopleWrites((domains) => notifications.push(domains));
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new TypeError('lost acknowledgement');
  };
  const client = testClient();
  try {
    const send = () => request('/api/people/roles/one', { parse: (v) => v }, { method: 'PATCH' });
    await assert.rejects(send());
    assert.equal(calls, 1);
    assert.deepEqual(notifications, []);
    await assert.rejects(client.fetchQuery({ queryKey: key('/api/people/roles'), queryFn: send }));
    assert.equal(calls, 2, 'the query client has no automatic retries either');
    globalThis.fetch = async () => new Response('{}', { status: 200 });
    await request('/api/people/impact', { parse: (v) => v }, { method: 'POST' });
    assert.deepEqual(notifications, []);
    await assert.rejects(
      request(
        '/api/people/roles/one',
        {
          parse() {
            throw new Error('invalid');
          },
        },
        { method: 'PATCH' },
      ),
    );
    assert.deepEqual(notifications, []);
    await send();
    assert.equal(notifications.length, 1);
  } finally {
    stop();
    globalThis.fetch = original;
    client.clear();
  }
});

test('late acknowledgements invalidate their original owner, never a replacement session', () => {
  let oldCalls = 0;
  let newCalls = 0;
  const stop = subscribePeopleWrites(() => {
    oldCalls++;
  });
  const acknowledge = capturePeopleWrite('/api/people/invitations', 'POST');
  stop();
  const stopNew = subscribePeopleWrites(() => {
    newCalls++;
  });
  try {
    acknowledge();
    assert.equal(oldCalls, 1);
    assert.equal(newCalls, 0);
  } finally {
    stopNew();
  }
});
