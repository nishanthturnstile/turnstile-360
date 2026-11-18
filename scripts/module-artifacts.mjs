import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash } from './module-build-source.mjs';
import { moduleSources } from './module-source-map.mjs';

export function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  assert.equal(
    r.status,
    0,
    `${cmd} failed: ${(r.stderr || '')
      .split('\n')
      .filter((line) =>
        /AssertionError|Error:|ENOENT|TS[0-9]|Mismatch|mismatch|actual:|expected:|at file:/.test(
          line,
        ),
      )
      .slice(0, 20)
      .join('\n')}\n${(r.stderr || '').slice(-1600)}`,
  );
  return r.stdout.trim();
}
export const docker = (args) => run('docker', args);
export function fileInventory(dir, prefix = '') {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name),
        key = prefix + name,
        s = lstatSync(path);
      if (s.isSymbolicLink()) return [{ path: key, link: readlinkSync(path) }];
      if (s.isDirectory()) return fileInventory(path, `${key}/`);
      assert.ok(s.isFile(), 'Unexpected packaged file');
      return [{ path: key, digest: hash(readFileSync(path)) }];
    });
}
export function inspectImage(image, kind, request) {
  const id = docker(['image', 'inspect', '--format', '{{.Id}}', image]);
  const config = JSON.parse(docker(['image', 'inspect', '--format', '{{json .Config}}', id]));
  assert.ok(
    config.User && config.User !== 'root' && config.User !== '0',
    'Non-root runtime required',
  );
  const platform = docker(['image', 'inspect', '--format', '{{.Os}}/{{.Architecture}}', id]);
  assert.equal(platform, request.profile.platform);
  const container = `module-inspect-${randomUUID()}`,
    temp = mkdtempSync(join(tmpdir(), 'module-image-'));
  docker(['create', '--name', container, id]);
  try {
    const root = kind === 'api' ? '/app' : '/usr/share/nginx/html';
    docker(['cp', `${container}:${root}/.`, temp]);
    const selection = JSON.parse(readFileSync(join(temp, 'module-selection.json'), 'utf8'));
    assert.deepEqual(selection.request, request, 'Image request mismatch');
    assert.equal(
      hash(JSON.stringify(selection.source)),
      request.profile.sourceDigest,
      'Source ownership inventory mismatch',
    );
    const ids = request.profile.modules.map((m) => m.id),
      inventory = fileInventory(temp);
    const dependencies = inventory
      .filter(
        (f) => f.path.startsWith('node_modules/') && f.path.endsWith('/package.json') && f.digest,
      )
      .map((f) => {
        const p = JSON.parse(readFileSync(join(temp, f.path), 'utf8'));
        return { path: f.path, name: p.name ?? null, version: p.version ?? null };
      });
    // Feature code is confined by checked import boundaries to its owned directory;
    // the two placeholders have no private package or module-specific third-party dependency.
    for (const module of Object.keys(moduleSources)) {
      const owned = inventory.filter((f) => f.path.startsWith(`dist/features/${module}/`));
      assert.equal(
        owned.length > 0,
        kind === 'api' && ids.includes(module),
        `Unexpected owned output ${module}`,
      );
    }
    assert.ok(
      inventory.every((f) => !f.path.split('/').some((n) => n === '.env' || n.startsWith('.env.'))),
      'Environment in image',
    );
    if (kind === 'api') {
      const top = readdirSync(temp).sort();
      assert.deepEqual(
        top,
        [
          'LICENSE',
          'THIRD_PARTY_NOTICES',
          'database',
          'dist',
          'module-selection.json',
          'node_modules',
          'package.json',
        ].sort(),
        'Unowned runtime root',
      );
      // Compiler maps are retained, but each source reference must belong to selected source.
      for (const f of inventory.filter(
        (f) => f.path.startsWith('dist/') && f.path.endsWith('.map'),
      )) {
        const map = JSON.parse(readFileSync(join(temp, f.path), 'utf8'));
        assert.ok(!map.sourcesContent, 'Embedded source is not part of customer delivery');
        for (const s of map.sources)
          for (const module of Object.keys(moduleSources))
            if (s.includes(`/features/${module}/`))
              assert.ok(ids.includes(module), 'Excluded source map');
      }
      for (const module of ids.filter((x) => x !== 'foundation')) {
        const result = JSON.parse(
          docker([
            'run',
            '--rm',
            '--network',
            'none',
            id,
            'node',
            '--input-type=module',
            '-e',
            `console.log(JSON.stringify((await import('./dist/features/${module}/entry.js')).entry()))`,
          ]),
        );
        assert.equal(result.id, module);
      }
    } else {
      const ownership = JSON.parse(readFileSync(join(temp, '.vite/module-ownership.json'), 'utf8'));
      const manifest = JSON.parse(readFileSync(join(temp, '.vite/manifest.json'), 'utf8'));
      for (const module of Object.keys(moduleSources)) {
        assert.equal(
          Object.hasOwn(manifest, `src/features/${module}/entry.tsx`),
          ids.includes(module),
        );
        const owners = ownership.filter((c) =>
          c.modules.some((m) => m.includes(`/features/${module}/`)),
        );
        assert.equal(owners.length > 0, ids.includes(module), 'Chunk ownership mismatch');
      }
      assert.ok(
        inventory.every((f) => !f.path.endsWith('.map')),
        'Unexpected browser source maps',
      );
      for (const chunk of ownership)
        assert.ok(
          inventory.some((f) => f.path === chunk.file),
          'Missing owned chunk',
        );
      assert.ok(inventory.some((f) => f.path === 'index.html'));
    }
    return { image: id.slice(7), inventory, dependencies };
  } finally {
    docker(['rm', container]);
    rmSync(temp, { recursive: true, force: true });
  }
}
