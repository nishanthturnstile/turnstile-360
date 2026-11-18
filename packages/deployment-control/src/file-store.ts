import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { type StoredProduct, storedProduct } from './client.js';
// Linux private setup adapter. Product DB adapters must offer equivalent atomic commit/locking.
// The host marker MUST live outside the restored state directory and be changed before restore.
export class ProtectedFileStore {
  constructor(
    readonly directory: string,
    readonly markerFile: string,
  ) {
    if (
      !isAbsolute(directory) ||
      !isAbsolute(markerFile) ||
      resolve(markerFile).startsWith(`${resolve(directory)}/`)
    )
      throw new Error('Independent absolute recovery marker required');
  }
  private async protect(path: string, directory = false) {
    const info = await lstat(path);
    if (
      (directory ? !info.isDirectory() : !info.isFile()) ||
      info.mode & 0o077 ||
      info.uid !== process.getuid?.()
    )
      throw new Error('Operator-owned protected path required');
  }
  async locked<T>(operation: () => Promise<T>): Promise<T> {
    await this.protect(this.directory, true);
    // flock is a kernel lock: process death/EOF releases it, without unsafe stale-PID cleanup.
    const lock = spawn(
      'flock',
      [
        '--exclusive',
        '--timeout',
        '30',
        join(this.directory, 'operation.lock'),
        'sh',
        '-c',
        'printf ready; cat >/dev/null',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const ready = new Promise<void>((resolve, reject) => {
      lock.stdout.once('data', () => resolve());
      lock.once('error', () => reject(new Error('Product lock unavailable')));
      lock.once('exit', () => reject(new Error('Product lock unavailable')));
    });
    try {
      await ready;
      return await operation();
    } finally {
      lock.stdin.end();
      await new Promise<void>((resolve) => {
        if (lock.exitCode !== null) resolve();
        else lock.once('close', () => resolve());
      });
    }
  }
  async recoveryMarker() {
    await this.protect(this.markerFile);
    const marker = (await readFile(this.markerFile, 'utf8')).trim();
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(marker)) throw new Error('Invalid recovery marker');
    return marker;
  }
  async load(): Promise<StoredProduct | null> {
    const path = join(this.directory, 'product.json');
    try {
      await this.protect(path);
      const info = await stat(path);
      if (info.size > 65536) throw new Error('Invalid product state');
      return storedProduct.parse(JSON.parse(await readFile(path, 'utf8')));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        return null;
      throw error;
    }
  }
  async save(value: StoredProduct) {
    const content = JSON.stringify(storedProduct.parse(value));
    const path = join(this.directory, `.product-${randomUUID()}`);
    try {
      const file = await open(path, 'wx', 0o600);
      try {
        await file.writeFile(content);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(path, join(this.directory, 'product.json'));
      const dir = await open(this.directory, 'r');
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    } finally {
      await unlink(path).catch(() => {});
    }
  }
}
