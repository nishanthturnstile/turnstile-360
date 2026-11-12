import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  readProtectedTrust,
  type VerifiedModuleRelease,
  verifyInstalledModuleRelease,
} from '@thaarei/deployment-control';
import { z } from 'zod';
import { installedModuleProfile } from '../../module-release-profile.js';

const descriptor = z
  .object({ request: z.unknown(), attestation: z.string().min(100).max(32768) })
  .strict();
/** Rechecked against independent public trust on every load, including revocation. */
export async function installedModuleRelease(): Promise<VerifiedModuleRelease | null> {
  if (installedModuleProfile === null) return null;
  const path = process.env.TURNSTILE_MODULE_RELEASE_FILE;
  const trust = process.env.TURNSTILE_MODULE_RELEASE_TRUST_FILE;
  if (!path || !trust || !isAbsolute(path))
    throw new Error('Protected installed module release required');
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.mode & 0o022 ||
    info.size > 262144 ||
    ![0, process.getuid?.()].includes(info.uid)
  )
    throw new Error('Protected module release file required');
  const proof = descriptor.parse(JSON.parse(await readFile(path, 'utf8')));
  return verifyInstalledModuleRelease(
    proof.attestation,
    proof.request,
    installedModuleProfile,
    await readProtectedTrust(trust),
    Math.floor(Date.now() / 1000),
  );
}
