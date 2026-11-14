import assert from 'node:assert/strict';
import test from 'node:test';
import type { DeploymentStatusDto, UserSessionDto } from '@thaarei/turnstile-contracts';
import {
  canReuseUsersContext,
  type UsersContextStamp,
} from '../src/features/people/navigation-state.ts';

test('only rapid cross-tab navigation reuses non-auth context, with a fixed expiry', () => {
  const session = { user: { id: 'alice' }, access: { fingerprint: 'grants-1' } } as UserSessionDto;
  const deployment = { access: 'full', state: 'approved' } as DeploymentStatusDto;
  const previous: UsersContextStamp = {
    path: '/people/members',
    userId: 'alice',
    fingerprint: 'grants-1',
    complete: true,
    checkedAt: 1000,
    deployment,
  };
  const reuse = (patch: Partial<UsersContextStamp> = {}, path = '/people/roles', now = 2000) =>
    canReuseUsersContext({ ...previous, ...patch }, path, session, deployment, now);
  assert.equal(reuse(), true);
  assert.equal(reuse({}, '/people/activity'), true);
  assert.equal(reuse({}, '/people/members'), false, 'focus and explicit checks are comprehensive');
  assert.equal(reuse({}, '/structure'), false);
  assert.equal(reuse({ path: '/' }), false);
  assert.equal(reuse({ userId: 'bob' }), false);
  assert.equal(reuse({ fingerprint: 'grants-2' }), false);
  assert.equal(reuse({ complete: false }), false);
  assert.equal(reuse({ deployment: { ...deployment, access: 'closed' } }), false);
  assert.equal(reuse({}, '/people/roles', 999), false);
  assert.equal(reuse({}, '/people/roles', 31_000), false);
  assert.equal(reuse({ path: '/people/invitations' }, '/people/roles', 30_999), true);
  assert.equal(reuse({ path: '/people/invitations' }, '/people/roles', 31_000), false);
});
