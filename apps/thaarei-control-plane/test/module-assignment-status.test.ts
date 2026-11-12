import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type AssignmentFacts,
  deriveAssignmentStatuses,
} from '../src/contracts/module-assignments.ts';

const target = { catalogueDigest: 'a'.repeat(64), profileDigest: 'b'.repeat(64) };
const base: AssignmentFacts = {
  desired: { ...target, revision: 3, resolvedIds: ['foundation', 'incident-management'] },
  packageProfileDigest: null,
  observed: null,
  effective: null,
  legacy: false,
  policyState: 'pending',
};
test('module delivery status never infers active access from assignment or product approval', () => {
  assert.deepEqual(deriveAssignmentStatuses(base, 100), ['awaiting-package']);
  assert.deepEqual(deriveAssignmentStatuses({ ...base, policyState: 'approved' }, 100), [
    'awaiting-package',
  ]);
  assert.deepEqual(deriveAssignmentStatuses({ ...base, legacy: true }, 100), [
    'awaiting-package',
    'upgrade-required',
  ]);
  assert.deepEqual(
    deriveAssignmentStatuses({ ...base, packageProfileDigest: target.profileDigest }, 100),
    ['ready-for-setup'],
  );
  assert.deepEqual(
    deriveAssignmentStatuses(
      { ...base, packageProfileDigest: target.profileDigest, observed: target },
      100,
    ),
    ['awaiting-activation'],
  );
});
test('status separates active, restricted, outdated inventory and awaiting upgrade facts', () => {
  const active: AssignmentFacts = {
    ...base,
    packageProfileDigest: target.profileDigest,
    policyState: 'approved',
    observed: target,
    effective: {
      ...target,
      assignmentRevision: 3,
      allowedIds: ['foundation', 'incident-management'],
      expiresAt: 101,
    },
  };
  assert.ok(active.effective);
  assert.deepEqual(deriveAssignmentStatuses(active, 100), ['active']);
  assert.deepEqual(deriveAssignmentStatuses(active, 101), ['restricted', 'awaiting-activation']);
  assert.deepEqual(deriveAssignmentStatuses({ ...active, policyState: 'suspended' }, 100), [
    'restricted',
    'awaiting-activation',
  ]);
  assert.deepEqual(
    deriveAssignmentStatuses(
      { ...active, effective: { ...active.effective, allowedIds: ['foundation'] } },
      100,
    ),
    ['restricted', 'awaiting-activation'],
  );
  assert.deepEqual(
    deriveAssignmentStatuses(
      { ...active, observed: { ...target, profileDigest: 'c'.repeat(64) } },
      100,
    ),
    ['upgrade-required', 'inventory-mismatch'],
  );
  assert.deepEqual(
    deriveAssignmentStatuses(
      {
        ...base,
        policyState: 'approved',
        observed: { ...target, profileDigest: 'c'.repeat(64) },
        effective: { ...active.effective, profileDigest: 'c'.repeat(64) },
      },
      100,
    ),
    ['awaiting-package', 'upgrade-required'],
  );
  assert.deepEqual(deriveAssignmentStatuses({ ...base, desired: null }, 100), ['unassigned']);
});
