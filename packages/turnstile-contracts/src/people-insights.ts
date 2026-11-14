import { z } from 'zod';
import { assignmentScopeSchema } from './access.js';
import {
  accessRevisionSchema,
  canonicalPeopleIdSchema,
  PEOPLE_LIMITS,
  peopleIdSchema,
  peopleInstantSchema,
  peopleListQuerySchema,
  peoplePermissionSchema,
  peopleSubjectSchema,
} from './people-common.js';

export const auditActions = [
  'legacy_retired',
  'member_assignments_changed',
  'member_suspended',
  'member_reactivated',
  'role_created',
  'role_details_changed',
  'role_permissions_changed',
  'role_deleted',
  'unit_coverage_changed',
  'invitation_changed',
  'issued',
  'resent',
  'reapproved',
  'cancelled',
  'expired',
  'invalidated',
  'smtp_accepted',
  'delivery_failed',
  'delivery_unknown',
  'accepted',
  'declined',
] as const;
export const peopleAuditQuerySchema = peopleListQuerySchema
  .omit({ search: true })
  .extend({
    source: z.enum(['access', 'invitations']).optional(),
    action: z.enum(auditActions).optional(),
    subjectId: canonicalPeopleIdSchema.optional(),
    from: peopleInstantSchema.optional(),
    to: peopleInstantSchema.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, 'Invalid date range');
export const peopleAuditEventSchema = z.strictObject({
  id: canonicalPeopleIdSchema,
  source: z.enum(['access', 'invitations']),
  action: z.enum(auditActions),
  occurredAt: peopleInstantSchema,
  actorKind: z.enum(['user', 'system']),
  actorId: peopleSubjectSchema.nullable(),
  actorName: z.string().min(1).max(200).optional(),
  subjectId: canonicalPeopleIdSchema.nullable(),
  subjectLabel: z.string().min(1).max(320).optional(),
  subjectKind: z.enum(['member', 'role', 'invitation']).optional(),
  revisionBefore: accessRevisionSchema.nullable(),
  revisionAfter: accessRevisionSchema.nullable(),
  generation: z.number().int().min(1).nullable(),
});
export const peopleAuditResponseSchema = z.strictObject({
  items: z.array(peopleAuditEventSchema).max(100),
  nextCursor: z.string().max(2048).nullable(),
  retentionDays: z.literal(PEOPLE_LIMITS.auditRetentionDays),
  accessRevision: accessRevisionSchema,
});
export const accessInspectionQuerySchema = z.strictObject({
  permission: peoplePermissionSchema,
  unitId: peopleIdSchema.optional(),
});
export const accessInspectionSchema = z.strictObject({
  memberId: canonicalPeopleIdSchema,
  permission: peoplePermissionSchema,
  unitId: canonicalPeopleIdSchema.nullable(),
  memberStatus: z.enum(['active', 'suspended']),
  allowed: z.boolean(),
  reason: z.enum([
    'granted',
    'suspended',
    'no_workspace_entry',
    'company_only',
    'no_matching_grant',
  ]),
  sources: z
    .array(
      z.strictObject({
        id: canonicalPeopleIdSchema,
        name: z.string().min(1).max(320),
        scope: assignmentScopeSchema,
      }),
    )
    .max(33),
  accessRevision: accessRevisionSchema,
});
export const peopleInsightSchemas = {
  PeopleAuditQuery: peopleAuditQuerySchema,
  PeopleAuditEvent: peopleAuditEventSchema,
  PeopleAuditResponse: peopleAuditResponseSchema,
  AccessInspectionQuery: accessInspectionQuerySchema,
  AccessInspection: accessInspectionSchema,
};
export type PeopleAuditEventDto = z.infer<typeof peopleAuditEventSchema>;
export type PeopleAuditResponseDto = z.infer<typeof peopleAuditResponseSchema>;
