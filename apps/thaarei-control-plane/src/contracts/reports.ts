import { z } from 'zod';

export const reportQuery = z
  .object({
    clientId: z.uuid().optional(),
    environment: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/)
      .optional(),
    product: z.enum(['dms', 'turnstile']).optional(),
    after: z.uuid().optional(),
  })
  .strict();
export const historyQuery = z
  .object({ before: z.iso.datetime({ offset: true }).optional(), beforeId: z.uuid().optional() })
  .strict()
  .refine((v) => !!v.before === !!v.beforeId);
