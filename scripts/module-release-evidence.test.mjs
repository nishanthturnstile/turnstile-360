import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { seal, snapshotPaths, verifyRecord } from './module-release-evidence.mjs';

test('freeze detects source substitution, executable drift and record tamper', () => {
  const dir = mkdtempSync(join(tmpdir(), 'module-evidence-'));
  try {
    writeFileSync(join(dir, 'installer'), 'original', { mode: 0o644 });
    const files = snapshotPaths(['installer'], dir),
      record = seal({ source: { workspaceFiles: files }, productionAccepted: false });
    verifyRecord(record, files);
    chmodSync(join(dir, 'installer'), 0o755);
    assert.throws(
      () => verifyRecord(record, snapshotPaths(['installer'], dir)),
      /source\/document drift/,
    );
    chmodSync(join(dir, 'installer'), 0o644);
    writeFileSync(join(dir, 'installer'), 'substituted');
    assert.throws(
      () => verifyRecord(record, snapshotPaths(['installer'], dir)),
      /source\/document drift/,
    );
    assert.throws(
      () => verifyRecord({ ...record, productionAccepted: true }, files),
      /checksum changed/,
    );
    symlinkSync('installer', join(dir, 'alias'));
    assert.throws(() => snapshotPaths(['alias'], dir), /Regular source files/);
    assert.throws(() => snapshotPaths(['../outside'], dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
