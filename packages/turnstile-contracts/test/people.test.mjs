import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  fixtureAssignmentRequests,
  fixtureAssignments,
  fixtureDigest,
  fixtureId,
  fixtureInvitation,
  fixtureRole,
  fixtureSystemRoles,
  peopleExamples,
  peopleNamedExamples,
} from '../../../scripts/fixtures/user-management.mjs';
import {
  accessAssignmentSchema,
  accessAwareUserSessionSchema,
  assignmentScopeSchema,
  invitationDeliverySchema,
  invitationSchema,
  PEOPLE_ERROR_STATUS,
  PEOPLE_ROUTES,
  peopleErrorSchema,
  peopleListQuerySchema,
  peopleSchemas,
  resolvedRoleAssignmentSchema,
  resolvedRoleAssignmentsSchema,
  roleAssignmentRequestsSchema,
  roleDefinitionSchema,
  roleNameSchema,
  rolePermissionsSchema,
  scopedUnitsResponseSchema,
  TURNSTILE_PERMISSIONS,
} from '../dist/index.js';

test('feature contracts never extend the installed flat permission writer', () => {
  assert.deepEqual(TURNSTILE_PERMISSIONS, [
    'turnstile:access',
    'turnstile:dms:capabilities:read',
    'turnstile:configuration:manage',
  ]);
  assert.equal(
    accessAssignmentSchema.safeParse({
      operatorId: 'operator',
      userId: 'user',
      enabled: true,
      permissions: ['turnstile:access', 'turnstile:people:manage'],
    }).success,
    false,
  );
});
test('every documented example validates against its owning executable schema', () => {
  assert.deepEqual(Object.keys(peopleExamples).sort(), Object.keys(peopleSchemas).sort());
  for (const [name, value] of Object.entries(peopleExamples)) peopleSchemas[name].parse(value);
  for (const [name, examples] of Object.entries(peopleNamedExamples))
    for (const { value } of Object.values(examples)) peopleSchemas[name].parse(value);
});
test('company-only actions reject unit grants; mixed assignments preserve their action/scope pairs', () => {
  for (const action of [
    'turnstile:people:manage',
    'turnstile:roles:manage',
    'turnstile:configuration:manage',
    'turnstile:dms:capabilities:read',
  ]) {
    assert.equal(
      resolvedRoleAssignmentSchema.safeParse({
        ...fixtureAssignments[0],
        role: { ...fixtureRole, permissions: ['turnstile:access', action] },
      }).success,
      false,
    );
  }
  const parsed = resolvedRoleAssignmentsSchema.parse(fixtureAssignments);
  assert.deepEqual(parsed[0].role.permissions, fixtureRole.permissions);
  assert.deepEqual(parsed[1].role.permissions, ['turnstile:access']);
  assert.notDeepEqual(parsed[0].scope, parsed[1].scope);
  assert.equal(
    assignmentScopeSchema.safeParse({ kind: 'units', unitIds: [fixtureId(2)] }).success,
    false,
  );
  assert.equal(
    assignmentScopeSchema.safeParse({ kind: 'company', includeChildren: true }).success,
    false,
  );
});
test('canonical UUIDs, duplicate assignments and whole-payload anchor caps cannot be bypassed', () => {
  assert.equal(
    assignmentScopeSchema.safeParse({
      kind: 'units',
      unitIds: [fixtureId(26), fixtureId(26).toUpperCase()],
      includeChildren: true,
    }).success,
    false,
  );
  assert.equal(
    roleAssignmentRequestsSchema.safeParse([
      fixtureAssignmentRequests[0],
      fixtureAssignmentRequests[0],
    ]).success,
    false,
  );
  const requests = Array.from({ length: 5 }, (_, i) => ({
    roleId: fixtureId(i + 100),
    expectedRoleVersion: 1,
    scope: {
      kind: 'units',
      includeChildren: true,
      unitIds: Array.from({ length: 16 }, (_, j) => fixtureId(i * 16 + j + 1000)),
    },
  }));
  assert.equal(roleAssignmentRequestsSchema.safeParse(requests.slice(0, 4)).success, true);
  assert.equal(roleAssignmentRequestsSchema.safeParse(requests).success, false);
  assert.equal(
    roleAssignmentRequestsSchema.safeParse([{ ...fixtureAssignmentRequests[0], unknown: true }])
      .success,
    false,
  );
});
test('role names normalize once, reserved identities stay protected and future actions deny', () => {
  assert.equal(roleNameSchema.parse('  Cafe\u0301\u2003lead  '), 'Café lead');
  assert.equal(roleNameSchema.safeParse('  WORKSPACE\u2003ADMINISTRATOR ').success, false);
  assert.equal(roleNameSchema.safeParse('unsafe\u200bname').success, false);
  assert.equal(rolePermissionsSchema.safeParse(['turnstile:units:manage']).success, false);
  assert.equal(
    rolePermissionsSchema.safeParse(['turnstile:access', 'turnstile:documents:approve']).success,
    false,
  );
  assert.equal(
    roleDefinitionSchema.safeParse({ ...fixtureSystemRoles[0], permissions: ['turnstile:access'] })
      .success,
    false,
  );
  assert.equal(
    roleDefinitionSchema.safeParse({ ...fixtureRole, systemKey: 'workspace_administrator' })
      .success,
    false,
  );
  assert.equal(roleDefinitionSchema.parse(fixtureRole).systemKey, null);
});
test('route-specific commands reject action substitution, version omissions and unconfirmed grants', () => {
  assert.equal(
    peopleSchemas.RoleCreateRequest.safeParse(peopleExamples.MemberSuspendRequest).success,
    false,
  );
  const grant = peopleExamples.MemberAssignmentsRequest;
  assert.equal(
    peopleSchemas.MemberAssignmentsRequest.safeParse({ ...grant, confirmation: null }).success,
    false,
  );
  const { expectedOrganizationRevision: _revision, ...unversioned } = grant.command;
  assert.equal(
    peopleSchemas.MemberAssignmentsRequest.safeParse({ ...grant, command: unversioned }).success,
    false,
  );
  assert.equal(
    peopleSchemas.RoleCreateCommand.safeParse({
      ...peopleExamples.RoleCreateCommand,
      copyFromRoleId: fixtureRole.id,
    }).success,
    false,
  );
  assert.equal(
    peopleSchemas.MemberAssignmentsCommand.safeParse({
      ...grant.command,
      retireLegacyVersion: undefined,
    }).success,
    false,
  );
});
test('approval, terminal invitation and delivery generations have finite distinct representations', () => {
  assert.equal(
    invitationDeliverySchema.safeParse({ ...fixtureInvitation.delivery, attempts: 5 }).success,
    false,
  );
  assert.equal(invitationSchema.safeParse({ ...fixtureInvitation, approval: null }).success, false);
  assert.equal(
    invitationSchema.safeParse({
      ...fixtureInvitation,
      delivery: { ...fixtureInvitation.delivery, generation: 2 },
    }).success,
    false,
  );
  assert.equal(
    invitationSchema.safeParse({
      ...fixtureInvitation,
      state: 'accepted',
      acceptedUserId: 'user',
      acceptedAt: fixtureInvitation.expiresAt,
    }).success,
    false,
  );
  assert.equal(
    invitationDeliverySchema.safeParse({
      state: 'failed',
      generation: 1,
      attempts: 1,
      at: '2026-11-03T10:00:00Z',
      reason: 'deadline',
    }).success,
    false,
  );
  assert.equal(
    invitationDeliverySchema.safeParse({
      state: 'unknown',
      generation: 1,
      attempts: 1,
      at: '2026-11-03T10:00:00Z',
      reason: 'deadline',
      credential: 'secret',
    }).success,
    false,
  );
});
test('restricted/pre-identity state cannot satisfy the ordinary session contract', () => {
  const restricted = peopleExamples.RestrictedInvitationContext;
  assert.equal(accessAwareUserSessionSchema.safeParse(restricted).success, false);
  assert.equal(
    accessAwareUserSessionSchema.safeParse({
      ...peopleExamples.AccessAwareUserSession,
      permissions: [
        ...peopleExamples.AccessAwareUserSession.permissions,
        'turnstile:people:manage',
      ],
    }).success,
    false,
  );
  assert.equal(
    peopleSchemas.RestrictedInvitationContext.safeParse({
      ...restricted,
      permissions: ['turnstile:access'],
    }).success,
    false,
  );
  assert.equal(
    peopleSchemas.RestrictedInvitationContext.safeParse({ ...restricted, refreshToken: 'secret' })
      .success,
    false,
  );
  assert.equal(
    accessAwareUserSessionSchema.safeParse({
      ...peopleExamples.AccessAwareUserSession,
      access: { ...peopleExamples.UserAccessContext, fingerprint: 'wrong' },
    }).success,
    false,
  );
  assert.equal(
    peopleSchemas.InvitationAcceptanceResult.safeParse({
      ...peopleExamples.InvitationAcceptanceResult,
      membershipStatus: 'suspended',
      session: 'established',
    }).success,
    false,
  );
});
test('scoped success and conflict projections cannot carry whole configuration or hidden records', () => {
  const scoped = peopleExamples.ScopedUnitsResponse;
  assert.equal(
    scopedUnitsResponseSchema.safeParse({ ...scoped, organization: { name: 'hidden' } }).success,
    false,
  );
  assert.equal(
    scopedUnitsResponseSchema.safeParse({
      ...scoped,
      ancestors: [
        ...scoped.ancestors,
        { id: fixtureId(88), type: 'department', name: 'Unrelated', actionable: false },
      ],
    }).success,
    false,
  );
  assert.equal(
    peopleErrorSchema.safeParse({ ...peopleExamples.PeopleError, configuration: { units: [] } })
      .success,
    false,
  );
  assert.equal(
    peopleErrorSchema.safeParse({ ...peopleExamples.PeopleError, reason: 'raw SQL exception' })
      .success,
    false,
  );
  assert.equal(PEOPLE_ERROR_STATUS.SETUP_REQUIRED, 409);
  assert.equal(PEOPLE_ERROR_STATUS.INVITATION_UNAVAILABLE, 410);
});
test('role-only impact cannot reveal member IDs, and query envelopes remain bounded', () => {
  const {
    visibility: _visibility,
    affectedMemberIds: _members,
    affectedInvitationIds: _invitations,
    memberCount: _memberCount,
    invitationCount: _invitationCount,
    assignments: _assignments,
    ...base
  } = peopleExamples.ImpactReview;
  assert.equal(
    peopleSchemas.ImpactReview.safeParse({
      ...base,
      visibility: 'definitions',
      roles: [fixtureRole],
      affectedMemberIds: [fixtureId(40)],
    }).success,
    false,
  );
  assert.equal(peopleListQuerySchema.parse({}).limit, 25);
  assert.equal(peopleListQuerySchema.parse({ limit: '100' }).limit, 100);
  assert.equal(peopleListQuerySchema.safeParse({ limit: '1e2' }).success, false);
  assert.equal(peopleListQuerySchema.parse({ search: '  ' }).search, undefined);
  assert.equal(peopleListQuerySchema.safeParse({ limit: 101 }).success, false);
  assert.equal(peopleListQuerySchema.safeParse({ limit: [1, 2] }).success, false);
  assert.equal(peopleListQuerySchema.safeParse({ tenantId: fixtureId(1) }).success, false);
  assert.equal(
    peopleSchemas.InvitationAccept.safeParse({
      ...peopleExamples.InvitationAccept,
      permissionDigest: fixtureDigest,
      returnTo: 'https://invalid.example',
    }).success,
    false,
  );
});
test('recipient review cannot add unrelated units, bind another email or outlive its invitation', () => {
  const verified = peopleNamedExamples.RestrictedInvitationContext.verified.value;
  assert.equal(
    peopleSchemas.RestrictedInvitationContext.safeParse({
      ...verified,
      user: { ...verified.user, email: 'different@example.test' },
    }).success,
    false,
  );
  assert.equal(
    peopleSchemas.RestrictedInvitationContext.safeParse({
      ...verified,
      expiresAt: '2026-11-11T00:00:00Z',
    }).success,
    false,
  );
  const review = verified.review;
  assert.equal(
    peopleSchemas.RecipientReview.safeParse({
      ...review,
      scopeContext: [
        ...review.scopeContext,
        { ...review.scopeContext[0], unit: { ...review.scopeContext[0].unit, id: fixtureId(88) } },
      ],
    }).success,
    false,
  );
  assert.equal(
    scopedUnitsResponseSchema.safeParse({ ...peopleExamples.ScopedUnitsResponse, ancestors: [] })
      .success,
    false,
  );
});
test('generated OpenAPI keeps normal/restricted/service authority and HTTP error codes distinct', () => {
  const product = JSON.parse(
    readFileSync(
      new URL('../../../docs/api/turnstile-people.openapi.json', import.meta.url),
      'utf8',
    ),
  );
  const authority = JSON.parse(
    readFileSync(
      new URL('../../../docs/api/identity-invitations.openapi.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(product.openapi, '3.1.0');
  assert.equal(
    product['x-implementation-status'],
    'UM-I05 structure, UM-I08 recipient and UM-I09 administration operations implemented; ordinary feature writers gated',
  );
  const implemented = Object.entries(product.paths).flatMap(([path, methods]) =>
    Object.entries(methods)
      .filter(([, operation]) => operation['x-implementation-status'].startsWith('implemented;'))
      .map(([method]) => `${method.toUpperCase()} ${path}`),
  );
  assert.deepEqual(implemented.sort(), [
    'DELETE /api/structure/units/{id}',
    'GET /api/structure/commands/{id}',
    'GET /api/structure/units',
    'GET /api/structure/units/{id}',
    'PATCH /api/structure/units/{id}',
    'PATCH /api/structure/units/{id}/parent',
    'POST /api/structure/move-impact',
    'POST /api/structure/units',
  ]);
  assert.equal(JSON.stringify(product.components.schemas).includes('ConfigurationSnapshot'), false);
  for (const route of PEOPLE_ROUTES) {
    const operation = product.paths[route.path][route.method.toLowerCase()];
    assert.equal(operation['x-authentication-policy'], route.policy);
    if (route.path.startsWith('/api/invitations/'))
      assert.match(operation['x-implementation-status'], /^implemented \(UM-I08\)/);
    if (route.path.startsWith('/api/people/')) {
      assert.match(operation['x-implementation-status'], /^implemented \(UM-I09\)/);
      assert.ok(operation['x-release-gate']);
    }
    assert.equal(operation['x-workspace-readiness-required'], route.policy.startsWith('normal_'));
    assert.equal(
      operation['x-csrf-required'],
      route.method !== 'GET' && route.policy !== 'invitation_credential',
    );
  }
  for (const operation of Object.values(
    authority.paths['/internal/identity/v1/subject-projections'],
  )) {
    assert.equal(operation['x-private-ingress-only'], true);
    assert.deepEqual(operation.security, [{ IdentityServiceOAuth: ['identity:subjects:read'] }]);
  }
  const setup = authority.paths['/identity/invitation-setup/complete'].post;
  assert.equal(setup['x-csrf-required'], true);
  assert.equal(JSON.stringify(setup.security).includes('IdentityServiceOAuth'), false);
  for (const [name, schema] of Object.entries(product.components.schemas)) {
    if (!/^PeopleError\d+$/.test(name)) continue;
    const status = Number(name.replace('PeopleError', ''));
    for (const variant of schema.anyOf ?? [schema])
      for (const code of variant.properties.code.enum)
        assert.equal(PEOPLE_ERROR_STATUS[code], status);
  }
});
test('all feature routes classify their authentication and request/response contracts explicitly', () => {
  assert.equal(
    new Set(PEOPLE_ROUTES.map((route) => `${route.method}:${route.path}`)).size,
    PEOPLE_ROUTES.length,
  );
  for (const route of PEOPLE_ROUTES) {
    assert.ok(peopleSchemas[route.response]);
    if (route.request) assert.ok(peopleSchemas[route.request]);
    if (route.path.startsWith('/api/invitations/'))
      assert.ok(route.policy.startsWith('invitation_'));
    else assert.ok(route.policy.startsWith('normal_'));
  }
});
