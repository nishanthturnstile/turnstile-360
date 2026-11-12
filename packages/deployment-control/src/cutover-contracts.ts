import { installedModuleIdentity } from '@thaarei/module-catalog';
import { z } from 'zod';

const path = z.string().startsWith('/').max(4096);
export const moduleCutoverIntent = z
  .object({
    requestId: z.uuid(),
    desiredRevision: z.number().int().positive(),
    policyRevision: z.number().int().positive(),
    target: installedModuleIdentity,
  })
  .strict();
export const moduleCutoverInput = z
  .object({
    review: z
      .object({
        reviewId: z.uuid(),
        expectedAccessRevision: z.number().int().nonnegative(),
        administratorUserId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
        administratorCookie: z.string().min(1).max(8192),
      })
      .strict()
      .optional(),
    action: z.enum(['prepare', 'verify', 'reconcile']),
    requestId: z.uuid(),
    planDirectory: path,
    sourceBundleDirectory: path,
    targetBundleDirectory: path,
    releaseTrustFile: path,
    network: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/),
    ownerEnvironmentFile: path,
    privateDirectory: path,
    mounts: z.array(path).max(16),
    containers: z
      .array(
        z
          .object({
            id: z.string().regex(/^[0-9a-f]{64}$/),
            role: z.enum(['api', 'reporter', 'web']),
          })
          .strict(),
      )
      .min(3)
      .max(16)
      .refine(
        (v) =>
          new Set(v.map((c) => c.id)).size === v.length &&
          ['api', 'reporter', 'web'].every((r) => v.some((c) => c.role === r)),
      ),
    desiredRevision: z.number().int().positive(),
    policyRevision: z.number().int().positive(),
    operatorId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
    expectedAccessRevision: z.number().int().nonnegative().max(2147483646),
  })
  .strict();
