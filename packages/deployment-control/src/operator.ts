import { lstat, readFile, writeFile } from 'node:fs/promises';
import { localSetupManifest, manifest, pairingFile } from '@thaarei/control-plane-contracts';
import { z } from 'zod';
import { DeploymentClient, httpsTransport } from './client.js';
import { ProtectedFileStore } from './file-store.js';
import { readProtectedTrust } from './verifier.js';

async function main() {
  async function operatorJson(path: string, secret = false) {
    const file = await lstat(path);
    if (
      !file.isFile() ||
      file.mode & (secret ? 0o077 : 0o022) ||
      file.size > 32768 ||
      ![0, process.getuid?.()].includes(file.uid)
    )
      throw new Error('Protected operator file required');
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  }
  // Supply private file paths through stdin. No secret values/decisions are printed.
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 4096) throw new Error('Input too large');
  }
  const command = z
    .discriminatedUnion('action', [
      z
        .object({
          action: z.literal('manifest'),
          localIdentityFile: z.string(),
          outputFile: z.string(),
        })
        .strict(),
      z
        .object({
          action: z.enum(['setup', 'rebind', 'rotate', 'sync', 'quarantine']),
          directory: z.string(),
          markerFile: z.string(),
          trustFile: z.string(),
          manifestFile: z.string(),
          pairingFile: z.string().optional(),
        })
        .strict(),
    ])
    .parse(JSON.parse(input));
  if (command.action === 'manifest') {
    const local = localSetupManifest.parse(await operatorJson(command.localIdentityFile));
    await writeFile(command.outputFile, JSON.stringify(local, null, 2), {
      flag: 'wx',
      mode: 0o600,
    });
    console.log('Nonsecret setup manifest exported.');
    return;
  }
  const expected = manifest.parse(await operatorJson(command.manifestFile));
  const store = new ProtectedFileStore(command.directory, command.markerFile);
  if (command.action === 'quarantine') {
    await store.locked(async () => {
      const value = await store.load();
      if (value?.decision) {
        value.decision.quarantined = true;
        await store.save(value);
      }
    });
  } else {
    const client = new DeploymentClient(store, httpsTransport(expected.origin), async () =>
      readProtectedTrust(command.trustFile),
    );
    if (command.action === 'setup' || command.action === 'rebind') {
      if (!command.pairingFile) throw new Error('Private pairing file required');
      const file = pairingFile.parse(await operatorJson(command.pairingFile, true));
      if (
        JSON.stringify(
          manifest.parse({ version: file.version, origin: file.origin, binding: file.binding }),
        ) !== JSON.stringify(expected)
      )
        throw new Error('Reviewed manifest mismatch');
      await client.setup(file, command.action === 'rebind');
    } else if (command.action === 'rotate') await client.rotate();
    else await client.sync();
  }
  console.log('Private deployment operation completed.');
}
main().catch(() => {
  console.error(
    'Private deployment operation failed; preserve protected files and inspect the saved outcome before retrying.',
  );
  process.exitCode = 1;
});
