import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COMPANY_ONLY_PERMISSIONS,
  moduleCapabilitiesSchema,
  moduleEntrySchema,
  SYSTEM_ROLE_TEMPLATES,
} from '../dist/index.js';

test('module projection cannot expose unbounded links, duplicate modules or unbound access', () => {
  const module = {
    id: 'incident-management',
    title: 'Incident Management',
    path: '/modules/incident-management',
  };
  const context = {
    catalogueDigest: 'a'.repeat(64),
    profileDigest: 'b'.repeat(64),
    releaseId: 'c'.repeat(64),
    policyRevision: 1,
    assignmentRevision: 1,
  };
  assert.deepEqual(
    moduleCapabilitiesSchema.parse({ version: 1, modules: [module], context }).modules,
    [module],
  );
  assert.throws(() =>
    moduleCapabilitiesSchema.parse({ version: 1, modules: [module, module], context }),
  );
  assert.throws(() =>
    moduleCapabilitiesSchema.parse({ version: 1, modules: [module], context: null }),
  );
  assert.throws(() =>
    moduleEntrySchema.parse({
      id: 'incident-management',
      title: 'Risk Management',
      message: 'hidden',
    }),
  );
  assert.throws(() =>
    moduleCapabilitiesSchema.parse({
      version: 1,
      modules: [{ ...module, path: 'https://outside.invalid' }],
      context,
    }),
  );
  assert.deepEqual(
    moduleCapabilitiesSchema.parse({ version: 1, modules: [], context: null }).modules,
    [],
  );
});
test('module rights are explicit company permissions absent from every system template', () => {
  for (const permission of ['turnstile:incidents:read', 'turnstile:risks:read']) {
    assert.ok(COMPANY_ONLY_PERMISSIONS.includes(permission));
    for (const role of SYSTEM_ROLE_TEMPLATES) assert.ok(!role.permissions.includes(permission));
  }
});
