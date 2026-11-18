import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resetEntry } from '../src/app/access/reset-entry.ts';

test('invalid reset callbacks request a new email instead of offering a password form', () => {
  for (const search of [
    '?flow=reset&error=INVALID_TOKEN',
    '?flow=reset',
    '?flow=reset&token=',
    '?flow=reset&token=used-token&error=INVALID_TOKEN',
    `?flow=reset&token=${'x'.repeat(1025)}`,
  ]) {
    const entry = resetEntry(search);
    assert.equal(entry?.mode, 'forgot');
    assert.equal(entry?.token, '');
    assert.match(entry?.message ?? '', /invalid or has expired/);
  }
});

test('valid reset callbacks retain their token and ordinary entry remains sign in', () => {
  assert.deepEqual(resetEntry('?flow=reset&token=fixture-reset-token'), {
    mode: 'reset',
    token: 'fixture-reset-token',
    message: '',
  });
  assert.equal(resetEntry(''), undefined);
  assert.equal(resetEntry('?token=unrelated'), undefined);
});
