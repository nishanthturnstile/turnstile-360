import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewedRestriction } from '../dist/index.js';

const module = (id, category = 'individual', requires = ['foundation']) => ({
  id,
  label: id,
  category,
  version: '1.0.0',
  requires,
  optionalIntegrations: [],
});
const catalogue = {
  version: 1,
  id: '00000000-0000-4000-8000-000000000001',
  sourceDigest: 'a'.repeat(64),
  platform: 'linux/amd64',
  contractVersion: 2,
  migrationVersion: 1,
  modules: [
    module('foundation', 'core', []),
    module('incident-management'),
    module('risk-management'),
  ],
};
const replacement = {
  catalogue,
  allowedIds: ['foundation', 'incident-management'],
  targetIds: ['foundation', 'risk-management'],
  explicitlyRemovedIds: ['incident-management'],
  confirmedRemovalClosureIds: ['incident-management'],
};
test('replacement restricts active Individual before additions even across catalogue/classification targets', () => {
  assert.deepEqual(reviewedRestriction(replacement), ['foundation']);
  assert.throws(() =>
    reviewedRestriction({
      ...replacement,
      explicitlyRemovedIds: [],
      confirmedRemovalClosureIds: [],
    }),
  );
  // Target classification cannot erase an explicit removal from the active catalogue.
  assert.deepEqual(
    reviewedRestriction({
      ...replacement,
      targetIds: ['foundation', 'incident-management', 'risk-management'],
    }),
    ['foundation'],
  );
  assert.deepEqual(
    reviewedRestriction({
      ...replacement,
      targetIds: ['foundation', 'incident-management', 'risk-management'],
      explicitlyRemovedIds: [],
      confirmedRemovalClosureIds: [],
    }),
    ['foundation', 'incident-management'],
  );
});
test('active required dependants require confirmation; current Core cannot be removed in place', () => {
  const active = {
    ...catalogue,
    modules: [
      ...catalogue.modules.slice(0, 2),
      module('risk-management', 'individual', ['incident-management']),
    ],
  };
  assert.throws(() =>
    reviewedRestriction({
      ...replacement,
      catalogue: active,
      allowedIds: ['foundation', 'incident-management', 'risk-management'],
      targetIds: ['foundation'],
      confirmedRemovalClosureIds: ['incident-management'],
    }),
  );
  assert.deepEqual(
    reviewedRestriction({
      ...replacement,
      catalogue: active,
      allowedIds: ['foundation', 'incident-management', 'risk-management'],
      targetIds: ['foundation'],
      confirmedRemovalClosureIds: ['incident-management', 'risk-management'],
    }),
    ['foundation'],
  );
  const core = {
    ...catalogue,
    modules: catalogue.modules.map((m) =>
      m.id === 'incident-management' ? { ...m, category: 'core' } : m,
    ),
  };
  assert.throws(() => reviewedRestriction({ ...replacement, catalogue: core }));
  assert.deepEqual(
    reviewedRestriction({
      ...replacement,
      catalogue: core,
      explicitlyRemovedIds: [],
      confirmedRemovalClosureIds: [],
    }),
    ['foundation', 'incident-management'],
  );
});
