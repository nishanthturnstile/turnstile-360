import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

function syncedWrite(path: string, content: string) {
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function syncDirectory(root: string) {
  const fd = openSync(root, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
const planSchema = z
  .object({
    version: z.literal(1),
    fingerprint: z.string().length(64),
    files: z.record(z.string(), z.string()),
    result: z.record(z.string(), z.unknown()),
  })
  .strict();
export function protectedFile(path: string) {
  const s = lstatSync(path);
  if (!s.isFile() || s.isSymbolicLink() || (s.mode & 0o077) !== 0 || s.size > 2097152)
    throw new Error('Protected regular preparation file required');
  return readFileSync(path, 'utf8');
}
/** Commit generated secrets once before individual writes. Replay never overwrites an existing file. */
export function preparePrivateFiles(
  directory: string,
  owner: string,
  input: unknown,
  ownedNames: string[],
  generate: () => { files: Record<string, string>; result: Record<string, unknown> },
) {
  if (!/^[a-z-]+$/.test(owner)) throw new Error('Invalid owner');
  const root = resolve(directory);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const s = lstatSync(root);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077) !== 0)
    throw new Error('Private preparation directory required');
  const path = join(root, `.${owner}-preparation.json`),
    fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  if (!existsSync(path)) {
    if (readdirSync(root).some((name) => ownedNames.includes(name)))
      throw new Error('Existing configuration cannot be adopted by fresh preparation');
    const generated = generate(),
      temporary = join(root, `.${owner}-${randomUUID()}.tmp`);
    syncedWrite(temporary, JSON.stringify({ version: 1, fingerprint, ...generated }));
    try {
      linkSync(temporary, path);
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'EEXIST' ||
        !existsSync(path)
      )
        throw error;
    } finally {
      rmSync(temporary);
    }
  }
  const plan = planSchema.parse(JSON.parse(protectedFile(path)));
  syncDirectory(root);
  if (JSON.stringify(Object.keys(plan.files).sort()) !== JSON.stringify([...ownedNames].sort()))
    throw new Error('Incomplete private preparation plan');
  if (plan.fingerprint !== fingerprint)
    throw new Error('Preparation inputs changed; reconcile without replacing secrets');
  for (const [name, content] of Object.entries(plan.files)) {
    if (!ownedNames.includes(name) || name.includes('/') || name.includes('\\'))
      throw new Error('Unowned preparation output');
    const target = join(root, name);
    if (existsSync(target)) {
      if (protectedFile(target) !== content)
        throw new Error('Existing private configuration differs');
    } else {
      const temporary = join(root, `.configuration-${randomUUID()}.tmp`);
      syncedWrite(temporary, content);
      try {
        linkSync(temporary, target);
        syncDirectory(root);
      } catch (error) {
        if (
          !error ||
          typeof error !== 'object' ||
          !('code' in error) ||
          error.code !== 'EEXIST' ||
          !existsSync(target) ||
          protectedFile(target) !== content
        )
          throw error;
      } finally {
        rmSync(temporary);
      }
    }
  }
  return plan.result;
}
export function rawEnvironment(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values))
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\r\n\0]/.test(value))
      throw new Error('Single-line environment values required');
  return (
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n'
  );
}
