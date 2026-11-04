import { z } from 'zod';
import {
  accessSchemas,
  memberSchema,
  resolvedRoleAssignmentsSchema,
  roleAssignmentRequestsSchema,
  roleDefinitionSchema,
  scopedUnitContextSchema,
  scopedUnitDetailSchema,
} from './access.js';
import { unitNameSchema } from './onboarding.js';
import {
  accessRevisionSchema,
  canonicalInvitationEmailSchema,
  canonicalPeopleIdSchema,
  impactTokenSchema,
  invitationEmailSchema,
  invitationListQuerySchema,
  memberListQuerySchema,
  peopleDigestSchema,
  peopleEmptySchema,
  peopleIdSchema,
  peopleInstantSchema,
  peopleListQuerySchema,
  peopleMutationHeadersSchema,
  peoplePageSchema,
  peoplePathSchema,
  peopleSecretSchema,
  peopleSubjectSchema,
  peopleVersionSchema,
  roleDescriptionSchema,
  roleListQuerySchema,
  roleNameSchema,
  rolePermissionsSchema,
  uniqueValues,
} from './people-common.js';

export const invitationStateSchema = z.enum([
  'pending',
  'needs_reapproval',
  'accepted',
  'cancelled',
  'expired',
]);
export const invitationApprovalSchema = z.strictObject({
  approverId: peopleSubjectSchema,
  approvedAt: peopleInstantSchema,
  accessRevision: accessRevisionSchema,
  organizationRevision: accessRevisionSchema,
  permissionDigest: peopleDigestSchema,
  scopeDigest: peopleDigestSchema,
});
const deliveryBase = { generation: peopleVersionSchema, attempts: z.number().int().min(0).max(5) };
export const invitationDeliverySchema = z.discriminatedUnion('state', [
  z.strictObject({
    ...deliveryBase,
    state: z.literal('queued'),
    attempts: z.number().int().min(0).max(4),
    nextAttemptAt: peopleInstantSchema,
  }),
  z.strictObject({
    ...deliveryBase,
    state: z.literal('sending'),
    attempts: z.number().int().min(1).max(5),
    leaseExpiresAt: peopleInstantSchema,
  }),
  z.strictObject({
    ...deliveryBase,
    state: z.literal('smtp_accepted'),
    attempts: z.number().int().min(1).max(5),
    at: peopleInstantSchema,
  }),
  z.strictObject({
    ...deliveryBase,
    state: z.literal('failed'),
    at: peopleInstantSchema,
    reason: z.enum([
      'smtp_rejected',
      'transport_unavailable',
      'attempts_exhausted',
      'stale_generation',
      'cancelled',
      'expired',
    ]),
  }),
  z.strictObject({
    ...deliveryBase,
    state: z.literal('unknown'),
    attempts: z.number().int().min(1).max(5),
    at: peopleInstantSchema,
    reason: z.enum(['deadline', 'lease_lost']),
  }),
]);
const invitationFields = {
  id: canonicalPeopleIdSchema,
  version: peopleVersionSchema,
  generation: peopleVersionSchema,
  email: canonicalInvitationEmailSchema,
  createdAt: peopleInstantSchema,
  expiresAt: peopleInstantSchema,
  assignments: resolvedRoleAssignmentsSchema.refine((assignments) => assignments.length > 0),
  delivery: invitationDeliverySchema.nullable(),
};
export const invitationSchema = z
  .discriminatedUnion('state', [
    z.strictObject({
      ...invitationFields,
      state: z.literal('pending'),
      approval: invitationApprovalSchema,
    }),
    z.strictObject({
      ...invitationFields,
      state: z.literal('needs_reapproval'),
      approval: z.null(),
      invalidatedAt: peopleInstantSchema,
    }),
    z.strictObject({
      ...invitationFields,
      state: z.literal('accepted'),
      approval: invitationApprovalSchema,
      acceptedUserId: peopleSubjectSchema,
      acceptedAt: peopleInstantSchema,
    }),
    z.strictObject({
      ...invitationFields,
      state: z.literal('cancelled'),
      approval: z.null(),
      cancelledAt: peopleInstantSchema,
    }),
    z.strictObject({ ...invitationFields, state: z.literal('expired'), approval: z.null() }),
  ])
  .superRefine((invitation, context) => {
    if (
      Date.parse(invitation.expiresAt) <= Date.parse(invitation.createdAt) ||
      (invitation.delivery && invitation.delivery.generation !== invitation.generation)
    )
      context.addIssue({
        code: 'custom',
        message: 'Invalid invitation lifetime/delivery generation',
      });
    if (
      invitation.approval &&
      (Date.parse(invitation.approval.approvedAt) < Date.parse(invitation.createdAt) ||
        Date.parse(invitation.approval.approvedAt) >= Date.parse(invitation.expiresAt))
    )
      context.addIssue({ code: 'custom', message: 'Approval must be inside invitation lifetime' });
    if (
      invitation.state === 'accepted' &&
      (Date.parse(invitation.acceptedAt) >= Date.parse(invitation.expiresAt) ||
        Date.parse(invitation.acceptedAt) < Date.parse(invitation.approval.approvedAt))
    )
      context.addIssue({ code: 'custom', message: 'Acceptance must precede expiry' });
  });
