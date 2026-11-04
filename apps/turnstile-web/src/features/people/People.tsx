import { Add01Icon, Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  type InvitationDto,
  invitationListResponseSchema,
  type MemberDto,
  memberListResponseSchema,
  type PeoplePermission,
  peopleCommandSchema,
  permissionCatalogSchema,
  type RoleAssignmentRequestDto,
  type RoleDefinitionDto,
  roleListResponseSchema,
  type UserSessionDto,
} from '@thaarei/turnstile-contracts';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ButtonLink } from '@/components/button-link';
import { ContentLoading } from '@/components/content-loading';
import { Notice } from '@/components/notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldLabel, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { useUnsavedEntries } from '../configuration/shared';
import { AccessEmpty, AccessInspector, Reload, RoleTable } from './AccessViews';
import { PeopleActivity } from './activity';
import { company, message } from './client';
import { MemberIdentity, MemberOverview, MemberTable } from './Members';
import { Review } from './Review';
import { ScopedStructure } from './Structure';
import {
  AssignmentEditor,
  AssignmentSummary,
  Check,
  FormFields,
  Pager,
  Permissions,
  permissionLabel,
  Search,
  usePage,
} from './shared';
export const peoplePaths = [
  '/people/members',
  '/people/invitations',
  '/people/roles',
  '/structure',
];
export function People({
  session,
  path,
  onCheck,
  active = true,
  requestedPath = path,
}: {
  session: UserSessionDto;
  path: string;
  active?: boolean;
  requestedPath?: string;
  onCheck: (fresh?: boolean) => Promise<boolean>;
}) {
  const isRoles = path === '/people/roles',
    isUnits = path === '/structure';
  const allowed = isUnits
    ? true
    : company(session, isRoles ? 'turnstile:roles:manage' : 'turnstile:people:manage');
  return (
    <div className="access-workspace">
      <header className="access-heading">
        <span className="eyebrow">PEOPLE & ACCESS</span>
        <h1 className="page-title">
          {isUnits
            ? 'Structure'
            : isRoles
              ? 'Roles'
              : path.endsWith('invitations')
                ? 'Invitations'
                : 'Members'}
        </h1>
        <p className="intro">
          {isUnits
            ? 'Organize your sites and departments in one connected hierarchy.'
            : isRoles
              ? 'Define what people can do. Choose where access applies when assigning a role.'
              : path.endsWith('invitations')
                ? 'Invite people and track their access approvals.'
                : 'See who belongs here, understand their access, and manage roles or workspace membership.'}
        </p>
      </header>
      {!isUnits && (
        <nav aria-label="People sections" className="access-sections">
          {peoplePaths
            .filter(
              (p) =>
                p !== '/structure' &&
                company(
                  session,
                  p.endsWith('roles') ? 'turnstile:roles:manage' : 'turnstile:people:manage',
                ),
            )
            .map((p) => (
              <ButtonLink
                href={p}
                key={p}
                variant={requestedPath === p ? 'secondary' : 'ghost'}
                aria-current={requestedPath === p ? 'page' : undefined}
              >
                {p === '/structure'
                  ? 'Structure'
                  : p.endsWith('roles')
                    ? 'Roles'
                    : p.endsWith('invitations')
                      ? 'Invitations'
                      : 'Members'}
              </ButtonLink>
            ))}
        </nav>
      )}
      {!allowed && (
        <Notice message="You do not have access to this section. Check your session for current permissions. Your unsaved entries are kept on this page." />
      )}
      <PeopleActivity value={active && allowed}>
        <div hidden={!active || !allowed} inert={!active || !allowed}>
          {isUnits ? (
            <ScopedStructure session={session} onCheck={onCheck} />
          ) : (
            <Directory
              key={`${session.user.id}:${path}`}
              session={session}
              kind={isRoles ? 'roles' : path.endsWith('invitations') ? 'invitations' : 'members'}
              onCheck={onCheck}
            />
          )}
        </div>
      </PeopleActivity>
      <Button variant="ghost" className="self-start" onClick={() => void onCheck()}>
        Refresh session and access
      </Button>
    </div>
  );
}
function Directory({
  session,
  kind,
  onCheck,
}: {
  session: UserSessionDto;
  kind: 'members' | 'invitations' | 'roles';
  onCheck: (fresh?: boolean) => Promise<boolean>;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const composeIntent =
    kind === 'invitations' &&
    location.pathname === '/people/invitations' &&
    location.state?.peopleAction === 'invite';
  const [search, setSearch] = useState(''),
    [cursors, setCursors] = useState<string[]>([]),
    [filter, setFilter] = useState('');
  const [saved, setSaved] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<
    MemberDto | InvitationDto | RoleDefinitionDto | 'new' | undefined
  >(composeIntent ? 'new' : undefined);
  useEffect(() => {
    if (composeIntent) {
      setSelected('new');
      void navigate('/people/invitations', { replace: true, state: null });
    }
  }, [composeIntent, navigate]);
  const query = `limit=25${search ? `&search=${encodeURIComponent(search)}` : ''}${cursors.length ? `&cursor=${encodeURIComponent(cursors.at(-1) ?? '')}` : ''}${filter ? `&${kind === 'roles' ? 'kind' : kind === 'members' ? 'status' : 'state'}=${filter}` : ''}`;
  const schema =
    kind === 'members'
      ? memberListResponseSchema
      : kind === 'invitations'
        ? invitationListResponseSchema
        : roleListResponseSchema;
  const page = usePage(
    `/api/people/${kind}?${query}`,
    schema as {
      parse(value: unknown): {
        items: (MemberDto | InvitationDto | RoleDefinitionDto)[];
        nextCursor: string | null;
        total: number;
        accessRevision: number;
      };
    },
    `${session.access?.accessRevision}:${session.access?.fingerprint}`,
  );

  async function changed() {
    setRefreshing(true);
    setSaved(true);
    setSelected(undefined);
    try {
      // Drain preceding reads and refresh the access generation before reloading the directory.
      if (await onCheck(true)) {
        page.refresh();
        setCursors([]);
      }
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      {saved && (
        <Notice
          success
          message={refreshing || page.loading ? 'Saved. Refreshing access…' : 'Changes saved.'}
        />
      )}
      <div className="access-workbench" data-editing={!!selected}>
        <section className="access-surface" aria-label={`${kind} directory`}>
          <div className="access-toolbar">
            <Search
              placeholder={`Search ${kind}…`}
              onChange={(s) => {
                setSearch(s);
                setCursors([]);
              }}
            />
            <Field className="access-filter">
              <FieldLabel className="sr-only" htmlFor="people-filter">
                Filter
              </FieldLabel>
              <NativeSelect
                className="max-w-full"
                id="people-filter"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setCursors([]);
                }}
              >
                <option value="">{kind === 'roles' ? 'All role types' : 'All statuses'}</option>
                {(kind === 'members'
                  ? ['active', 'suspended']
                  : kind === 'roles'
                    ? ['system', 'custom']
                    : ['pending', 'needs_reapproval', 'accepted', 'cancelled', 'expired']
                ).map((v) => (
                  <option key={v} value={v}>
                    {v.charAt(0).toUpperCase() + v.slice(1).replaceAll('_', ' ')}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Reload loading={page.loading} onClick={page.refresh} />
            {kind === 'members' && (
              <Button
                onClick={() =>
                  void navigate('/people/invitations', { state: { peopleAction: 'invite' } })
                }
              >
                <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
                Invite person
              </Button>
            )}
            {kind !== 'members' && (
              <Button
                disabled={!!selected || page.loading || refreshing}
                onClick={() => setSelected('new')}
              >
                <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
                {kind === 'roles' ? 'Create role' : 'Invite person'}
              </Button>
            )}
          </div>
          {page.loading && <ContentLoading label={`Loading ${kind}…`} />}{' '}
          {!!page.failure && (
            <>
              <Notice message={message(page.failure)} />
              <Button onClick={page.refresh}>Reload current data</Button>
            </>
          )}
          {page.value && (
            <>
              <div className="access-directory-content" aria-busy={page.loading}>
                {!page.value.items.length && (
                  <AccessEmpty
                    title={`No matching ${kind}`}
                    description="Try another search or filter. Your current access determines what appears here."
                  />
                )}
                {kind === 'roles' ? (
                  <RoleTable
                    roles={page.value.items.filter(
                      (item): item is RoleDefinitionDto => 'permissions' in item,
                    )}
                    selectedId={selected && selected !== 'new' ? selected.id : undefined}
                    disabled={!!selected || page.loading || refreshing}
                    onSelect={setSelected}
                  />
                ) : kind === 'members' ? (
                  <MemberTable
                    members={page.value.items.filter((item): item is MemberDto => 'userId' in item)}
                    currentUserId={session.user.id}
                    selectedId={selected && selected !== 'new' ? selected.id : undefined}
                    disabled={!!selected || page.loading || refreshing}
                    onSelect={setSelected}
                  />
                ) : (
                  page.value.items.map((item) => (
                    <Card key={item.id}>
                      <CardHeader>
                        <CardTitle>
                          <h2 className="break-words">
                            {'userId' in item
                              ? 'name' in item.identity
                                ? item.identity.name
                                : item.userId
                              : 'email' in item
                                ? item.email
                                : item.name}
                          </h2>
                        </CardTitle>
                        <CardDescription>
                          {'userId' in item
                            ? `${item.status} · Identity ${item.identity.state}`
                            : 'email' in item
                              ? `${item.state.replaceAll('_', ' ')} · Delivery ${item.delivery?.state.replaceAll('_', ' ') ?? 'unavailable'}`
                              : `${item.systemKey ? 'System template' : 'Custom role'} · Version ${item.version}`}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-4">
                        {'assignments' in item ? (
                          <details>
                            <summary className="cursor-pointer">
                              Assignments and grant sources
                            </summary>
                            <AssignmentSummary assignments={item.assignments} session={session} />
                            {'legacySource' in item && item.legacySource && (
                              <p className="text-sm">
                                Imported source (
                                {item.legacySource.retired ? 'retired' : 'retained'}):{' '}
                                {item.legacySource.permissions.map(permissionLabel).join(', ')}
                              </p>
                            )}
                          </details>
                        ) : (
                          <p className="text-sm">
                            {item.permissions.map(permissionLabel).join(', ')}
                          </p>
                        )}
                        {'userId' in item && 'email' in item.identity && (
                          <p className="break-words text-sm">
                            {item.identity.email}
                            {item.identity.state === 'stale'
                              ? ' · Last verified display; refresh before relying on contact details.'
                              : ''}
                          </p>
                        )}
                        {'email' in item && item.delivery?.state === 'unknown' && (
                          <p>
                            Delivery may have occurred. Check with the recipient before deliberately
                            resending.
                          </p>
                        )}
                        <Button
                          variant="outline"
                          className="self-start"
                          disabled={!!selected || page.loading || refreshing}
                          onClick={() => setSelected(item)}
                        >
                          View and manage
                        </Button>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
              <Pager
                total={page.value.total}
                next={page.value.nextCursor}
                previous={!!cursors.length}
                onNext={() => setCursors((old) => [...old, page.value?.nextCursor ?? ''])}
                onPrevious={() => setCursors((old) => old.slice(0, -1))}
              />
            </>
          )}
          {kind === 'members' && (
            <p className="access-caption">
              Select a person to review their roles and coverage. Invite new people from
              Invitations.
            </p>
          )}
          {kind === 'roles' && (
            <p className="access-caption">
              Roles define permissions. Each person’s assignment determines company or unit
              coverage.
            </p>
          )}
        </section>
        {selected && (
          <AccessInspector
            key={selected === 'new' ? 'new' : selected.id}
            label={kind === 'roles' ? 'Role details' : 'Access details'}
          >
            <Editor
              key={selected === 'new' ? 'new' : selected.id}
              session={session}
              kind={kind}
              value={selected}
              accessRevision={page.value?.accessRevision ?? session.access?.accessRevision ?? 0}
              onSaved={changed}
              onClose={() => setSelected(undefined)}
            />
          </AccessInspector>
        )}
      </div>
    </>
  );
}
function Editor({
  session,
  kind,
  value,
  accessRevision,
  onSaved,
  onClose,
}: {
  session: UserSessionDto;
  kind: 'members' | 'invitations' | 'roles';
  value: MemberDto | InvitationDto | RoleDefinitionDto | 'new';
  accessRevision: number;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const member = value !== 'new' && 'userId' in value ? value : undefined;
  const invitation = value !== 'new' && 'email' in value ? value : undefined;
  const role = value !== 'new' && 'permissions' in value ? value : undefined;
  const [editingMember, setEditingMember] = useState(false);
  const [roleAction, setRoleAction] = useState(role?.systemKey ? 'copy' : 'details');
  const [name, setName] = useState(role?.systemKey ? `${role.name} copy` : (role?.name ?? '')),
    [description, setDescription] = useState(role?.description ?? ''),
    [email, setEmail] = useState(invitation?.email ?? '');
  const [permissions, setPermissions] = useState<PeoplePermission[]>(
    role?.permissions ?? ['turnstile:access'],
  );
  const initial = member?.assignments ?? invitation?.assignments ?? [];
  const [assignments, setAssignments] = useState<RoleAssignmentRequestDto[]>(
    initial.map((a) => ({
      roleId: a.role.id,
      expectedRoleVersion: a.role.version,
      scope: a.scope,
    })),
  );
  const [retire, setRetire] = useState(false),
    [dirty, setDirty] = useState(false),
    [command, setCommand] = useState<unknown>();
  const markSaved = useUnsavedEntries(dirty || !!command);
  const catalog = usePage(
    '/api/people/catalog',
    permissionCatalogSchema,
    session.access?.fingerprint,
  );
  const organizationRevision = catalog.value?.organizationRevision;
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [reviewFooter, setReviewFooter] = useState<HTMLDivElement | null>(null);
  const cancelDraft = () => {
    if (member && editingMember) {
      setAssignments(
        initial.map((a) => ({
          roleId: a.role.id,
          expectedRoleVersion: a.role.version,
          scope: a.scope,
        })),
      );
      setRetire(false);
      setDirty(false);
      setEditingMember(false);
      setFailure(undefined);
      markSaved();
      return;
    }
    markSaved();
    onClose();
  };
  async function review(operation: string, extra: object = {}) {
    try {
      const revision = organizationRevision;
      if (
        revision === undefined &&
        operation !== 'role.create' &&
        operation !== 'role.delete' &&
        operation !== 'role.details' &&
        operation !== 'role.copy' &&
        operation !== 'invitation.cancel'
      )
        throw new Error(
          'Choose Refresh session and access, then retry when unit context is available.',
        );
      const versions = {
        expectedAccessRevision: accessRevision,
        ...(revision !== undefined ? { expectedOrganizationRevision: revision } : {}),
      };
      const base = value === 'new' ? {} : { id: value.id, expectedVersion: value.version };
      let body: unknown;
      if (operation === 'role.create')
        body = {
          operation,
          expectedAccessRevision: accessRevision,
          source: 'new',
          name,
          description: description || null,
          permissions,
        };
      else if (operation === 'role.copy')
        body = {
          operation: 'role.create',
          expectedAccessRevision: accessRevision,
          source: 'copy',
          name,
          description: description || null,
          copyFromRoleId: role?.id,
          expectedRoleVersion: role?.version,
        };
      else if (operation === 'role.details')
        body = {
          operation: 'role.patch',
          change: 'details',
          expectedAccessRevision: accessRevision,
          ...base,
          name,
          description: description || null,
        };
      else if (operation === 'role.permissions')
        body = {
          operation: 'role.patch',
          change: 'permissions',
          ...versions,
          ...base,
          permissions,
        };
      else if (operation.startsWith('role.'))
        body = { operation, expectedAccessRevision: accessRevision, ...base };
      else if (operation.startsWith('member.'))
        body = {
          operation,
          ...versions,
          ...base,
          ...(operation === 'member.assignments'
            ? { assignments, retireLegacyVersion: retire ? member?.legacySource?.version : null }
            : {}),
        };
      else
        body = {
          operation,
          ...versions,
          ...base,
          ...(invitation ? { expectedGeneration: invitation.generation } : {}),
          ...(['invitation.issue', 'invitation.reapprove'].includes(operation)
            ? { email, assignments }
            : {}),
          ...extra,
        };
      if (operation === 'invitation.cancel')
        body = {
          operation,
          expectedAccessRevision: accessRevision,
          ...base,
          expectedGeneration: invitation?.generation,
        };
      setFailure(undefined);
      setCommand(peopleCommandSchema.parse(body));
    } catch (e) {
      setFailure(e);
    }
  }
  function saved() {
    markSaved();
    setDirty(false);
    return onSaved();
  }
  return (
    <Card variant="panel" className="access-panel">
      <CardHeader className="access-panel-header">
        <div className="access-panel-kicker">
          {command
            ? 'Review change'
            : member
              ? 'Workspace member'
              : kind === 'roles'
                ? 'Role definition'
                : 'Workspace invitation'}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="access-panel-close"
          aria-label="Close panel"
          disabled={busy}
          onClick={() => {
            if (busy) return;
            if ((dirty || !!command) && !window.confirm('Discard this unsaved draft?')) return;
            markSaved();
            onClose();
          }}
        >
          <HugeiconsIcon icon={Cancel01Icon} />
        </Button>
        {member ? (
          <MemberIdentity member={member} currentUserId={session.user.id} />
        ) : (
          <CardTitle>
            <h2 className="break-words">
              {kind === 'roles'
                ? (role?.name ?? 'Create role')
                : kind === 'members'
                  ? 'Member access'
                  : invitation
                    ? 'Invitation details'
                    : 'Invite person'}
            </h2>
          </CardTitle>
        )}
        <CardDescription>
          {member
            ? editingMember
              ? 'Edit role assignments, then review the change.'
              : 'Member access overview'
            : role?.systemKey
              ? 'System role · Use a new name to create a custom copy.'
              : kind === 'roles'
                ? 'Give this role a purpose and choose what it allows.'
                : 'Choose a recipient and the access they should receive.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="access-panel-body">
        <div className="flex flex-col gap-5">
          {!!failure && <Notice message={message(failure)} />}{' '}
          {command ? (
            <Review
              command={command}
              target={
                role?.name ??
                invitation?.email ??
                (member && 'name' in member.identity ? member.identity.name : member?.userId) ??
                (kind === 'roles' ? name : email)
              }
              session={session}
              onSaved={saved}
              onBusyChange={setBusy}
              actionsTarget={reviewFooter}
              onCancel={() => setCommand(undefined)}
            />
          ) : member && !editingMember ? (
            <>
              {!!catalog.failure && (
                <>
                  <Notice message={message(catalog.failure)} />
                  <Button variant="outline" onClick={catalog.refresh}>
                    Reload access choices
                  </Button>
                </>
              )}
              <MemberOverview
                member={member}
                session={session}
                disabled={catalog.loading || !catalog.value}
                onEdit={() => setEditingMember(true)}
                onStatus={() =>
                  void review(`member.${member.status === 'active' ? 'suspend' : 'reactivate'}`)
                }
              />
            </>
          ) : (
            <>
              {catalog.loading && <ContentLoading label="Loading current grant choices…" />}
              {!!catalog.failure && <Notice message={message(catalog.failure)} />}
              {!!catalog.failure && (
                <Button
                  className="self-start"
                  variant="outline"
                  disabled={catalog.loading}
                  onClick={catalog.refresh}
                >
                  Reload grant choices
                </Button>
              )}
              <FieldSet
                className="access-panel-fields"
                disabled={catalog.loading || !catalog.value}
              >
                {kind === 'roles' ? (
                  <>
                    {role && !role.systemKey && (
                      <Field>
                        <FieldLabel htmlFor="role-action">Role action</FieldLabel>
                        <NativeSelect
                          id="role-action"
                          value={roleAction}
                          onChange={(e) => {
                            if (
                              dirty &&
                              !window.confirm('Discard edits before changing this action?')
                            )
                              return;
                            setDirty(false);
                            setPermissions(role.permissions);
                            setRoleAction(e.target.value);
                            setName(e.target.value === 'copy' ? `${role.name} copy` : role.name);
                            setDescription(role.description ?? '');
                          }}
                        >
                          <option value="details">Edit name and description</option>
                          <option value="permissions">Edit permissions</option>
                          <option value="copy">Create a custom copy</option>
                          <option value="delete">Delete role</option>
                        </NativeSelect>
                      </Field>
                    )}
                    {(!role || roleAction === 'details' || roleAction === 'copy') && (
                      <FormFields
                        name={name}
                        setName={(v) => {
                          setName(v);
                          setDirty(true);
                        }}
                        description={description}
                        setDescription={(v) => {
                          setDescription(v);
                          setDirty(true);
                        }}
                      />
                    )}
                    {(!role || roleAction === 'permissions') && (
                      <Permissions
                        value={permissions}
                        onChange={(p) => {
                          setPermissions(p);
                          setDirty(true);
                        }}
                        allowed={catalog.value?.grantableCompanyPermissions ?? []}
                      />
                    )}
                    {role?.systemKey && (
                      <>
                        <div className="access-permission-summary">
                          {role.permissions.map((p) => (
                            <Badge variant="outline" key={p}>
                              {permissionLabel(p)}
                            </Badge>
                          ))}
                        </div>
                        <p>
                          System templates are read-only. Choose a new name to copy permissions into
                          a custom role. Copies do not become protected administrators.
                        </p>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {invitation && invitation.state !== 'needs_reapproval' && (
                      <p className="text-sm text-muted-foreground">
                        Saved approval is read-only. Resending preserves its recipient and
                        assignments; terminal invitations cannot be changed.
                      </p>
                    )}
                    {invitation && invitation.state !== 'needs_reapproval' ? (
                      <section className="invitation-saved">
                        <div className="access-permission-summary">
                          <Badge variant="secondary">{invitation.state.replaceAll('_', ' ')}</Badge>
                          <Badge variant="outline">
                            {invitation.delivery?.state.replaceAll('_', ' ') ??
                              'Delivery unavailable'}
                          </Badge>
                        </div>
                        <h3>{invitation.email}</h3>
                        <p className="panel-help">Approved roles and coverage</p>
                        <AssignmentSummary assignments={invitation.assignments} session={session} />
                      </section>
                    ) : (
                      <FieldSet>
                        {kind === 'invitations' && (
                          <Field>
                            <FieldLabel htmlFor="invitation-email">Recipient email</FieldLabel>
                            <Input
                              id="invitation-email"
                              type="email"
                              value={email}
                              onChange={(e) => {
                                setEmail(e.target.value);
                                setDirty(true);
                              }}
                              autoComplete="off"
                            />
                          </Field>
                        )}

                        <AssignmentEditor
                          value={assignments}
                          onChange={(a) => {
                            setAssignments(a);
                            setDirty(true);
                          }}
                          session={session}
                        />
                        {member?.legacySource && !member.legacySource.retired && (
                          <Check
                            checked={retire}
                            onChange={(v) => {
                              setRetire(v);
                              setDirty(true);
                            }}
                          >
                            Retire imported grants (
                            {member.legacySource.permissions.map(permissionLabel).join(', ')})
                          </Check>
                        )}
                      </FieldSet>
                    )}
                  </>
                )}
              </FieldSet>
            </>
          )}
        </div>
      </CardContent>
      {command ? (
        <CardFooter className="access-panel-footer">
          <div ref={setReviewFooter} className="access-review-footer" />
        </CardFooter>
      ) : (
        <CardFooter className="access-panel-footer">
          {member && !editingMember ? (
            <Button variant="outline" className="self-start" onClick={onClose}>
              Close details
            </Button>
          ) : (
            <>
              {kind === 'roles' ? (
                <Button
                  disabled={
                    catalog.loading ||
                    !catalog.value ||
                    busy ||
                    ((!role || roleAction === 'copy' || roleAction === 'details') && !name.trim())
                  }
                  variant={role && roleAction === 'delete' ? 'destructive' : 'default'}
                  onClick={() => void review(!role ? 'role.create' : `role.${roleAction}`)}
                >
                  {!role
                    ? 'Review new role'
                    : roleAction === 'copy'
                      ? 'Review custom copy'
                      : roleAction === 'permissions'
                        ? 'Review permissions'
                        : roleAction === 'delete'
                          ? 'Review deletion'
                          : 'Review details'}
                </Button>
              ) : member ? (
                <Button
                  disabled={
                    catalog.loading ||
                    !catalog.value ||
                    assignments.some(
                      (a) => !a.roleId || (a.scope.kind === 'units' && !a.scope.unitIds.length),
                    )
                  }
                  onClick={() => void review('member.assignments')}
                >
                  Review assignments
                </Button>
              ) : !invitation ? (
                <Button
                  disabled={
                    catalog.loading ||
                    !catalog.value ||
                    !email.trim() ||
                    !assignments.length ||
                    assignments.some(
                      (a) => !a.roleId || (a.scope.kind === 'units' && !a.scope.unitIds.length),
                    )
                  }
                  onClick={() => void review('invitation.issue')}
                >
                  Review invitation
                </Button>
              ) : (
                <>
                  {invitation.state === 'pending' && (
                    <Button
                      disabled={catalog.loading || !catalog.value}
                      onClick={() => void review('invitation.resend')}
                    >
                      Review resend
                    </Button>
                  )}
                  {invitation.state === 'needs_reapproval' && (
                    <Button
                      disabled={catalog.loading || !catalog.value}
                      onClick={() => void review('invitation.reapprove')}
                    >
                      Review reapproval
                    </Button>
                  )}
                  {['pending', 'needs_reapproval'].includes(invitation.state) && (
                    <Button variant="outline" onClick={() => void review('invitation.cancel')}>
                      Review cancellation
                    </Button>
                  )}
                </>
              )}{' '}
              <Button variant="outline" className="self-start" onClick={cancelDraft}>
                {member ? 'Cancel changes' : 'Cancel and discard draft'}
              </Button>
            </>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
