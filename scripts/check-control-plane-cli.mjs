import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'thaarei-central-schema-'));
try {
  const output = join(dir, 'auth.ts');
  execFileSync(
    'pnpm',
    ['exec', 'auth', 'generate', '--config', 'src/server/auth.cli.ts', '--output', output, '--yes'],
    { cwd: resolve('apps/thaarei-control-plane'), stdio: 'pipe', timeout: 30000 },
  );
  const generated = readFileSync(output, 'utf8').replace(/\s+/g, '');
  const committed = readFileSync(
    'apps/thaarei-control-plane/src/server/auth.generated.ts',
    'utf8',
  ).replace(/\s+/g, '');
  // Formatting/import organization is owned by Biome, not the auth CLI.
  execFileSync('pnpm', ['exec', 'auth', 'check', 'schema', '--config', 'src/server/auth.cli.ts'], {
    cwd: resolve('apps/thaarei-control-plane'),
    stdio: 'pipe',
    timeout: 30000,
  });
  for (const model of ['user', 'session', 'account', 'verification', 'twoFactor', 'rateLimit']) {
    assert.ok(
      generated.includes(`exportconst${model}=`) && committed.includes(`exportconst${model}=`),
      `Missing central auth model ${model}`,
    );
  }
  // Compare exact CLI schema after the repository formatter, including MFA lockout fields.
  const formatted = execFileSync(
    'pnpm',
    [
      'exec',
      'biome',
      'check',
      '--write',
      '--stdin-file-path=apps/thaarei-control-plane/src/server/auth.generated.ts',
    ],
    { input: readFileSync(output, 'utf8'), encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(
    formatted.trim(),
    readFileSync('apps/thaarei-control-plane/src/server/auth.generated.ts', 'utf8').trim(),
  );
  console.log('Pinned central auth CLI and committed MFA schema agree offline.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
