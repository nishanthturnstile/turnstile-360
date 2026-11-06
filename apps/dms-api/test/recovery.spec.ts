import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BackupRepository } from '../src/infrastructure/recovery/repository.js';

it('authenticates encrypted backup identity and contents before installing plaintext', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dms-recovery-crypto-'));
  let repo: BackupRepository | undefined;
  try {
    const keyFile = join(dir, 'key'),
      source = join(dir, 'source'),
      encrypted = join(dir, 'encrypted'),
      id = randomUUID();
    await writeFile(keyFile, randomBytes(32), { mode: 0o600 });
    const bytes = randomBytes(1024 * 1024);
    await writeFile(source, bytes, { mode: 0o600 });
    repo = await BackupRepository.create({
      id: 'fixture',
      endpoint: 'http://127.0.0.1:1',
      bucket: 'fixture-recovery',
      prefix: 'cohorts',
      region: 'us-east-1',
      accessKeyId: 'a'.repeat(32),
      secretAccessKey: 'b'.repeat(64),
      keyFile,
      fixtureOnly: true,
      offHostAttested: false,
    });
    await repo.encrypt(source, encrypted, id, 'postgres');
    const valid = join(dir, 'valid');
    await repo.decrypt(encrypted, valid, id, 'postgres');
    // Compare streamed binary contents directly rather than recursively walking 1 MiB of bytes.
    expect((await readFile(valid)).equals(bytes)).toBe(true);
    const swapped = join(dir, 'swapped');
    await expect(repo.decrypt(encrypted, swapped, id, 'storage')).rejects.toThrow(
      'Backup authentication failed',
    );
    await expect(stat(swapped)).rejects.toMatchObject({ code: 'ENOENT' });
    const damaged = await readFile(encrypted);
    damaged[50] = (damaged[50] ?? 0) ^ 1;
    await writeFile(encrypted, damaged);
    const bad = join(dir, 'bad');
    await expect(repo.decrypt(encrypted, bad, id, 'postgres')).rejects.toThrow(
      'Backup authentication failed',
    );
    await expect(stat(bad)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    repo?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
