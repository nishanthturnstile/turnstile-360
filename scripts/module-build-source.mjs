import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codeModules } from './module-source-map.mjs';

export const hash = (v) => createHash('sha256').update(v).digest('hex');
export const sourceRoots = [
  '.dockerignore',
  'package.json',
  'apps/dms-api/package.json',
  'apps/dms-processing/package.json',
  'apps/thaarei-control-plane/package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
  'tsconfig.boundaries.json',
  'LICENSE',
  'THIRD_PARTY_NOTICES',
  'tooling/typescript',
  'tooling/dependency-rules/config.cjs',
  'patches',
  'packages',
  'apps/turnstile-api/src',
  'apps/turnstile-api/database',
  'apps/turnstile-api/package.json',
  'apps/turnstile-api/Dockerfile',
  'apps/turnstile-api/tsconfig.json',
  'apps/turnstile-api/tsconfig.build.json',
  'apps/turnstile-api/nest-cli.json',
  'apps/turnstile-web/src',
  'apps/turnstile-web/public',
  'apps/turnstile-web/package.json',
  'apps/turnstile-web/Dockerfile',
  'apps/turnstile-web/index.html',
  'apps/turnstile-web/vite.config.ts',
  'apps/turnstile-web/tsconfig.json',
  'apps/turnstile-web/tsconfig.app.json',
  'apps/turnstile-web/tsconfig.node.json',
  'deploy/nginx/nginx.conf',
  'scripts/assemble-module-runtime.mjs',
  'scripts/compose-selected-modules.mjs',
  'scripts/module-source-map.mjs',
  'scripts/module-build-source.mjs',
  'scripts/module-artifacts.mjs',
  'scripts/module-delivery.mjs',
  'scripts/prepare-installation.mjs',
  'scripts/installation-intent.mjs',
  'scripts/test-onboarding-images.mjs',
];
const excluded = new Set(['node_modules', 'dist', '.turbo', 'test', 'tests', '__pycache__']);
export function sourceInventory() {
  const walk = (path) => {
    const s = lstatSync(path);
    assert.ok(!s.isSymbolicLink(), 'Source symlinks are not supported');
    if (s.isDirectory())
      return readdirSync(path)
        .sort()
        .filter((n) => !excluded.has(n) && !n.endsWith('.tsbuildinfo'))
        .flatMap((n) => walk(join(path, n)));
    assert.ok(
      s.isFile() && !path.split('/').some((n) => n.startsWith('.env')),
      'Unowned source input',
    );
    return [{ path, digest: hash(readFileSync(path)) }];
  };
  return sourceRoots.flatMap(walk).sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
export function sourceCatalogue(sourceDigest, platform = 'linux/amd64') {
  // Deterministic UUIDv8 per source/platform; a new code release cannot collide with an immutable central row.
  const bytes = Buffer.from(
    hash(`thaarei-code-catalogue:${sourceDigest}:${platform}`).slice(0, 32),
    'hex',
  );
  bytes[6] = (bytes[6] & 15) | 128;
  bytes[8] = (bytes[8] & 63) | 128;
  const value = bytes.toString('hex'),
    id = `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  return {
    version: 1,
    id,
    sourceDigest,
    platform,
    contractVersion: 2,
    migrationVersion: 1,
    modules: codeModules,
  };
}
export function assertCodeCatalogue(catalogue) {
  assert.deepEqual(
    catalogue.modules
      .map((m) => ({ ...m, category: undefined }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    codeModules
      .map((m) => ({ ...m, category: undefined }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    'Catalogue code facts differ from pinned source',
  );
  assert.equal(catalogue.contractVersion, 2);
  assert.equal(catalogue.migrationVersion, 1);
}
