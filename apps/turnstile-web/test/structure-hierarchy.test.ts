import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { scopedUnitsResponseSchema } from '@thaarei/turnstile-contracts';
import { PeopleError, request } from '../src/features/people/client.ts';
import {
  hierarchyNodes,
  loadScopedHierarchy,
  type ScopedStructurePage,
  visibleHierarchy,
} from '../src/features/people/structure-hierarchy.ts';

const root = randomUUID(),
  site = randomUUID();
const context = {
  id: root,
  name: 'Company',
  type: 'organization' as const,
  actionable: false as const,
};
const unit = (id: string, name = id) => ({
  id,
  name,
  type: 'department' as const,
  parentId: site,
  ancestorIds: [root, site],
});
const siteRow = {
  id: site,
  name: 'Site',
  type: 'site' as const,
  parentId: root,
  ancestorIds: [root],
};
function page(
  units: ScopedStructurePage['units'],
  nextCursor: string | null,
  total: number,
): ScopedStructurePage {
  return {
    revision: 4,
    accessRevision: 7,
    units,
    ancestors: units.some((u) => u.id === site)
      ? [context]
      : [context, { id: site, name: 'Site', type: 'site', actionable: false }],
    nextCursor,
    total,
  };
}

test('production read transport assembles 101 authorized units without promoting path context', async () => {
  const previous = globalThis.fetch;
  const rows = Array.from({ length: 100 }, () => unit(randomUUID()));
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const path = String(input);
    calls.push(path);
    return Response.json(
      path.includes('cursor=') ? page([siteRow], null, 101) : page(rows, 'next', 101),
    );
  };
  try {
    const result = await loadScopedHierarchy(
      (cursor, signal) =>
        request(
          `/api/structure/units?limit=100${cursor ? `&cursor=${cursor}` : ''}`,
          scopedUnitsResponseSchema,
          { signal },
        ),
      new AbortController().signal,
    );
    assert.equal(result.units.length, 101);
    assert.deepEqual(result.ancestors, [context]);
    const nodes = hierarchyNodes(result);
    assert.equal(nodes.find((n) => n.id === root)?.context, true);
    assert.equal(nodes.find((n) => n.id === site)?.context, false);
    assert.equal(nodes.length, 102);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = previous;
  }
});

test('a mixed revision/access revision batch is discarded rather than published', async () => {
  for (const field of ['revision', 'accessRevision'] as const) {
    let calls = 0;
    await assert.rejects(
      loadScopedHierarchy(async () => {
        if (!calls++) return page([unit(randomUUID())], 'next', 2);
        return { ...page([unit(randomUUID())], null, 2), [field]: 99 };
      }, new AbortController().signal),
      (e) => e instanceof PeopleError && e.status === 409,
    );
  }
});

test('the configured 500-node hierarchy loads in at most five bounded reads', async () => {
  const rows = [siteRow, ...Array.from({ length: 498 }, () => unit(randomUUID()))];
  let calls = 0;
  const progress: number[] = [];
  const result = await loadScopedHierarchy(
    async () => {
      const index = calls++;
      return page(
        rows.slice(index * 100, (index + 1) * 100),
        index < 4 ? String(index + 1) : null,
        499,
      );
    },
    new AbortController().signal,
    (p) => progress.push(p.loaded),
  );
  assert.equal(calls, 5);
  assert.equal(hierarchyNodes(result).length, 500);
  assert.deepEqual(progress, [100, 200, 300, 400, 499]);
});

test('cancellation after an in-flight page prevents further reads and progress publication', async () => {
  const controller = new AbortController();
  let calls = 0,
    reports = 0;
  await assert.rejects(
    loadScopedHierarchy(
      async () => {
        calls++;
        controller.abort();
        return page([unit(randomUUID())], 'next', 2);
      },
      controller.signal,
      () => reports++,
    ),
    { name: 'AbortError' },
  );
  assert.equal(calls, 1);
  assert.equal(reports, 0);
});

test('repeated cursors, duplicate units and incomplete totals do not produce a fresh tree', async () => {
  const row = unit(randomUUID());
  for (const scenario of ['cursor', 'duplicate', 'incomplete']) {
    let calls = 0;
    await assert.rejects(
      loadScopedHierarchy(async () => {
        calls++;
        if (scenario === 'incomplete') return page([row], null, 2);
        return page([scenario === 'duplicate' ? row : unit(randomUUID())], 'same', 3);
      }, new AbortController().signal),
      (e) => e instanceof PeopleError && e.code === 'PEOPLE_RESPONSE_INVALID',
    );
    assert.ok(calls <= 2);
  }
});

test('search retains ancestry, disjoint scope stays absent and collapse preserves the selected path', () => {
  const a = unit(randomUUID(), 'Operations'),
    b = unit(randomUUID(), 'Quality');
  const nodes = hierarchyNodes(page([a, b], null, 2));
  assert.equal(nodes.length, 4);
  assert.equal(nodes.find((n) => n.id === site)?.context, true);
  assert.deepEqual(
    visibleHierarchy(nodes, 'Quality', undefined, new Set())
      .map((n) => n.id)
      .sort(),
    [root, site, b.id].sort(),
  );
  assert.deepEqual(visibleHierarchy(nodes, 'Company', undefined, new Set()), []);
  assert.equal(visibleHierarchy(nodes, '', site, new Set([site])).length, 1);
  assert.equal(visibleHierarchy(nodes, '', undefined, new Set([root, site]), b.id).length, 4);
});
