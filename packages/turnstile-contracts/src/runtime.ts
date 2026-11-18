// Current application contracts. The root export remains the frozen v2 wire API.
import { z } from 'zod';
import {
  DOCUMENTS_PERMISSIONS,
  V3_PERMISSIONS,
  v3AccessContracts,
  v3PeopleContracts,
  v3PermissionSchema,
} from './documents-access.js';
import * as legacy from './index.js';
import { createPeopleImportSchemas } from './people-imports.js';
import { createPeopleInsightSchemas } from './people-insights.js';

export * from './index.js';
export const PEOPLE_PERMISSIONS = V3_PERMISSIONS;
export type PeoplePermission = (typeof V3_PERMISSIONS)[number];
export const COMPANY_ONLY_PERMISSIONS: readonly PeoplePermission[] = [
  ...legacy.COMPANY_ONLY_PERMISSIONS,
  ...DOCUMENTS_PERMISSIONS,
];
export const peoplePermissionSchema = v3PermissionSchema;
export const rolePermissionsSchema = v3AccessContracts.roleDefinitionSchema.shape.permissions;
export const PEOPLE_CATALOG_VERSION = 3;
const contracts = {
  ...v3AccessContracts,
  ...v3PeopleContracts,
  ...createPeopleImportSchemas(v3AccessContracts.resolvedRoleAssignmentsSchema),
  ...createPeopleInsightSchemas(v3PermissionSchema),
  userAccessContextSchema: z.union([
    legacy.userAccessContextSchema,
    v3AccessContracts.userAccessContextSchema,
  ]),
  accessAwareUserSessionSchema: z.union([
    legacy.accessAwareUserSessionSchema,
    v3AccessContracts.accessAwareUserSessionSchema,
  ]),
  permissionCatalogSchema: v3AccessContracts.permissionCatalogSchema,
};
export const {
  accessAwareUserSessionSchema,
  accessSchemas,
  assignmentScopeSchema,
  eligibleRoleSchema,
  eligibleRolesResponseSchema,
  legacyGrantSourceSchema,
  memberIdentityDisplaySchema,
  memberListResponseSchema,
  memberSchema,
  permissionCatalogSchema,
  resolvedRoleAssignmentSchema,
  resolvedRoleAssignmentsSchema,
  roleAssignmentRequestSchema,
  roleAssignmentRequestsSchema,
  roleDefinitionSchema,
  roleListResponseSchema,
  scopedUnitContextSchema,
  scopedUnitDetailSchema,
  scopedUnitSchema,
  scopedUnitsResponseSchema,
  unitAncestorContextSchema,
  userAccessContextSchema,
  validAssignmentSet,
  PEOPLE_ERROR_STATUS,
  impactReviewRequestSchema,
  impactReviewSchema,
  invitationAcceptSchema,
  invitationAcceptanceResultSchema,
  invitationApprovalSchema,
  invitationCancelCommandSchema,
  invitationDeliverySchema,
  invitationExchangeSchema,
  invitationIssueCommandSchema,
  invitationListResponseSchema,
  invitationReapproveCommandSchema,
  invitationResendCommandSchema,
  invitationSchema,
  invitationSetupHandoffSchema,
  invitationStateSchema,
  memberAssignmentsCommandSchema,
  memberReactivateCommandSchema,
  memberSuspendCommandSchema,
  peopleCommandResultSchema,
  peopleCommandSchema,
  peopleConflictReasonSchema,
  peopleErrorSchema,
  peopleJsonSchemas,
  peopleMutationRequestSchema,
  peopleMutationSchema,
  peopleSchemas,
  recipientAccountSetupContextSchema,
  recipientAccountSetupResultSchema,
  recipientActionSchema,
  recipientFlowResultSchema,
  recipientNavigationSchema,
  recipientReviewSchema,
  recipientSwitchSchema,
  restrictedInvitationContextSchema,
  roleCreateCommandSchema,
  roleDeleteCommandSchema,
  rolePatchCommandSchema,
  scopedCommandResultSchema,
  scopedMoveCommandSchema,
  scopedMoveImpactSchema,
  scopedMoveRequestSchema,
  scopedUnitCreateSchema,
  scopedUnitDeleteSchema,
  scopedUnitRenameSchema,
  PEOPLE_IMPORT_LIMITS,
  importActionSchema,
  importCreateSchema,
  importDetailSchema,
  importErrorsSchema,
  importJobSchema,
  importListSchema,
  importReasonSchema,
  importRowSchema,
  importRowStateSchema,
  importRowsQuerySchema,
  importStateSchema,
  peopleImportSchemas,
  accessInspectionQuerySchema,
  accessInspectionSchema,
  auditActions,
  peopleAuditEventSchema,
  peopleAuditQuerySchema,
  peopleAuditResponseSchema,
  peopleInsightSchemas,
} = contracts;
export type AssignmentScopeDto = z.infer<typeof assignmentScopeSchema>;
export type RoleDefinitionDto = z.infer<typeof roleDefinitionSchema>;
export type RoleAssignmentRequestDto = z.infer<typeof roleAssignmentRequestSchema>;
export type ResolvedRoleAssignmentDto = z.infer<typeof resolvedRoleAssignmentSchema>;
export type MemberDto = z.infer<typeof memberSchema>;
// Runtime access can predate HTTP projection; closed wire parsers still enforce v2/v3 separately.
export type UserAccessContextDto = Omit<
  z.infer<typeof v3AccessContracts.userAccessContextSchema>,
  'catalogVersion'
> & { catalogVersion: 2 | 3 };
export type AccessAwareUserSessionDto = Omit<
  z.infer<typeof v3AccessContracts.accessAwareUserSessionSchema>,
  'access'
> & { access: UserAccessContextDto };
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
export type ImportJobDto = z.infer<typeof importJobSchema>;
export type ImportRowDto = z.infer<typeof importRowSchema>;
export type PeopleAuditEventDto = z.infer<typeof peopleAuditEventSchema>;
export type PeopleAuditResponseDto = z.infer<typeof peopleAuditResponseSchema>;

export type UserSessionDto = AccessAwareUserSessionDto;
