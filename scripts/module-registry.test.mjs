import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProfile, resolveSelection } from '../packages/module-catalog/dist/index.js';
import {
  defineModules,
  MODULE_REGISTRY,
} from '../packages/turnstile-contracts/src/module-registry.ts';
import { permissionMigration, registrationChanges } from './module-registry.mjs';

const permit = {
  id: 'permit-management',
  title: 'Permit Management',
  version: '1.0.0',
  permission: 'turnstile:permits:read',
  requires: ['foundation'],
  optionalIntegrations: [],
};
const ledger = Object.fromEntries(MODULE_REGISTRY.map((m) => [m.id, m.permission]));

test('third module uses the same registration, permission migration and selection contract', async () => {
  const modules = defineModules([...MODULE_REGISTRY, permit]);
  const additions = registrationChanges(modules, ledger);
  assert.deepEqual(additions, [permit]);
  assert.match(permissionMigration(additions), /'turnstile:permits:read',true/);
  const catalogue = {
    version: 1,
    id: '10000000-0000-4000-8000-000000000001',
    sourceDigest: 'a'.repeat(64),
    platform: 'linux/amd64',
    contractVersion: 2,
    migrationVersion: 1,
    modules: [
      {
        id: 'foundation',
        label: 'Foundation',
        version: '1.0.0',
        category: 'core',
        requires: [],
        optionalIntegrations: [],
      },
      ...modules.map((m) => ({
        id: m.id,
        label: m.title,
        version: m.version,
        category: 'individual',
        requires: m.requires,
        optionalIntegrations: m.optionalIntegrations,
      })),
    ],
  };
  const selected = { requestedIndividualIds: [permit.id] };
  const resolved = resolveSelection(catalogue, selected).resolvedIds;
  assert.deepEqual(resolved, ['foundation', permit.id]);
  assert.deepEqual(
    (await createProfile(catalogue, selected, resolved)).modules.map((m) => m.id),
    resolved,
  );
  const retained = { ...ledger, [permit.id]: permit.permission };
  assert.deepEqual(
    registrationChanges([...MODULE_REGISTRY, { ...permit, enabled: false }], retained),
    [],
    'Retirement preserves historical permission identity',
  );
  assert.throws(
    () =>
      registrationChanges(
        [...MODULE_REGISTRY, { ...permit, permission: 'turnstile:renamed:read' }],
        retained,
      ),
    /immutable/,
  );
  assert.throws(
    () =>
      registrationChanges(
        [...MODULE_REGISTRY, { ...permit, enabled: false }, { ...permit, id: 'another-module' }],
        retained,
      ),
    /permission/,
  );
});

test('registry rejects invalid, duplicate and unsatisfied dependency configurations', () => {
  assert.throws(() => defineModules([...MODULE_REGISTRY, MODULE_REGISTRY[0]]));
  assert.throws(() => defineModules([{ ...permit, id: '../escape' }]));
  assert.throws(() => defineModules([{ ...permit, requires: ['missing-module'] }]));
  assert.throws(() => defineModules([{ ...permit, requires: [permit.id] }]));
});
