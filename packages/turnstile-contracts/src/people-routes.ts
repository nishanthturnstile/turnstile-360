import type { peopleSchemas } from './people.js';

export type PeopleRoutePolicy =
  | 'normal_people'
  | 'normal_roles'
  | 'normal_catalog'
  | 'normal_impact'
  | 'normal_unit_read'
  | 'normal_unit_write'
  | 'normal_unit_move'
  | 'invitation_credential'
  | 'invitation_continuation'
  | 'invitation_verified'
  | 'invitation_parent_logout';
export interface PeopleRouteContract {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  policy: PeopleRoutePolicy;
  response: keyof typeof peopleSchemas;
  request?: keyof typeof peopleSchemas;
  query?: keyof typeof peopleSchemas;
  idempotency?: true;
  sameActor?: true;
  operation?: string;
}
// This is a contract catalog, not Nest metadata or a list of implemented endpoints.
export const PEOPLE_ROUTES = [
  {
    method: 'POST',
    path: '/api/people/imports',
    policy: 'normal_people',
    request: 'ImportCreate',
    response: 'ImportDetail',
  },
  { method: 'GET', path: '/api/people/imports', policy: 'normal_people', response: 'ImportList' },
  {
    method: 'GET',
    path: '/api/people/imports/{id}',
    policy: 'normal_people',
    query: 'ImportRowsQuery',
    response: 'ImportDetail',
  },
  {
    method: 'POST',
    path: '/api/people/imports/{id}/actions',
    policy: 'normal_people',
    request: 'ImportAction',
    response: 'ImportDetail',
  },
  {
    method: 'GET',
    path: '/api/people/imports/{id}/errors',
    policy: 'normal_people',
    response: 'ImportErrors',
  },
  {
    method: 'GET',
    path: '/api/people/audit',
    policy: 'normal_people',
    query: 'PeopleAuditQuery',
    response: 'PeopleAuditResponse',
  },
  {
    method: 'GET',
    path: '/api/people/members/{id}/access',
    policy: 'normal_people',
    query: 'AccessInspectionQuery',
    response: 'AccessInspection',
  },
  {
    method: 'GET',
    path: '/api/people/catalog',
    policy: 'normal_catalog',
    response: 'PermissionCatalog',
  },
  {
    method: 'GET',
    path: '/api/people/members',
    policy: 'normal_people',
    query: 'MemberListQuery',
    response: 'MemberListResponse',
  },
  { method: 'GET', path: '/api/people/members/{id}', policy: 'normal_people', response: 'Member' },
  {
    method: 'GET',
    path: '/api/people/eligible-roles',
    policy: 'normal_people',
    query: 'PeopleListQuery',
    response: 'EligibleRolesResponse',
  },
  {
    method: 'PUT',
    path: '/api/people/members/{id}/assignments',
    policy: 'normal_people',
    operation: 'member.assignments',
    request: 'MemberAssignmentsRequest',
    response: 'PeopleCommandResult',
    idempotency: true,
  },
  {
    method: 'POST',
    path: '/api/people/members/{id}/suspend',
    policy: 'normal_people',
    operation: 'member.suspend',
    request: 'MemberSuspendRequest',
    response: 'PeopleCommandResult',
    idempotency: true,
  },
  {
    method: 'POST',
    path: '/api/people/members/{id}/reactivate',
    policy: 'normal_people',
    operation: 'member.reactivate',
    request: 'MemberReactivateRequest',
    response: 'PeopleCommandResult',
    idempotency: true,
  },
  {
    method: 'GET',
    path: '/api/people/roles',
    policy: 'normal_roles',
    query: 'RoleListQuery',
    response: 'RoleListResponse',
  },
  {
    method: 'GET',
    path: '/api/people/roles/{id}',
    policy: 'normal_roles',
    response: 'RoleDefinition',
  },
  {
    method: 'POST',
    path: '/api/people/roles',
    policy: 'normal_roles',
    operation: 'role.create',
    request: 'RoleCreateRequest',
    response: 'PeopleCommandResult',
    idempotency: true,
  },
  {
    method: 'PATCH',
    path: '/api/people/roles/{id}',
    policy: 'normal_roles',
    operation: 'role.patch',
    request: 'RolePatchRequest',
    response: 'PeopleCommandResult',
    idempotency: true,
  },
  {
    method: 'DELETE',
    path: '/api/people/roles/{id}',
    policy: 'normal_roles',
    operation: 'role.delete',
    request: 'RoleDeleteRequest',
    response: 'PeopleCommandResult',
    idempotency: true,
  },
  {
    method: 'GET',
    path: '/api/people/invitations',
    policy: 'normal_people',
    query: 'InvitationListQuery',
    response: 'InvitationListResponse',
  },
  {
    method: 'GET',
    path: '/api/people/invitations/{id}',
    policy: 'normal_people',
    response: 'Invitation',
  },
  {
    method: 'POST',
    path: '/api/people/invitations',
    policy: 'normal_people',
    operation: 'invitation.issue',
    request: 'InvitationIssueRequest',
    response: 'PeopleCommandResult',
    idempotency: true,
  },
  {
    method: 'POST',
    path: '/api/people/invitations/{id}/resend',
    policy: 'normal_people',
    operation: 'invitation.resend',
    request: 'InvitationResendRequest',
    response: 'PeopleCommandResult',
    idempotency: true,
  },
  {
    method: 'POST',
    path: '/api/people/invitations/{id}/cancel',
    policy: 'normal_people',
    operation: 'invitation.cancel',
    request: 'InvitationCancelRequest',
    response: 'PeopleCommandResult',
    idempotency: true,
  },
  {
    method: 'POST',
    path: '/api/people/invitations/{id}/reapprove',
    policy: 'normal_people',
    operation: 'invitation.reapprove',
    request: 'InvitationReapproveRequest',
    response: 'PeopleCommandResult',
    idempotency: true,
  },
  {
    method: 'POST',
    path: '/api/people/impact',
    policy: 'normal_impact',
    request: 'ImpactReviewRequest',
    response: 'ImpactReview',
  },
  {
    method: 'GET',
    path: '/api/people/commands/{id}',
    policy: 'normal_impact',
    response: 'PeopleCommandResult',
    sameActor: true,
  },
  {
    method: 'GET',
    path: '/api/structure/units',
    policy: 'normal_unit_read',
    query: 'PeopleListQuery',
    response: 'ScopedUnitsResponse',
  },
  {
    method: 'GET',
    path: '/api/structure/units/{id}',
    policy: 'normal_unit_read',
    response: 'ScopedUnitDetail',
  },
  {
    method: 'POST',
    path: '/api/structure/units',
    policy: 'normal_unit_write',
    request: 'ScopedUnitCreate',
    response: 'ScopedCommandResult',
    idempotency: true,
  },
  {
    method: 'PATCH',
    path: '/api/structure/units/{id}',
    policy: 'normal_unit_write',
    request: 'ScopedUnitRename',
    response: 'ScopedCommandResult',
    idempotency: true,
  },
  {
    method: 'DELETE',
    path: '/api/structure/units/{id}',
    policy: 'normal_unit_write',
    request: 'ScopedUnitDelete',
    response: 'ScopedCommandResult',
    idempotency: true,
  },
  {
    method: 'POST',
    path: '/api/structure/move-impact',
    policy: 'normal_unit_move',
    request: 'ScopedMoveCommand',
    response: 'ScopedMoveImpact',
  },
  {
    method: 'PATCH',
    path: '/api/structure/units/{id}/parent',
    policy: 'normal_unit_move',
    request: 'ScopedMoveRequest',
    response: 'ScopedCommandResult',
    idempotency: true,
  },
  {
    method: 'GET',
    path: '/api/structure/commands/{id}',
    policy: 'normal_unit_read',
    response: 'ScopedCommandResult',
    sameActor: true,
  },
  {
    method: 'POST',
    path: '/api/invitations/exchange',
    policy: 'invitation_credential',
    request: 'InvitationExchange',
    response: 'RestrictedInvitationContext',
  },
  {
    method: 'GET',
    path: '/api/invitations/context',
    policy: 'invitation_continuation',
    response: 'RestrictedInvitationContext',
  },
  {
    method: 'POST',
    path: '/api/invitations/start',
    policy: 'invitation_continuation',
    request: 'RecipientAction',
    response: 'RecipientNavigation',
  },
  {
    method: 'POST',
    path: '/api/invitations/setup',
    policy: 'invitation_continuation',
    request: 'RecipientAction',
    response: 'InvitationSetupHandoff',
  },
  {
    method: 'POST',
    path: '/api/invitations/accept',
    policy: 'invitation_verified',
    request: 'InvitationAccept',
    response: 'InvitationAcceptanceResult',
  },
  {
    method: 'POST',
    path: '/api/invitations/decline',
    policy: 'invitation_continuation',
    request: 'RecipientAction',
    response: 'RestrictedInvitationContext',
  },
  {
    method: 'POST',
    path: '/api/invitations/cancel',
    policy: 'invitation_continuation',
    request: 'RecipientAction',
    response: 'RecipientFlowResult',
  },
  {
    method: 'POST',
    path: '/api/invitations/switch-account',
    policy: 'invitation_parent_logout',
    request: 'RecipientSwitch',
    response: 'RecipientFlowResult',
  },
  {
    method: 'POST',
    path: '/api/invitations/logout',
    policy: 'invitation_parent_logout',
    request: 'RecipientSwitch',
    response: 'RecipientFlowResult',
  },
] as const satisfies readonly PeopleRouteContract[];
