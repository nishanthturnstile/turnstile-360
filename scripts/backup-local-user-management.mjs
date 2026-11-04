import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { readCandidateInventory } from './user-management-release-inventory.mjs';

try {
  const [directory, candidatePath, ...extra] = process.argv.slice(2);
  assert.ok(directory && candidatePath && isAbsolute(directory) && !extra.length);
  const candidate = readCandidateInventory(candidatePath);
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    assert.ok(Buffer.byteLength(input) <= 4096, 'Bounded private administrator selection required');
  }
  // Reuse only the coherent backup primitive (stopped writers, fixed local
  // installation, private configuration and checksummed ownership/ACL archive).
  // User-management rehearsal/acceptance is performed by its own command.
  const result = spawnSync(
    process.execPath,
    [
      'scripts/backup-local-onboarding.mjs',
      directory,
      candidate.images.api.id,
      candidate.images.web.id,
    ],
    { input, encoding: 'utf8', timeout: 180000 },
  );
  assert.equal(result.status, 0, 'Coherent local backup failed; keep writers paused');
  writeFileSync(
    resolve(directory, 'user-management-release.json'),
    `${JSON.stringify(candidate, null, 2)}\n`,
    { mode: 0o600, flag: 'wx' },
  );
  console.log(
    'Coherent local archive and exact authority/API/web capability inventory captured privately. Rehearse before any target migration.',
  );
} catch {
  console.error(
    'User-management backup failed; keep writers paused. An incomplete backup is not a recovery point.',
  );
  process.exitCode = 1;
}