export const invitationListResponseSchema = peoplePageSchema(invitationSchema);

const versions = { expectedAccessRevision: accessRevisionSchema };
const hierarchyVersion = { ...versions, expectedOrganizationRevision: accessRevisionSchema };
const entityVersion = { id: peopleIdSchema, expectedVersion: peopleVersionSchema };
export const roleCreateCommandSchema = z.discriminatedUnion('source', [
  z.strictObject({
    operation: z.literal('role.create'),
    ...versions,
    source: z.literal('new'),
    name: roleNameSchema,
    description: roleDescriptionSchema.default(null),
    permissions: rolePermissionsSchema,
  }),
  z.strictObject({
    operation: z.literal('role.create'),
    ...versions,
    source: z.literal('copy'),
    name: roleNameSchema,
    description: roleDescriptionSchema.default(null),
    copyFromRoleId: peopleIdSchema,
    expectedRoleVersion: peopleVersionSchema,
  }),
]);
export const rolePatchCommandSchema = z.discriminatedUnion('change', [
  z
    .strictObject({
      operation: z.literal('role.patch'),
      ...versions,
      ...entityVersion,
      change: z.literal('details'),
      name: roleNameSchema.optional(),
      description: roleDescriptionSchema.optional(),
    })
    .refine(
      (value) => value.name !== undefined || value.description !== undefined,
      'Supply details to change',
    ),
  z.strictObject({
    operation: z.literal('role.patch'),
    ...hierarchyVersion,
    ...entityVersion,
    change: z.literal('permissions'),
    permissions: rolePermissionsSchema,
  }),
]);
export const roleDeleteCommandSchema = z.strictObject({
  operation: z.literal('role.delete'),
  ...versions,
  ...entityVersion,
});
export const memberAssignmentsCommandSchema = z.strictObject({
  operation: z.literal('member.assignments'),
  ...hierarchyVersion,
  ...entityVersion,
  assignments: roleAssignmentRequestsSchema,
  // Retirement is explicit and versioned; null means retain the independent legacy source.
  retireLegacyVersion: peopleVersionSchema.nullable(),
});
export const memberSuspendCommandSchema = z.strictObject({
  operation: z.literal('member.suspend'),
  ...hierarchyVersion,
  ...entityVersion,
});
export const memberReactivateCommandSchema = z.strictObject({
  operation: z.literal('member.reactivate'),
  ...hierarchyVersion,
  ...entityVersion,
});
export const invitationIssueCommandSchema = z.strictObject({
  operation: z.literal('invitation.issue'),
  ...hierarchyVersion,
  email: invitationEmailSchema,
  assignments: roleAssignmentRequestsSchema.refine((assignments) => assignments.length > 0),
});
const invitationVersion = { ...entityVersion, expectedGeneration: peopleVersionSchema };
export const invitationResendCommandSchema = z.strictObject({
  operation: z.literal('invitation.resend'),
  ...hierarchyVersion,
  ...invitationVersion,
});
export const invitationCancelCommandSchema = z.strictObject({
  operation: z.literal('invitation.cancel'),
  ...versions,
  ...invitationVersion,
});
export const invitationReapproveCommandSchema = z.strictObject({
  operation: z.literal('invitation.reapprove'),
  ...hierarchyVersion,
  ...invitationVersion,
  email: invitationEmailSchema,
  assignments: roleAssignmentRequestsSchema.refine((assignments) => assignments.length > 0),
});
export const peopleCommandSchema = z.union([
  roleCreateCommandSchema,
  rolePatchCommandSchema,
  roleDeleteCommandSchema,
  memberAssignmentsCommandSchema,
  memberSuspendCommandSchema,
  memberReactivateCommandSchema,
  invitationIssueCommandSchema,
  invitationResendCommandSchema,
  invitationCancelCommandSchema,
  invitationReapproveCommandSchema,
]);
export function peopleMutationSchema<T extends z.ZodType<{ operation: string }>>(command: T) {
  return z.strictObject({ command, confirmation: impactTokenSchema.nullable() }).refine((value) => {
    // Zod's generic optional-key inference cannot expose these known required keys.
    const parsed = value as { command: { operation: string }; confirmation: string | null };
    return (
      parsed.confirmation !== null ||
      ![
        'member.assignments',
        'member.suspend',
        'member.reactivate',
        'invitation.issue',
        'invitation.resend',
        'invitation.reapprove',
      ].includes(parsed.command.operation)
    );
  }, 'Confirmed impact required');
}
export const peopleMutationRequestSchema = peopleMutationSchema(peopleCommandSchema);
export const impactReviewRequestSchema = z.strictObject({ command: peopleCommandSchema });
const impactFields = {
  actorId: peopleSubjectSchema,
  commandDigest: peopleDigestSchema,
  accessRevision: accessRevisionSchema,
  organizationRevision: accessRevisionSchema.nullable(),
  confirmation: impactTokenSchema,
  expiresAt: peopleInstantSchema,
};
export const impactReviewSchema = z.discriminatedUnion('visibility', [
  z.strictObject({
    ...impactFields,
    visibility: z.literal('definitions'),
    roles: z.array(roleDefinitionSchema).max(100),
  }),
  z
    .strictObject({
      ...impactFields,
      visibility: z.literal('people'),
      affectedMemberIds: z.array(canonicalPeopleIdSchema).max(100).refine(uniqueValues),
      affectedInvitationIds: z.array(canonicalPeopleIdSchema).max(100).refine(uniqueValues),
      memberCount: accessRevisionSchema,
      invitationCount: accessRevisionSchema,
      assignments: resolvedRoleAssignmentsSchema,
    })
    .refine(
      (value) =>
        value.memberCount >= value.affectedMemberIds.length &&
        value.invitationCount >= value.affectedInvitationIds.length,
    ),
]);

