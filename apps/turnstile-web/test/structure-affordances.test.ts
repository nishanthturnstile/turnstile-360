import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canAddBelow,
  canEditUnit,
  canManageChildren,
  createDestinationValidator,
  knownDeleteRestriction,
} from '../src/features/people/structure-affordances.ts';
import type { HierarchyNode } from '../src/features/people/structure-hierarchy.ts';

const root: HierarchyNode = {
  id: 'root',
  name: 'Company',
  type: 'organization',
  parentId: null,
  ancestorIds: [],
  context: true,
};
const site: HierarchyNode = {
  id: 'site',
  name: 'Site',
  type: 'site',
  parentId: 'root',
  ancestorIds: ['root'],
  context: false,
};
const a: HierarchyNode = {
  id: 'a',
  name: 'Source',
  type: 'department',
  parentId: 'site',
  ancestorIds: ['root', 'site'],
  context: false,
};
const b: HierarchyNode = {
  id: 'b',
  name: 'Destination',
  type: 'department',
  parentId: 'site',
  ancestorIds: ['root', 'site'],
  context: false,
};
const child: HierarchyNode = {
  id: 'child',
  name: 'Child',
  type: 'department',
  parentId: 'a',
  ancestorIds: ['root', 'site', 'a'],
  context: false,
};
const nodes = [root, site, a, b, child];
const session = (scope: object, permissions = ['turnstile:units:manage']) =>
  ({ access: { grants: [{ scope, permissions }] } }) as never;

test('exact-unit management permits rename but never advertises child creation', () => {
  const exact = session({ kind: 'units', unitIds: ['site'], includeChildren: false });
  assert.equal(canEditUnit(exact, site), true);
  assert.equal(canAddBelow(exact, site), false);
  const subtree = session({ kind: 'units', unitIds: ['site'], includeChildren: true });
  assert.equal(canAddBelow(subtree, site), true);
  assert.equal(canAddBelow(subtree, a), true);
  assert.equal(canEditUnit(subtree, root), false);
  assert.equal(canAddBelow(subtree, { ...site, context: true }), false);
  const deep: HierarchyNode = {
    id: 'deep',
    name: 'Deep',
    type: 'department',
    parentId: 'a',
    ancestorIds: ['root', 'site', 'a', 'd4', 'd5', 'd6', 'd7'],
    context: false,
  };
  assert.equal(canAddBelow(session({ kind: 'company' }), deep), false);
  assert.equal(
    canManageChildren(session({ kind: 'company' }), deep),
    true,
    'A depth/capacity restriction must not hide an existing recoverable draft',
  );
  assert.equal(canAddBelow(session({ kind: 'company' }), site, 500), false);
});

test('move choices explain cycles, same parent, scope boundaries and known non-leaf deletion', () => {
  const subtree = session({ kind: 'units', unitIds: ['site'], includeChildren: true });
  const validate = createDestinationValidator(subtree, nodes, 'a');
  assert.equal(validate(b), undefined);
  assert.match(validate(a) ?? '', /itself/);
  assert.match(validate(child) ?? '', /descendants/);
  assert.match(validate(site) ?? '', /saved parent/);
  assert.match(validate(root) ?? '', /organization/);
  const exact = session({ kind: 'units', unitIds: ['a', 'b', 'site'], includeChildren: false });
  assert.ok(createDestinationValidator(exact, nodes, 'a')(b));
  assert.ok(knownDeleteRestriction(nodes, 'a'));
  assert.equal(knownDeleteRestriction(nodes, 'b'), undefined);
});
