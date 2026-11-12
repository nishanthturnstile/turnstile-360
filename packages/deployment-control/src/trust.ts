import { z } from 'zod';
export const trustBundle = z
  .object({
    version: z.literal(1),
    revision: z.number().int().positive(),
    issuer: z.string().url(),
    keys: z
      .array(
        z
          .object({
            kid: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
            pem: z.string().min(100).max(8192),
            status: z.enum(['active', 'retired', 'revoked']),
            lastIssuedAt: z.number().int().positive().nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export type TrustBundle = z.infer<typeof trustBundle>;

// Trust is delivered by an independent operator/release channel; tokens cannot edit it.
export async function readProtectedTrust(path: string): Promise<TrustBundle> {
  const { lstat, readFile } = await import('node:fs/promises');
  const { isAbsolute } = await import('node:path');
  const file = await lstat(path);
  if (
    !isAbsolute(path) ||
    !file.isFile() ||
    file.mode & 0o022 ||
    file.size > 200000 ||
    ![0, process.getuid?.()].includes(file.uid)
  )
    throw new Error('Protected operator trust file required');
  return trustBundle.parse(JSON.parse(await readFile(path, 'utf8')));
}
