// Synthetic examples only. These values are never used to authorize a live request.
export const fixtureId = (number) =>
  `10000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;
export const fixtureSecret = 'A'.repeat(43);
export const fixtureDigest = 'a'.repeat(64);
export const fixtureScopeDigest = 'b'.repeat(64);
const at = '2026-11-03T10:00:00Z';
const soon = '2026-11-03T10:10:00Z';
const expiry = '2026-11-10T10:00:00Z';
const impact = `example_impact_${fixtureSecret}`;
export const fixtureSystemRoles = [
  {
    systemKey: 'workspace_administrator',
    name: 'Workspace administrator',
    permissions: [
      'turnstile:access',
      'turnstile:configuration:manage',
      'turnstile:people:manage',
      'turnstile:roles:manage',
      'turnstile:units:read',
      'turnstile:units:manage',
    ],
  },
  {
    systemKey: 'configuration_manager',
    name: 'Configuration manager',
    permissions: [
      'turnstile:access',
      'turnstile:configuration:manage',
      'turnstile:units:read',
      'turnstile:units:manage',
    ],
  },
  {
    systemKey: 'unit_manager',
    name: 'Unit manager',
    permissions: ['turnstile:access', 'turnstile:units:read', 'turnstile:units:manage'],
  },
  { systemKey: 'member', name: 'Member', permissions: ['turnstile:access'] },
].map((role, index) => ({
  id: fixtureId(index + 10),
  version: 1,
  permissionVersion: 1,
  description: null,
  ...role,
}));
export const fixtureRole = {
  ...fixtureSystemRoles[2],
  id: fixtureId(20),
  name: 'Operations lead',
  systemKey: null,
};
export const fixtureAssignments = [
  {
    id: fixtureId(30),
    role: fixtureRole,
    scope: { kind: 'units', unitIds: [fixtureId(2)], includeChildren: true },
  },
  {
    id: fixtureId(31),
    role: fixtureSystemRoles[3],
    scope: { kind: 'units', unitIds: [fixtureId(3)], includeChildren: false },
  },
];
export const fixtureAssignmentRequests = fixtureAssignments.map((assignment) => ({
  roleId: assignment.role.id,
  expectedRoleVersion: assignment.role.version,
  scope: assignment.scope,
}));
const root = { id: fixtureId(1), type: 'organization', name: 'Example Company', actionable: false };
const site = {
  id: fixtureId(2),
  type: 'site',
  parentId: fixtureId(1),
  name: 'North site',
  ancestorIds: [fixtureId(1)],
};
export const fixtureMember = {
  id: fixtureId(40),
  userId: 'example-recipient',
  version: 1,
  status: 'active',
  identity: {
    state: 'fresh',
    name: 'Samira Example',
    email: 'samira@example.test',
    verifiedAt: at,
  },
  assignments: fixtureAssignments,
  legacySource: {
    kind: 'legacy',
    version: 1,
    permissions: ['turnstile:access', 'turnstile:dms:capabilities:read'],
    retired: false,
  },
};
const approval = {
  approverId: 'example-administrator',
  approvedAt: at,
  accessRevision: 3,
  organizationRevision: 5,
  permissionDigest: fixtureDigest,
  scopeDigest: fixtureScopeDigest,
};
export const fixtureInvitation = {
  id: fixtureId(50),
  version: 1,
  generation: 1,
  email: 'samira@example.test',
  createdAt: at,
  expiresAt: expiry,
  assignments: fixtureAssignments,
  state: 'pending',
  approval,
  delivery: { state: 'queued', generation: 1, attempts: 0, nextAttemptAt: at },
};
export const fixtureReview = {
  invitationId: fixtureInvitation.id,
  version: 1,
  generation: 1,
  expiresAt: expiry,
  workspaceName: 'Example Company',
  assignments: fixtureAssignments,
  addressedEmail: 'samira@example.test',
  scopeContext: [
    { unit: site, ancestors: [root] },
    {
      unit: {
        id: fixtureId(3),
        type: 'department',
        parentId: fixtureId(1),
        name: 'Workshop',
        ancestorIds: [fixtureId(1)],
      },
      ancestors: [root],
    },
  ],
  permissionDigest: fixtureDigest,
  scopeDigest: fixtureScopeDigest,
};
const recipientAction = {
  invitationId: fixtureInvitation.id,
  expectedVersion: 1,
  expectedGeneration: 1,
};
const restricted = { kind: 'invitation', csrfToken: fixtureSecret, expiresAt: soon };
const grants = fixtureAssignments.map((assignment) => ({
  sourceId: assignment.id,
  permissions: assignment.role.permissions,
  scope: assignment.scope,
}));
const page = (items) => ({ items, nextCursor: null, total: items.length, accessRevision: 3 });
const entity = {
  id: fixtureMember.id,
  expectedVersion: 1,
  expectedAccessRevision: 3,
  expectedOrganizationRevision: 5,
};
const inviteEntity = { ...entity, id: fixtureInvitation.id, expectedGeneration: 1 };
const roleCreate = {
  operation: 'role.create',
  source: 'new',
  expectedAccessRevision: 3,
  name: 'Shift lead',
  description: '',
  permissions: fixtureRole.permissions,
};
const rolePatch = {
  operation: 'role.patch',
  change: 'details',
  id: fixtureRole.id,
  expectedVersion: 1,
  expectedAccessRevision: 3,
  name: 'Operations coordinator',
};
const roleDelete = {
  operation: 'role.delete',
  id: fixtureRole.id,
  expectedVersion: 1,
  expectedAccessRevision: 3,
};
const memberAssignments = {
  ...entity,
  operation: 'member.assignments',
  assignments: fixtureAssignmentRequests,
  retireLegacyVersion: null,
};
const issue = {
  operation: 'invitation.issue',
  expectedAccessRevision: 3,
  expectedOrganizationRevision: 5,
  email: 'Samira@Example.test',
  assignments: fixtureAssignmentRequests,
};
const resend = { ...inviteEntity, operation: 'invitation.resend' };
const cancel = {
  operation: 'invitation.cancel',
  id: fixtureInvitation.id,
  expectedVersion: 1,
  expectedAccessRevision: 3,
  expectedGeneration: 1,
};
const reapprove = {
  ...inviteEntity,
  operation: 'invitation.reapprove',
  email: 'samira@example.test',
  assignments: fixtureAssignmentRequests,
};
const mutation = (command) => ({ command, confirmation: impact });
export const peopleExamples = {
  PermissionCatalog: {
    catalogVersion: 1,
    permissions: [
      { id: 'turnstile:access', applicability: 'scope_neutral', implies: [] },
      { id: 'turnstile:dms:capabilities:read', applicability: 'company_only', implies: [] },
      {
        id: 'turnstile:configuration:manage',
        applicability: 'company_only',
        implies: ['turnstile:units:read', 'turnstile:units:manage'],
      },
      { id: 'turnstile:people:manage', applicability: 'company_only', implies: [] },
      { id: 'turnstile:roles:manage', applicability: 'company_only', implies: [] },
      { id: 'turnstile:units:read', applicability: 'scope_aware', implies: [] },
      {
        id: 'turnstile:units:manage',
        applicability: 'scope_aware',
        implies: ['turnstile:units:read'],
      },
    ],
    starters: fixtureSystemRoles,
  },
  RoleDefinition: fixtureRole,
  AssignmentScope: fixtureAssignments[0].scope,
  RoleAssignmentRequest: fixtureAssignmentRequests[0],
  RoleAssignmentRequests: fixtureAssignmentRequests,
  ResolvedRoleAssignment: fixtureAssignments[0],
  ResolvedRoleAssignments: fixtureAssignments,
  LegacyGrantSource: fixtureMember.legacySource,
  Member: fixtureMember,
  MemberListResponse: page([fixtureMember]),
  RoleListResponse: page([fixtureRole]),
  EligibleRolesResponse: page([{ role: fixtureRole, allowedScopes: ['company', 'units'] }]),
  ScopedUnit: site,
  UnitAncestorContext: root,
  ScopedUnitsResponse: {
    revision: 5,
    accessRevision: 3,
    units: [site],
    ancestors: [root],
    nextCursor: null,
    total: 1,
  },
  ScopedUnitContext: { unit: site, ancestors: [root] },
  ScopedUnitDetail: { revision: 5, accessRevision: 3, unit: site, ancestors: [root] },
  UserAccessContext: { catalogVersion: 1, accessRevision: 3, fingerprint: fixtureDigest, grants },
  AccessAwareUserSession: {
    user: { id: 'example-recipient', name: 'Samira Example', email: 'samira@example.test' },
    permissions: ['turnstile:access', 'turnstile:units:read', 'turnstile:units:manage'],
    session: { expiresAt: '2026-11-03T18:00:00Z', idleExpiresAt: '2026-11-03T10:30:00Z' },
    csrfToken: fixtureSecret,
    access: { catalogVersion: 1, accessRevision: 3, fingerprint: fixtureDigest, grants },
  },
  PeoplePath: { id: fixtureMember.id },
  PeopleMutationHeaders: { 'idempotency-key': fixtureId(99) },
  PeopleEmpty: {},
  PeopleListQuery: { limit: 25 },
  MemberListQuery: { limit: 25, status: 'active' },
  RoleListQuery: { limit: 25, kind: 'custom' },
  InvitationListQuery: { limit: 25, state: 'pending' },
  Invitation: fixtureInvitation,
  InvitationListResponse: page([fixtureInvitation]),
  InvitationApproval: approval,
  InvitationDelivery: fixtureInvitation.delivery,
  RoleCreateCommand: roleCreate,
  RolePatchCommand: rolePatch,
  RoleDeleteCommand: roleDelete,
  MemberAssignmentsCommand: memberAssignments,
  MemberSuspendCommand: { ...entity, operation: 'member.suspend' },
  MemberReactivateCommand: { ...entity, operation: 'member.reactivate' },
  InvitationIssueCommand: issue,
  InvitationResendCommand: resend,
  InvitationCancelCommand: cancel,
  InvitationReapproveCommand: reapprove,
  PeopleCommand: memberAssignments,
  PeopleMutationRequest: mutation(memberAssignments),
  RoleCreateRequest: mutation(roleCreate),
  RolePatchRequest: mutation(rolePatch),
  RoleDeleteRequest: mutation(roleDelete),
  MemberAssignmentsRequest: mutation(memberAssignments),
  MemberSuspendRequest: mutation({ ...entity, operation: 'member.suspend' }),
  MemberReactivateRequest: mutation({ ...entity, operation: 'member.reactivate' }),
  InvitationIssueRequest: mutation(issue),
  InvitationResendRequest: mutation(resend),
  InvitationCancelRequest: mutation(cancel),
  InvitationReapproveRequest: mutation(reapprove),
  ImpactReviewRequest: { command: memberAssignments },
  ImpactReview: {
    actorId: 'example-administrator',
    commandDigest: fixtureDigest,
    accessRevision: 3,
    organizationRevision: 5,
    confirmation: impact,
    expiresAt: soon,
    visibility: 'people',
    affectedMemberIds: [fixtureMember.id],
    affectedInvitationIds: [],
    memberCount: 1,
    invitationCount: 0,
    assignments: fixtureAssignments,
  },
  PeopleCommandResult: {
    commandId: fixtureId(99),
    changed: true,
    replayed: false,
    accessRevision: 4,
    kind: 'member',
    current: fixtureMember,
  },
  ScopedUnitCreate: {
    expectedAccessRevision: 3,
    expectedOrganizationRevision: 5,
    type: 'department',
    parentId: fixtureId(2),
    name: 'Engineering',
  },
  ScopedUnitRename: {
    expectedAccessRevision: 3,
    expectedOrganizationRevision: 5,
    name: 'Engineering',
  },
  ScopedUnitDelete: { expectedAccessRevision: 3, expectedOrganizationRevision: 5 },
  ScopedMoveCommand: {
    expectedAccessRevision: 3,
    expectedOrganizationRevision: 5,
    id: fixtureId(3),
    parentId: fixtureId(2),
  },
  ScopedMoveRequest: {
    command: {
      expectedAccessRevision: 3,
      expectedOrganizationRevision: 5,
      id: fixtureId(3),
      parentId: fixtureId(2),
    },
    confirmation: impact,
  },
  ScopedMoveImpact: {
    actorId: 'example-administrator',
    commandDigest: fixtureDigest,
    accessRevision: 3,
    organizationRevision: 5,
    confirmation: impact,
    expiresAt: soon,
    sourceId: fixtureId(3),
    parentId: fixtureId(2),
    accessChanges: true,
    affectedMemberCount: 1,
    affectedInvitationCount: 1,
  },
  ScopedCommandResult: {
    commandId: fixtureId(99),
    changed: false,
    replayed: true,
    accessRevision: 3,
    kind: 'unit',
    current: { revision: 5, accessRevision: 3, unit: site, ancestors: [root] },
  },
  RecipientReview: fixtureReview,
  RestrictedInvitationContext: { ...restricted, phase: 'identity_required', review: fixtureReview },
  InvitationExchange: { credential: fixtureSecret },
  RecipientAction: recipientAction,
  InvitationAccept: {
    ...recipientAction,
    permissionDigest: fixtureDigest,
    scopeDigest: fixtureScopeDigest,
  },
  RecipientSwitch: { ...recipientAction, endCurrentAuthoritySession: true },
  RecipientNavigation: { destination: '/api/auth/login' },
  InvitationSetupHandoff: {
    destination: '/identity/invitation-setup/exchange',
    receipt: fixtureSecret,
  },
  RecipientFlowResult: { local: 'complete', authority: 'complete' },
  InvitationAcceptanceResult: {
    invitationId: fixtureInvitation.id,
    memberId: fixtureMember.id,
    userId: fixtureMember.userId,
    membershipStatus: 'active',
    accessRevision: 4,
    session: 'login_required',
  },
  PeopleError: {
    code: 'STRUCTURE_CONFLICT',
    requestId: fixtureId(99),
    reason: 'revision',
    organizationRevision: 5,
  },
};
export const peopleNamedExamples = {
  ResolvedRoleAssignments: {
    mixedUnits: {
      summary:
        'Manage Site A; shell-only Member at a separate Department. Actions stay paired with scope.',
      value: fixtureAssignments,
    },
    company: {
      summary: 'Protected administrator at company scope; capability-read remains separate.',
      value: [{ id: fixtureId(33), role: fixtureSystemRoles[0], scope: { kind: 'company' } }],
    },
  },
  Invitation: {
    current: { summary: 'Current approval and queued mail', value: fixtureInvitation },
    staleApproval: {
      summary: 'Durably invalid approval after role/approver/scope change',
      value: {
        ...fixtureInvitation,
        state: 'needs_reapproval',
        version: 2,
        generation: 2,
        approval: null,
        invalidatedAt: soon,
        delivery: null,
      },
    },
    expired: {
      summary: 'Expired without membership activation',
      value: { ...fixtureInvitation, state: 'expired', approval: null, delivery: null },
    },
    unknownDelivery: {
      summary: 'SMTP may have accepted; explicit resend is required',
      value: {
        ...fixtureInvitation,
        delivery: { generation: 1, attempts: 1, state: 'unknown', at, reason: 'deadline' },
      },
    },
  },
  RestrictedInvitationContext: {
    preIdentity: {
      summary: 'Only current invitation continuation, no normal session',
      value: peopleExamples.RestrictedInvitationContext,
    },
    verified: {
      summary: 'Verified identity is still restricted before explicit acceptance',
      value: {
        ...restricted,
        phase: 'verified',
        review: fixtureReview,
        user: { id: 'example-recipient', email: 'samira@example.test' },
      },
    },
    expired: {
      summary: 'Current continuation can show safe expired state',
      value: { ...restricted, phase: 'unavailable', state: 'expired' },
    },
  },
  PeopleError: {
    scopedConflict: {
      summary: 'Safe conflict without a company snapshot',
      value: peopleExamples.PeopleError,
    },
    wrongIdentity: {
      summary: 'Wrong restricted identity; no account directory',
      value: { code: 'INVITATION_IDENTITY_MISMATCH', requestId: fixtureId(99) },
    },
    oldCredential: {
      summary: 'Uniform invalid/expired/cancelled bearer result',
      value: { code: 'INVITATION_UNAVAILABLE', requestId: fixtureId(99) },
    },
  },
};
const binding = { tenantId: fixtureId(70), applicationId: fixtureId(71) };
export const identityExamples = {
  IdentityPreparationRequest: {
    ...binding,
    purpose: 'application_invitation',
    operationId: fixtureId(99),
    invitationId: fixtureInvitation.id,
    generation: 1,
    email: 'Samira@Example.test',
    expiresAt: '2026-11-03T10:30:00Z',
  },
  IdentityPreparation: {
    ...binding,
    id: fixtureId(72),
    operationId: fixtureId(99),
    invitationId: fixtureInvitation.id,
    generation: 1,
    state: 'authorized',
    expiresAt: '2026-11-03T10:30:00Z',
    setupReceipt: fixtureSecret,
  },
  IdentityPreparationPath: { id: fixtureId(72) },
  LinkedSubjectAssertion: {
    userId: fixtureMember.userId,
    memberId: fixtureMember.id,
    memberVersion: 1,
  },
  IdentityProjectionRequest: {
    ...binding,
    purpose: 'member_display',
    subjects: [{ userId: fixtureMember.userId, memberId: fixtureMember.id, memberVersion: 1 }],
  },
  IdentitySubjectProjection: {
    userId: fixtureMember.userId,
    state: 'present',
    name: 'Samira Example',
    email: 'samira@example.test',
    emailVerified: true,
    checkedAt: at,
  },
  IdentitySetupExchange: { receipt: fixtureSecret },
  IdentitySetupContext: {
    phase: 'ready',
    csrfToken: fixtureSecret,
    expiresAt: '2026-11-03T10:30:00Z',
  },
  IdentitySetupComplete: { name: 'Samira Example', password: 'synthetic-example-password' },
  IdentitySetupResult: { state: 'continue', destination: '/sign-in' },
  IdentityServiceEmpty: {},
  IdentityServiceError: { code: 'IDENTITY_SERVICE_DENIED', requestId: fixtureId(99) },
};
identityExamples.IdentityProjectionResponse = {
  subjects: [identityExamples.IdentitySubjectProjection],
};
