import { z } from 'zod';
import { resolvedRoleAssignmentsSchema, roleAssignmentRequestsSchema } from './access.js';
import { peopleIdSchema, peopleInstantSchema, peopleSubjectSchema } from './people-common.js';

export function createPeopleImportSchemas<P extends string, V extends number>(
  resolvedRoleAssignmentsSchema: ReturnType<
    typeof import('./access.js').createAccessSchemas<P, V>
  >['resolvedRoleAssignmentsSchema'],
) {
  const PEOPLE_IMPORT_LIMITS = {
    csvBytes: 131072,
    bodyBytes: 262144,
    rows: 500,
    activeJobs: 10,
    retainedJobs: 100,
    retentionDays: 90,
    leaseSeconds: 60,
    rowIntervalSeconds: 7,
  } as const;
  const importStateSchema = z.enum([
    'draft',
    'queued',
    'running',
    'paused',
    'completed',
    'cancelled',
  ]);
  const importRowStateSchema = z.enum([
    'pending',
    'processing',
    'succeeded',
    'failed',
    'skipped',
    'cancelled',
  ]);
  const importReasonSchema = z.enum([
    'invalid_email',
    'duplicate_csv',
    'invalid_columns',
    'existing_member',
    'existing_invitation',
    'context_changed',
    'permission_changed',
    'dependency',
    'rate_limit',
    'cancelled',
    'attempts_exhausted',
  ]);
  const importRowSchema = z.strictObject({
    number: z
      .number()
      .int()
      .min(2)
      .max(PEOPLE_IMPORT_LIMITS.rows + 1),
    email: z.string().max(320),
    state: importRowStateSchema,
    reason: importReasonSchema.nullable(),
    invitationId: peopleIdSchema.nullable(),
  });
  const importJobSchema = z.strictObject({
    id: peopleIdSchema,
    actorId: peopleSubjectSchema,
    filename: z.string().min(1).max(120),
    state: importStateSchema,
    version: z.number().int().positive(),
    reason: importReasonSchema.nullable(),
    createdAt: peopleInstantSchema,
    updatedAt: peopleInstantSchema,
    reviewExpiresAt: peopleInstantSchema,
    nextAttemptAt: peopleInstantSchema,
    assignments: resolvedRoleAssignmentsSchema,
    counts: z.strictObject(
      Object.fromEntries(
        ['pending', 'processing', 'succeeded', 'failed', 'skipped', 'cancelled'].map((key) => [
          key,
          z.number().int().min(0).max(PEOPLE_IMPORT_LIMITS.rows),
        ]),
      ) as Record<
        'pending' | 'processing' | 'succeeded' | 'failed' | 'skipped' | 'cancelled',
        z.ZodNumber
      >,
    ),
  });
  const importCreateSchema = z.strictObject({
    id: peopleIdSchema,
    filename: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[^\p{Cc}]+$/u),
    csv: z.string().min(1).max(PEOPLE_IMPORT_LIMITS.csvBytes),
    assignments: roleAssignmentRequestsSchema.refine((value) => value.length > 0),
  });
  const importActionSchema = z.strictObject({
    action: z.enum(['start', 'resume', 'cancel']),
    expectedVersion: z.number().int().positive(),
  });
  const importRowsQuerySchema = z.strictObject({
    after: z.coerce
      .number()
      .int()
      .min(0)
      .max(PEOPLE_IMPORT_LIMITS.rows + 1)
      .default(0),
  });
  const importDetailSchema = z.strictObject({
    job: importJobSchema,
    rows: z.array(importRowSchema).max(25),
    nextAfter: z.number().int().nullable(),
  });
  const importListSchema = z.strictObject({
    items: z.array(importJobSchema).max(PEOPLE_IMPORT_LIMITS.retainedJobs),
  });
  const importErrorsSchema = z.strictObject({
    rows: z.array(importRowSchema).max(PEOPLE_IMPORT_LIMITS.rows),
  });
  const peopleImportSchemas = {
    ImportCreate: importCreateSchema,
    ImportAction: importActionSchema,
    ImportRowsQuery: importRowsQuerySchema,
    ImportJob: importJobSchema,
    ImportDetail: importDetailSchema,
    ImportList: importListSchema,
    ImportErrors: importErrorsSchema,
  };

  return {
    PEOPLE_IMPORT_LIMITS,
    importStateSchema,
    importRowStateSchema,
    importReasonSchema,
    importRowSchema,
    importJobSchema,
    importCreateSchema,
    importActionSchema,
    importRowsQuerySchema,
    importDetailSchema,
    importListSchema,
    importErrorsSchema,
    peopleImportSchemas,
  };
}

export const {
  PEOPLE_IMPORT_LIMITS,
  importStateSchema,
  importRowStateSchema,
  importReasonSchema,
  importRowSchema,
  importJobSchema,
  importCreateSchema,
  importActionSchema,
  importRowsQuerySchema,
  importDetailSchema,
  importListSchema,
  importErrorsSchema,
  peopleImportSchemas,
} = createPeopleImportSchemas(resolvedRoleAssignmentsSchema);
export type ImportJobDto = z.infer<typeof importJobSchema>;
export type ImportRowDto = z.infer<typeof importRowSchema>;
