import assert from 'node:assert/strict';
import { test } from 'node:test';
import { structureOutline } from '../src/features/people/structure-outline.ts';

test('scoped outline reconstructs ancestry and keeps path-only ancestors non-actionable', () => {
  const outline = structureOutline({
    revision: 1,
    accessRevision: 1,
    total: 2,
    nextCursor: null,
    ancestors: [
      { id: 'root', name: 'Company', type: 'organization', actionable: false },
      { id: 'site', name: 'North', type: 'site', actionable: false },
    ],
    units: [
      {
        id: 'team-b',
        name: 'Operations',
        type: 'department',
        parentId: 'site',
        ancestorIds: ['root', 'site'],
      },
      {
        id: 'team-a',
        name: 'Accounts',
        type: 'department',
        parentId: 'site',
        ancestorIds: ['root', 'site'],
      },
    ],
  });
  assert.equal(outline.length, 1);
  assert.equal(outline[0]?.actionable, false);
  const site = outline[0]?.children[0];
  assert.equal(site?.actionable, false);
  assert.deepEqual(
    site?.children.map((n) => [n.name, n.actionable]),
    [
      ['Accounts', true],
      ['Operations', true],
    ],
  );
});

test('a later/search page contains only its returned units and supplied ancestry', () => {
  const outline = structureOutline({
    revision: 2,
    accessRevision: 2,
    total: 19,
    nextCursor: 'next',
    ancestors: [{ id: 'root', name: 'Company', type: 'organization', actionable: false }],
    units: [{ id: 'site', name: 'North', type: 'site', parentId: 'root', ancestorIds: ['root'] }],
  });
  assert.equal(outline[0]?.children.length, 1);
  assert.equal(outline[0]?.children[0]?.actionable, true);
  assert.deepEqual(outline[0]?.children[0]?.children, []);
});
