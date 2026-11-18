import assert from 'node:assert/strict';
import { lstat, mkdir, readdir, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

// Next 16.4 emits hashed external-module aliases under .next/node_modules. pnpm deploy
// excludes nested node_modules and relocates the store; reconstruct only the emitted
// aliases against the deployed, version-matched production dependencies.
const source = resolve(process.argv[2]);
const destination = resolve(process.argv[3]);
const manifest = JSON.parse(await readFile(join(destination, 'package.json'), 'utf8'));
async function relocate(folder, prefix = '') {
  for (const name of await readdir(folder)) {
    const entry = join(folder, name);
    const info = await lstat(entry);
    if (info.isDirectory() && name.startsWith('@')) {
      await relocate(entry, `${name}/`);
      continue;
    }
    assert.ok(info.isSymbolicLink(), 'Unexpected Next external alias artifact');
    const dependency = JSON.parse(await readFile(join(entry, 'package.json'), 'utf8'));
    assert.ok(
      manifest.dependencies[dependency.name],
      'External alias must be a production dependency',
    );
    const installed = await realpath(join(destination, 'node_modules', dependency.name));
    const installedManifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
    assert.equal(
      installedManifest.version,
      dependency.version,
      'External dependency version drift',
    );
    const alias = join(destination, '.next/node_modules', prefix, name);
    await mkdir(dirname(alias), { recursive: true });
    await rm(alias, { force: true });
    await symlink(relative(dirname(alias), installed), alias);
  }
}
await relocate(join(source, '.next/node_modules'));
console.log('Next external aliases relocated against deployed production dependencies.');
