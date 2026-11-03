import assert from 'node:assert/strict';
import test from 'node:test';
import { CONFIGURATION_LIMITS } from '@thaarei/turnstile-contracts';
import { CHART_CARD, layoutStructure } from '../src/features/configuration/structure-layout.ts';
import type { StructureUnit } from '../src/features/configuration/structure-model.ts';

const root: StructureUnit = {
  id: 'root',
  name: 'Organization',
  type: 'organization',
  parentId: null,
  ancestorIds: [],
};
const unit = (id: string, parentId: string, ancestorIds: string[]): StructureUnit => ({
  id,
  name: id,
  type: 'department',
  parentId,
  ancestorIds,
});

test('automatic chart placement keeps a maximum-width organization readable without card overlaps', () => {
  const units = [
    root,
    ...Array.from({ length: CONFIGURATION_LIMITS.units - 1 }, (_, index) =>
      unit(`unit-${index}`, root.id, [root.id]),
    ),
  ];
  const layout = layoutStructure(units);
  const positions = [...layout.positions.values()];
  assert.equal(positions.length, units.length);
  for (const position of positions) {
    assert.ok(position.x >= 0 && position.x + CHART_CARD.width <= layout.width);
    assert.ok(position.y >= 0 && position.y + CHART_CARD.height <= layout.height);
  }
  for (let index = 1; index < positions.length - 1; index++)
    assert.ok(positions[index + 1].x - positions[index].x >= CHART_CARD.width);
  assert.ok(positions[0].y + CHART_CARD.height < positions[1].y);
});

test('collapsed branches, moved subtrees and retained missing editors use only visible canonical relationships', () => {
  const source = unit('source', 'root', ['root']);
  const target = unit('target', 'root', ['root']);
  const child = unit('child', 'source', ['root', 'source']);
  const full = layoutStructure([root, source, child, target]);
  const collapsed = layoutStructure([root, source, target]);
  assert.equal(collapsed.positions.has(child.id), false);
  assert.ok(collapsed.height < full.height);
  const moved = layoutStructure([
    root,
    target,
    { ...source, parentId: 'target', ancestorIds: ['root', 'target'] },
    { ...child, ancestorIds: ['root', 'target', 'source'] },
  ]);
  assert.ok((moved.positions.get(source.id)?.y ?? 0) > (moved.positions.get(target.id)?.y ?? 0));
  assert.ok((moved.positions.get(child.id)?.y ?? 0) > (moved.positions.get(source.id)?.y ?? 0));
  const retained = layoutStructure([
    root,
    unit('removed', 'missing-parent', ['root', 'missing-parent']),
  ]);
  assert.equal(retained.positions.size, 2);
  assert.notEqual(retained.positions.get(root.id)?.x, retained.positions.get('removed')?.x);
});