const commandResultFields = {
  commandId: canonicalPeopleIdSchema,
  changed: z.boolean(),
  replayed: z.boolean(),
  accessRevision: accessRevisionSchema,
};
export const peopleCommandResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...commandResultFields, kind: z.literal('member'), current: memberSchema }),
  z.strictObject({
    ...commandResultFields,
    kind: z.literal('role'),
    current: roleDefinitionSchema,
  }),
  z.strictObject({
    ...commandResultFields,
    kind: z.literal('invitation'),
    current: invitationSchema,
  }),
  z.strictObject({
    ...commandResultFields,
    kind: z.literal('deleted_role'),
    id: canonicalPeopleIdSchema,
  }),
]);

const structureVersions = {
  expectedAccessRevision: accessRevisionSchema,
  expectedOrganizationRevision: accessRevisionSchema,
};
export const scopedUnitCreateSchema = z.strictObject({
  ...structureVersions,
  type: z.enum(['site', 'department']),
  parentId: peopleIdSchema,
  name: unitNameSchema,
});
export const scopedUnitRenameSchema = z.strictObject({
  ...structureVersions,
  name: unitNameSchema,
});
export const scopedUnitDeleteSchema = z.strictObject(structureVersions);
export const scopedMoveCommandSchema = z.strictObject({
  ...structureVersions,
  id: peopleIdSchema,
  parentId: peopleIdSchema,
});
export const scopedMoveRequestSchema = z.strictObject({
  command: scopedMoveCommandSchema,
  confirmation: impactTokenSchema.nullable(),
});
export const scopedMoveImpactSchema = z
  .strictObject({
    ...impactFields,
    organizationRevision: accessRevisionSchema,
    sourceId: canonicalPeopleIdSchema,
    parentId: canonicalPeopleIdSchema,
    accessChanges: z.boolean(),
    affectedMemberCount: accessRevisionSchema,
    affectedInvitationCount: accessRevisionSchema,
  })
  .refine(
    (value) =>
      value.accessChanges ||
      (value.affectedMemberCount === 0 && value.affectedInvitationCount === 0),
  );
