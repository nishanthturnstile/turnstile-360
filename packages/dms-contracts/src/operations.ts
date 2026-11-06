import { z } from 'zod';
export const SERVICE_COMPONENTS = [
  'coordinator',
  'publisher',
  'scanner',
  'extractor',
  'heavy',
  'backup',
] as const;
export const servicePresenceSchema = z
  .object({
    state: z.enum(['ready', 'degraded', 'stopping']),
    signatureTime: z.iso.datetime().optional(),
  })
  .strict();
export const operationsSnapshotSchema = z
  .object({
    version: z.literal(1),
    observedAt: z.iso.datetime(),
    processingReady: z.boolean(),
    components: z
      .array(
        z
          .object({
            component: z.enum(SERVICE_COMPONENTS),
            state: z.enum(['ready', 'degraded', 'stopping']),
            observedAt: z.iso.datetime(),
            evidenceAt: z.iso.datetime().nullable(),
            fresh: z.boolean(),
            failures: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(6),
    backlog: z
      .object({
        pending: z.number().int().nonnegative(),
        oldestSeconds: z.number().nonnegative(),
        failed: z.number().int().nonnegative(),
        outbox: z.number().int().nonnegative(),
        oldestOutboxSeconds: z.number().nonnegative(),
        applications: z
          .array(
            z
              .object({
                applicationId: z.uuid(),
                pending: z.number().int().nonnegative(),
                oldestSeconds: z.number().nonnegative(),
              })
              .strict(),
          )
          .max(32),
      })
      .strict(),
    capacity: z
      .object({
        fresh: z.boolean(),
        storageFreeBytes: z.number().nonnegative(),
        scratchFreeBytes: z.number().nonnegative(),
      })
      .strict(),
    alerts: z
      .array(
        z.enum([
          'COMPONENT_UNAVAILABLE',
          'SIGNATURE_STALE',
          'CAPACITY_STALE',
          'STORAGE_LOW',
          'SCRATCH_LOW',
          'BACKUP_UNREPORTED',
          'BACKUP_LAG',
          'BACKLOG_AGE',
          'OUTBOX_AGE',
          'TERMINAL_FAILURES',
          'RECONCILIATION_FAILURES',
        ]),
      )
      .max(11),
  })
  .strict();

export const operationsSnapshotJsonSchema = z.toJSONSchema(operationsSnapshotSchema);

export const authorityKeyCommandSchema = z
  .object({
    action: z.enum(['inspect', 'stage', 'activate']),
    keyId: z.uuid().optional(),
    operatorEmail: z.email(),
    operatorPassword: z.string().min(15).max(128).meta({ writeOnly: true }),
  })
  .strict()
  .refine((v) => (v.action === 'activate') === (v.keyId !== undefined));
export const authorityKeyCommandJsonSchema = z.toJSONSchema(authorityKeyCommandSchema);
