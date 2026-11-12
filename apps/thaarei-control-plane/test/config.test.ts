import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig } from '../src/server/config.ts';

test('central configuration rejects noncanonical production origin and unprotected secret delivery', () => {
  const dir = mkdtempSync(join(tmpdir(), 'central-config-'));
  const file = join(dir, 'secret');
  try {
    writeFileSync(file, randomBytes(48).toString('base64url'), { mode: 0o600 });
    const env = {
      CONTROL_PLANE_PUBLIC_ORIGIN: 'https://control.example',
      CONTROL_PLANE_DATABASE_URL: 'postgresql://control_plane_runtime:unused@localhost/central',
      CONTROL_PLANE_AUTH_SECRET_FILE: file,
      CONTROL_PLANE_SMTP_URL: 'smtps://smtp.example:465',
      CONTROL_PLANE_SMTP_FROM: 'control@example.test',
    };
    assert.equal(parseConfig(env).production, true);
    assert.equal(parseConfig(env).decisionSeconds, 7 * 86400);
    assert.equal(parseConfig({ ...env, CONTROL_PLANE_DECISION_SECONDS: '60' }).decisionSeconds, 60);
    for (const value of ['0', '59', '604801', '60.1', 'invalid', ''])
      assert.throws(() => parseConfig({ ...env, CONTROL_PLANE_DECISION_SECONDS: value }));
    assert.deepEqual(
      parseConfig({ ...env, CONTROL_PLANE_DMS_SUPPORTED_VERSIONS: '["1.0.0"]' }).supportedVersions
        .dms,
      ['1.0.0'],
    );
    for (const value of ['invalid', '["<script>"]', '{}'])
      assert.throws(
        () => parseConfig({ ...env, CONTROL_PLANE_DMS_SUPPORTED_VERSIONS: value }),
        /configuration/,
      );
    assert.throws(
      () =>
        parseConfig({
          ...env,
          CONTROL_PLANE_DATABASE_URL:
            'postgresql://control_plane_migrator:unused@localhost/central',
        }),
      /runtime role/,
    );
    for (const origin of [
      'http://localhost:23600',
      'https://control.example/',
      'https://control.example/path',
      'https://user:secret@control.example',
      'https://control.example?query=1',
    ]) {
      assert.throws(
        () => parseConfig({ ...env, CONTROL_PLANE_PUBLIC_ORIGIN: origin }),
        /canonical HTTPS/,
      );
    }
    assert.throws(
      () => parseConfig({ ...env, CONTROL_PLANE_AUTH_SECRET_FILE: 'relative' }),
      /absolute/,
    );
    assert.throws(
      () => parseConfig({ ...env, CONTROL_PLANE_SMTP_URL: 'https://smtp.example' }),
      /SMTP/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