export const scopedCommandResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...commandResultFields,
    kind: z.literal('unit'),
    current: scopedUnitDetailSchema,
  }),
  z.strictObject({
    ...commandResultFields,
    kind: z.literal('deleted_unit'),
    id: canonicalPeopleIdSchema,
    revision: accessRevisionSchema,
  }),
]);

export const recipientReviewSchema = z
  .strictObject({
    invitationId: canonicalPeopleIdSchema,
    version: peopleVersionSchema,
    generation: peopleVersionSchema,
    expiresAt: peopleInstantSchema,
    workspaceName: z.string().min(1).max(160),
    addressedEmail: canonicalInvitationEmailSchema,
    assignments: resolvedRoleAssignmentsSchema.refine((assignments) => assignments.length > 0),
    scopeContext: z.array(scopedUnitContextSchema).max(64),
    permissionDigest: peopleDigestSchema,
    scopeDigest: peopleDigestSchema,
  })
  .refine((value) => {
    const anchors = new Set(
      value.assignments.flatMap((assignment) =>
        assignment.scope.kind === 'units' ? assignment.scope.unitIds : [],
      ),
    );
    return (
      uniqueValues(value.scopeContext.map((row) => row.unit.id)) &&
      anchors.size === value.scopeContext.length &&
      value.scopeContext.every((row) => anchors.has(row.unit.id))
    );
  }, 'Only approved anchors and their path context may be projected');
const restrictedFields = {
  // Keeps cancel/switch actionable after an OIDC navigation or unavailable review.
  action: z
    .strictObject({
      invitationId: canonicalPeopleIdSchema,
      expectedVersion: peopleVersionSchema,
      expectedGeneration: peopleVersionSchema,
    })
    .optional(),
  kind: z.literal('invitation'),
  csrfToken: peopleSecretSchema,
  expiresAt: peopleInstantSchema,
};
export const restrictedInvitationContextSchema = z
  .discriminatedUnion('phase', [
    z.strictObject({
      ...restrictedFields,
      phase: z.literal('identity_required'),
      review: recipientReviewSchema,
    }),
    z
      .strictObject({
        ...restrictedFields,
        phase: z.literal('verified'),
        review: recipientReviewSchema,
        user: z.strictObject({ id: peopleSubjectSchema, email: canonicalInvitationEmailSchema }),
      })
      .refine((value) => value.user.email === value.review.addressedEmail),
    z.strictObject({
      ...restrictedFields,
      phase: z.literal('unavailable'),
      state: z.enum([
        'needs_reapproval',
        'expired',
        'cancelled',
        'identity_mismatch',
        'membership_exists',
        'membership_suspended',
      ]),
    }),
    z
      .strictObject({
        ...restrictedFields,
        phase: z.literal('accepted'),
        memberId: canonicalPeopleIdSchema,
        membershipStatus: z.enum(['active', 'suspended']),
        canEnter: z.boolean(),
      })
      .refine((value) => value.membershipStatus !== 'suspended' || !value.canEnter),
  ])
  .refine(
    (value) =>
      !('review' in value) || Date.parse(value.expiresAt) <= Date.parse(value.review.expiresAt),
  );
