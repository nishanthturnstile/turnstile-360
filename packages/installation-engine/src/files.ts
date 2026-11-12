import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function protect(path: string, directory = false) {
  if (!isAbsolute(path) || realpathSync(path) !== path)
    throw new Error('Canonical private path required');
  const s = lstatSync(path);
  if (
    s.isSymbolicLink() ||
    !(directory ? s.isDirectory() : s.isFile()) ||
    s.mode & 0o077 ||
    s.uid !== process.getuid?.() ||
    (!directory && s.nlink !== 1)
  )
    throw new Error('Operator-owned private path required');
  return s;
}
export function privateText(path: string, max = 2 * 1024 ** 2) {
  const s = protect(path);
  if (s.size > max) throw new Error('Private input bound');
  return readFileSync(path, 'utf8');
}
export function atomic(path: string, text: string) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temp, 'wx', 0o600);
  try {
    writeFileSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
  const dir = openSync(dirname(path), 'r');
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}
export const writeJson = (path: string, value: unknown) => atomic(path, JSON.stringify(value));
