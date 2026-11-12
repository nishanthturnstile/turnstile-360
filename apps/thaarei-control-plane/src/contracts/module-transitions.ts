import {
  activeContext,
  desiredContext,
  installedModuleIdentity,
  moduleIds,
  revision,
} from '@thaarei/module-catalog';
import { z } from 'zod';
export const moduleActivationCommand = z
  .object({
    operationId: z.uuid(),
    expectedRevision: revision,
    desiredRevision: revision,
    epoch: z.uuid(),
    installed: installedModuleIdentity,
    activeBasis: activeContext.nullable(),
    reason: z.string().trim().min(1).max(300),
  })
  .strict();
export const moduleObservation = z
  .object({ epoch: z.uuid(), installed: installedModuleIdentity, observedAt: z.iso.datetime() })
  .strict();
export const effectiveModuleAuthority = z
  .object({
    epoch: z.uuid(),
    active: activeContext,
    desired: desiredContext,
    allowedIds: moduleIds,
  })
  .strict();

export const moduleActivationJsonSchema = z.toJSONSchema(moduleActivationCommand, { io: 'input' });

export const enforcementCommand = z
  .object({
    operationId: z.uuid(),
    expectedRevision: z.number().int().positive().max(2147483646),
    reason: z.string().trim().min(1).max(300),
  })
  .strict();