export const invitationExchangeSchema = z.strictObject({ credential: peopleSecretSchema });
export const recipientActionSchema = z.strictObject({
  invitationId: peopleIdSchema,
  expectedVersion: peopleVersionSchema,
  expectedGeneration: peopleVersionSchema,
});
export const invitationAcceptSchema = recipientActionSchema.extend({
  permissionDigest: peopleDigestSchema,
  scopeDigest: peopleDigestSchema,
});
export const recipientSwitchSchema = recipientActionSchema.extend({
  endCurrentAuthoritySession: z.literal(true),
});
export const recipientNavigationSchema = z.strictObject({
  destination: z.enum([
    '/api/auth/login',
    '/identity/invitation-setup/context',
    '/sign-in',
    '/reset-password',
  ]),
});
export const invitationSetupHandoffSchema = z.strictObject({
  destination: z.literal('/identity/invitation-setup/exchange'),
  receipt: peopleSecretSchema,
});
// Browser-safe projections of the accepted authority setup response. The web
// consumes only Turnstile contracts; the owning authority validates all input.
export const recipientAccountSetupContextSchema = z.discriminatedUnion('phase', [
  z.strictObject({
    phase: z.literal('ready'),
    csrfToken: peopleSecretSchema,
    expiresAt: peopleInstantSchema,
  }),
  z.strictObject({
    phase: z.literal('continue'),
    csrfToken: peopleSecretSchema,
    destination: z.literal('/sign-in'),
  }),
]);
export const recipientAccountSetupResultSchema = z.strictObject({
  state: z.literal('continue'),
  destination: z.literal('/sign-in'),
});
export const recipientFlowResultSchema = z
  .strictObject({
    local: z.literal('complete'),
    authority: z.enum(['complete', 'pending']),
    retryUntil: peopleInstantSchema.optional(),
  })
  .refine((value) => (value.authority === 'pending') === (value.retryUntil !== undefined));
export const invitationAcceptanceResultSchema = z
  .strictObject({
    invitationId: canonicalPeopleIdSchema,
    memberId: canonicalPeopleIdSchema,
    userId: peopleSubjectSchema,
    membershipStatus: z.enum(['active', 'suspended']),
    accessRevision: accessRevisionSchema,
    session: z.enum(['established', 'login_required', 'denied']),
  })
  .refine((value) => value.membershipStatus !== 'suspended' || value.session === 'denied');

