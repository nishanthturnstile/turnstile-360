import 'server-only';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  type DeliveryRequest,
  deliveryRequest,
  validateDeliveryRequest,
} from '@thaarei/module-catalog';
import { z } from 'zod';
import type { assignmentDocument } from '../contracts/module-assignments.ts';
import { verifyDeliveryToken } from './module-evidence.ts';
import { runtime } from './runtime.ts';

const descriptor = z
  .object({ request: deliveryRequest, attestation: z.string().min(1).max(32768) })
  .strict();
/** Read-only provisioned POC index: signed references/inventory, never an artifact proxy or builder. */
export async function findDelivery(desired: z.infer<typeof assignmentDocument>) {
  const directory = runtime().config.moduleReferenceDirectory;
  if (!directory) return null;
  try {
    if (
      !isAbsolute(directory) ||
      !lstatSync(directory).isDirectory() ||
      lstatSync(directory).isSymbolicLink()
    )
      return null;
    const path = join(directory, `${desired.profileDigest}.json`),
      stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262144) return null;
    const input = descriptor.parse(JSON.parse(readFileSync(path, 'utf8')));
    const request: DeliveryRequest = await validateDeliveryRequest(input.request);
    if (
      request.profileDigest !== desired.profileDigest ||
      request.profile.catalogueDigest !== desired.profile.catalogueDigest
    )
      return null;
    const evidence = await verifyDeliveryToken(input.attestation, request);
    return {
      adapter: 'local-bundle' as const,
      key: request.profileDigest,
      inventory: evidence.inventory,
    };
  } catch {
    return null;
  }
}
