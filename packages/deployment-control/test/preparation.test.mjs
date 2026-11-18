import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { preparePrivateFiles } from '../dist/index.js';

test('a real interrupted file write resumes the committed private plan without generating new secrets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'private-preparation-'));
  let generated = 0;
  try {
    const invoke = () =>
      preparePrivateFiles(dir, 'fixture', { id: 'one' }, ['first', 'second'], () => {
        generated++;
        mkdirSync(join(dir, 'second'));
        return {
          files: { first: 'original-secret', second: 'independent-secret' },
          result: { id: 'one' },
        };
      });
    assert.throws(invoke);
    assert.equal(readFileSync(join(dir, 'first'), 'utf8'), 'original-secret');
    rmSync(join(dir, 'second'), { recursive: true });
    assert.deepEqual(invoke(), { id: 'one' });
    assert.equal(generated, 1);
    for (const file of ['first', 'second', '.fixture-preparation.json'])
      assert.equal(statSync(join(dir, file)).mode & 0o077, 0);
    assert.throws(() =>
      preparePrivateFiles(dir, 'fixture', { id: 'two' }, ['first', 'second'], () => {
        throw new Error('must not regenerate');
      }),
    );
    writeFileSync(join(dir, 'second'), 'changed');
    assert.throws(invoke);
    assert.equal(readFileSync(join(dir, 'second'), 'utf8'), 'changed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('fresh preparation rejects existing configuration and private-plan symlinks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'private-existing-'));
  try {
    writeFileSync(join(dir, 'existing'), 'retained', { mode: 0o600 });
    assert.throws(() =>
      preparePrivateFiles(dir, 'fixture', {}, ['existing'], () => ({
        files: { existing: 'replacement' },
        result: {},
      })),
    );
    symlinkSync(join(dir, 'existing'), join(dir, '.fixture-preparation.json'));
    assert.throws(() =>
      preparePrivateFiles(dir, 'fixture', {}, ['existing'], () => ({ files: {}, result: {} })),
    );
    assert.equal(readFileSync(join(dir, 'existing'), 'utf8'), 'retained');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