export const PEOPLE_ERROR_STATUS = {
  PEOPLE_INVALID: 400,
  STRUCTURE_INVALID: 400,
  INVITATION_INVALID_REQUEST: 400,
  INVALID_AUTH_REQUEST: 400,
  LOGIN_TRANSACTION_INVALID: 400,
  IDENTITY_REQUIRED: 401,
  LOGIN_REQUIRED: 401,
  INVITATION_IDENTITY_REQUIRED: 401,
  PRODUCT_ACCESS_DENIED: 403,
  PERMISSION_DENIED: 403,
  CSRF_REJECTED: 403,
  ACCESS_COVERAGE_DENIED: 403,
  INVITATION_IDENTITY_MISMATCH: 403,
  PEOPLE_NOT_FOUND: 404,
  STRUCTURE_NOT_FOUND: 404,
  SETUP_REQUIRED: 409,
  ACCESS_CONTEXT_CHANGED: 409,
  PEOPLE_CONFLICT: 409,
  STRUCTURE_CONFLICT: 409,
  INVITATION_CONFLICT: 409,
  INVITATION_UNAVAILABLE: 410,
  PEOPLE_TOO_LARGE: 413,
  STRUCTURE_TOO_LARGE: 413,
  INVITATION_TOO_LARGE: 413,
  PEOPLE_MEDIA_TYPE_UNSUPPORTED: 415,
  STRUCTURE_MEDIA_TYPE_UNSUPPORTED: 415,
  INVITATION_MEDIA_TYPE_UNSUPPORTED: 415,
  PEOPLE_RATE_LIMITED: 429,
  INVITATION_RATE_LIMITED: 429,
  PEOPLE_UNAVAILABLE: 503,
  STRUCTURE_UNAVAILABLE: 503,
  INVITATION_UNAVAILABLE_RETRY: 503,
  AUTH_UNAVAILABLE: 503,
  REFRESH_IN_PROGRESS: 503,
} as const;
export const peopleConflictReasonSchema = z.enum([
  'revision',
  'version',
  'duplicate_name',
  'reference_in_use',
  'protected_role',
  'last_administrator',
  'last_configuration_manager',
  'approval_changed',
  'membership_exists',
  'membership_suspended',
  'idempotency_mismatch',
  'impact_stale',
  'state',
  'required_unit',
]);
const conflictCodes = [
  'ACCESS_CONTEXT_CHANGED',
  'PEOPLE_CONFLICT',
  'STRUCTURE_CONFLICT',
  'INVITATION_CONFLICT',
] as const;
const rateCodes = ['PEOPLE_RATE_LIMITED', 'INVITATION_RATE_LIMITED'] as const;
const invalidCodes = ['PEOPLE_INVALID', 'STRUCTURE_INVALID', 'INVITATION_INVALID_REQUEST'] as const;
const unavailableCodes = [
  'PEOPLE_UNAVAILABLE',
  'STRUCTURE_UNAVAILABLE',
  'INVITATION_UNAVAILABLE_RETRY',
] as const;
const simpleCodes = [
  'INVALID_AUTH_REQUEST',
  'LOGIN_TRANSACTION_INVALID',
  'IDENTITY_REQUIRED',
  'LOGIN_REQUIRED',
  'INVITATION_IDENTITY_REQUIRED',
  'PRODUCT_ACCESS_DENIED',
  'PERMISSION_DENIED',
  'CSRF_REJECTED',
  'ACCESS_COVERAGE_DENIED',
  'INVITATION_IDENTITY_MISMATCH',
  'PEOPLE_NOT_FOUND',
  'STRUCTURE_NOT_FOUND',
  'SETUP_REQUIRED',
  'INVITATION_UNAVAILABLE',
  'PEOPLE_TOO_LARGE',
  'STRUCTURE_TOO_LARGE',
  'INVITATION_TOO_LARGE',
  'PEOPLE_MEDIA_TYPE_UNSUPPORTED',
  'STRUCTURE_MEDIA_TYPE_UNSUPPORTED',
  'INVITATION_MEDIA_TYPE_UNSUPPORTED',
  'AUTH_UNAVAILABLE',
  'REFRESH_IN_PROGRESS',
] as const;
export const peopleErrorSchema = z.union([
  z.strictObject({ code: z.enum(simpleCodes), requestId: canonicalPeopleIdSchema }),
  z.strictObject({
    code: z.enum(conflictCodes),
    requestId: canonicalPeopleIdSchema,
    reason: peopleConflictReasonSchema,
    accessRevision: accessRevisionSchema.optional(),
    organizationRevision: accessRevisionSchema.optional(),
  }),
  z.strictObject({
    code: z.enum(rateCodes),
    requestId: canonicalPeopleIdSchema,
    retryAfterSeconds: z.number().int().min(1).max(3600),
  }),
  z.strictObject({
    code: z.enum(unavailableCodes),
    requestId: canonicalPeopleIdSchema,
    reason: z.enum(['dependency', 'readiness', 'capacity', 'revision_exhausted']),
  }),
  z.strictObject({
    code: z.enum(invalidCodes),
    requestId: canonicalPeopleIdSchema,
    fieldErrors: z
      .array(
        z.strictObject({
          field: z.enum([
            'body',
            'name',
            'description',
            'permissions',
            'assignments',
            'scope',
            'email',
            'id',
            'parentId',
            'version',
            'cursor',
            'confirmation',
          ]),
          reason: z.enum(['required', 'invalid', 'unsupported', 'limit_reached']),
        }),
      )
      .min(1)
      .max(8),
  }),
]);

