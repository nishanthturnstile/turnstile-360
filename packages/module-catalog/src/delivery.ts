import { z } from 'zod';
import { catalogue, deliveryInventory, digest, profile } from './contracts.js';

/** Generic reusable build identity. No customer fields, commands, locations or credentials. */
export const deliveryRequest = z
  .object({ version: z.literal(1), catalogue, profile, profileDigest: digest })
  .strict();
export type DeliveryRequest = z.infer<typeof deliveryRequest>;
export const DELIVERY_TYPE = 'thaarei-module-delivery+jwt';
export const DELIVERY_AUDIENCE = 'urn:thaarei:module-delivery';
export const deliveryEvidence = z
  .object({
    version: z.literal(1),
    kind: z.literal('delivery'),
    requestDigest: digest,
    inventory: deliveryInventory,
    artifactInventoryDigest: digest,
    documentationDigest: digest,
  })
  .strict();
export type DeliveryEvidence = z.infer<typeof deliveryEvidence>;
