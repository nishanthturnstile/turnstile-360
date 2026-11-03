import assert from 'node:assert/strict';
import test from 'node:test';
import { CONFIGURATION_LIMITS } from '@thaarei/turnstile-contracts';
import {
  createMoveValidator,
  moveRestriction,
  removalRestriction,
  type StructureUnit,
  unitPath,
} from '../src/features/configuration/structure-model.ts';

const root: StructureUnit = {
  id: 'root',
  type: 'organization',
  parentId: null,
  name: 'Organization',
  ancestorIds: [],
};
const department = (
  id: string,
  parentId: string,
  ancestorIds: string[],
  name = id,
): StructureUnit => ({ id, type: 'department', name, parentId, ancestorIds });
const units: StructureUnit[] = [
  root,
  department('source', 'root', ['root'], 'Operations'),
  department('child', 'source', ['root', 'source']),
  { id: 'site', type: 'site', name: 'North', parentId: 'root', ancestorIds: ['root'] },
];
test('a move keeps the entire subtree valid; root/self/descendant and Site relationships are rejected', () => {
  assert.equal(moveRestriction(units, 'source', 'site'), undefined);
  for (const [id, target] of [
    ['root', 'site'],
    ['source', 'source'],
    ['source', 'child'],
    ['site', 'source'],
    ['source', 'root'],
    ['missing', 'site'],
  ] as const)
    assert.ok(moveRestriction(units, id, target));
});
test('whole subtree height reaches eight exactly and rejects nine', () => {
  const chain = [...units];
  for (let level = 2; level <= 6; level++)
    chain.push(
      department(`d${level}`, level === 2 ? 'root' : `d${level - 1}`, [
        'root',
        ...Array.from({ length: level - 2 }, (_, n) => `d${n + 2}`),
      ]),
    );
  assert.equal(moveRestriction(chain, 'source', 'd6'), undefined);
  chain.push(department('grandchild', 'child', ['root', 'source', 'child']));
  assert.ok(moveRestriction(chain, 'source', 'd6'));
});
test('same names under different parents remain distinguishable, and case collisions reject a destination', () => {
  const duplicate = [...units, department('duplicate', 'site', ['root', 'site'], 'OPERATIONS')];
  assert.ok(moveRestriction(duplicate, 'source', 'site'));
  assert.notEqual(unitPath(duplicate, 'source'), unitPath(duplicate, 'duplicate'));
});
test('completed v2 final required units and referenced parents cannot be removed; legacy v1 leaf policy remains optional', () => {
  const single = [root, department('only', 'root', ['root'])];
  assert.equal(removalRestriction(single, 'only', false), undefined);
  assert.ok(removalRestriction(single, 'only', true));
  assert.ok(removalRestriction(units, 'source', false));
  assert.equal(removalRestriction(units, 'site', true), undefined);
});

test('indexed moves handle the maximum wide structure and refresh sibling rules after moves and renames', () => {
  const full: StructureUnit[] = [
    root,
    ...Array.from({ length: CONFIGURATION_LIMITS.units - 2 }, (_, index) => ({
      id: `site-${index}`,
      type: 'site' as const,
      name: `Site ${index}`,
      parentId: root.id,
      ancestorIds: [root.id],
    })),
    department('operations', root.id, [root.id], 'Operations'),
  ];
  const validate = createMoveValidator(full, true);
  const movable = full.filter((unit) => full.some((parent) => !validate(unit.id, parent.id)));
  assert.deepEqual(
    movable.map((unit) => unit.id),
    ['operations'],
  );
  assert.equal(validate('operations', 'site-0'), undefined);
  const changed = full.map((unit) =>
    unit.id === 'site-1'
      ? { ...unit, name: 'OPERATIONS' }
      : unit.id === 'operations'
        ? { ...unit, parentId: 'site-0', ancestorIds: [root.id, 'site-0'] }
        : unit,
  );
  const refreshed = createMoveValidator(changed, true);
  assert.match(refreshed('operations', root.id) ?? '', /already exists/);
  assert.equal(refreshed('operations', 'site-1'), undefined);
});