export const peopleSchemas = {
  ...accessSchemas,
  PeoplePath: peoplePathSchema,
  PeopleMutationHeaders: peopleMutationHeadersSchema,
  PeopleEmpty: peopleEmptySchema,
  PeopleListQuery: peopleListQuerySchema,
  MemberListQuery: memberListQuerySchema,
  RoleListQuery: roleListQuerySchema,
  InvitationListQuery: invitationListQuerySchema,
  Invitation: invitationSchema,
  InvitationListResponse: invitationListResponseSchema,
  InvitationApproval: invitationApprovalSchema,
  InvitationDelivery: invitationDeliverySchema,
  RoleCreateCommand: roleCreateCommandSchema,
  RolePatchCommand: rolePatchCommandSchema,
  RoleDeleteCommand: roleDeleteCommandSchema,
  MemberAssignmentsCommand: memberAssignmentsCommandSchema,
  MemberSuspendCommand: memberSuspendCommandSchema,
  MemberReactivateCommand: memberReactivateCommandSchema,
  InvitationIssueCommand: invitationIssueCommandSchema,
  InvitationResendCommand: invitationResendCommandSchema,
  InvitationCancelCommand: invitationCancelCommandSchema,
  InvitationReapproveCommand: invitationReapproveCommandSchema,
  PeopleCommand: peopleCommandSchema,
  PeopleMutationRequest: peopleMutationRequestSchema,
  RoleCreateRequest: peopleMutationSchema(roleCreateCommandSchema),
  RolePatchRequest: peopleMutationSchema(rolePatchCommandSchema),
  RoleDeleteRequest: peopleMutationSchema(roleDeleteCommandSchema),
  MemberAssignmentsRequest: peopleMutationSchema(memberAssignmentsCommandSchema),
  MemberSuspendRequest: peopleMutationSchema(memberSuspendCommandSchema),
  MemberReactivateRequest: peopleMutationSchema(memberReactivateCommandSchema),
  InvitationIssueRequest: peopleMutationSchema(invitationIssueCommandSchema),
  InvitationResendRequest: peopleMutationSchema(invitationResendCommandSchema),
  InvitationCancelRequest: peopleMutationSchema(invitationCancelCommandSchema),
  InvitationReapproveRequest: peopleMutationSchema(invitationReapproveCommandSchema),
  ImpactReviewRequest: impactReviewRequestSchema,
  ImpactReview: impactReviewSchema,
  PeopleCommandResult: peopleCommandResultSchema,
  ScopedUnitCreate: scopedUnitCreateSchema,
  ScopedUnitRename: scopedUnitRenameSchema,
  ScopedUnitDelete: scopedUnitDeleteSchema,
  ScopedMoveCommand: scopedMoveCommandSchema,
  ScopedMoveRequest: scopedMoveRequestSchema,
  ScopedMoveImpact: scopedMoveImpactSchema,
  ScopedCommandResult: scopedCommandResultSchema,
  RecipientReview: recipientReviewSchema,
  RestrictedInvitationContext: restrictedInvitationContextSchema,
  InvitationExchange: invitationExchangeSchema,
  RecipientAction: recipientActionSchema,
  InvitationAccept: invitationAcceptSchema,
  RecipientSwitch: recipientSwitchSchema,
  RecipientNavigation: recipientNavigationSchema,
  InvitationSetupHandoff: invitationSetupHandoffSchema,
  RecipientFlowResult: recipientFlowResultSchema,
  InvitationAcceptanceResult: invitationAcceptanceResultSchema,
  PeopleError: peopleErrorSchema,
};
export function peopleJsonSchemas() {
  const registry = z.registry<{ id: string }>();
  for (const [name, schema] of Object.entries(peopleSchemas)) registry.add(schema, { id: name });
  const result = z.toJSONSchema(registry, {
    io: 'input',
    uri: (id) => `#/components/schemas/${id}`,
  }).schemas;
  // OpenAPI owns schema locations; a fragment-valued JSON Schema $id is invalid.
  for (const schema of Object.values(result)) delete schema.$id;
  return result;
}
export type PeopleCommandDto = z.infer<typeof peopleCommandSchema>;
export type PeopleMutationRequestDto = z.infer<typeof peopleMutationRequestSchema>;
export type InvitationDto = z.infer<typeof invitationSchema>;
export type RestrictedInvitationContextDto = z.infer<typeof restrictedInvitationContextSchema>;
export type InvitationAcceptanceResultDto = z.infer<typeof invitationAcceptanceResultSchema>;
export type PeopleErrorDto = z.infer<typeof peopleErrorSchema>;
export type PeopleContractDto<Name extends keyof typeof peopleSchemas> = z.infer<
  (typeof peopleSchemas)[Name]
>;
export type PeopleContractInput<Name extends keyof typeof peopleSchemas> = z.input<
  (typeof peopleSchemas)[Name]
>;
