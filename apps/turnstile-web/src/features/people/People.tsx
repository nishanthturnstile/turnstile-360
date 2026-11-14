import { Add01Icon, Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  type InvitationDto,
  invitationEmailSchema,
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
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { ContentLoading } from '@/components/content-loading';
import { AppLink } from '@/components/navigation';
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
import { AccessEmpty, Reload, RoleTable } from './AccessViews';
import { PeopleAudit } from './Audit';
import { PeopleActivity } from './activity';
import { BulkInvitations } from './BulkInvitations';
import { company, message } from './client';
import { DirectoryFilters } from './DirectoryFilters';
import { PeopleImports } from './Imports';
import { deliveryStatus, InvitationTable, invitationStatus } from './Invitations';
import { MemberIdentity, MemberOverview, MemberTable } from './Members';
import { peoplePaths } from './navigation-state';
import { PeopleQueryScope } from './QueryScope';
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
import { TaskSheet, useTaskConfirm, useTaskDismiss } from './TaskSheet';

export { peoplePaths } from './navigation-state';

type PeopleProps = {
  session: UserSessionDto;
  path: string;
  active?: boolean;
  requestedPath?: string;
  verification: number;
  onCheck: (fresh?: boolean) => Promise<boolean>;
};
export function People(props: PeopleProps) {
  return (
    <PeopleQueryScope
      session={props.session}
      active={props.active ?? true}
      onCheck={props.onCheck}
      verification={props.verification}
    >
      <PeopleContent {...props} />
    </PeopleQueryScope>
  );
}
function PeopleContent({
  session,
  path,
  onCheck,
  active = true,
  requestedPath = path,
}: PeopleProps) {
  const pending =
    requestedPath.startsWith('/people/') && path.startsWith('/people/') && requestedPath !== path;
  const isRoles = path === '/people/roles',
    isUnits = path === '/structure';
  const allowed = isUnits
    ? true
    : company(session, isRoles ? 'turnstile:roles:manage' : 'turnstile:people:manage');
  return (
    <div className="access-workspace" data-structure={isUnits || undefined}>
      {!isUnits && (
        <header className="access-heading">
          <span className="eyebrow">WORKSPACE</span>
          <h1 className="page-title">{isUnits ? 'Structure' : 'Users'}</h1>
          <p className="intro">
            {isUnits
              ? 'Organize your sites and departments in one connected hierarchy.'
              : 'Manage members and their workspace access.'}
          </p>
        </header>
      )}
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
              <AppLink href={p} key={p} aria-current={requestedPath === p ? 'page' : undefined}>
                {p === '/structure'
                  ? 'Structure'
                  : p.endsWith('roles')
                    ? 'Roles'
                    : p.endsWith('invitations')
                      ? 'Invitations'
                      : p.endsWith('activity')
                        ? 'Activity'
                        : 'Members'}
              </AppLink>
            ))}
        </nav>
      )}
      {!allowed && (
        <Notice message="You do not have access to this section. Check your session for current permissions. Your unsaved entries are kept on this page." />
      )}
      <PeopleActivity value={active && allowed && !pending}>
        <div
          className={isUnits ? 'hierarchy-content' : undefined}
          hidden={!active || !allowed}
          inert={!active || !allowed}
          aria-busy={pending}
        >
          {pending && (
            <p className="picker-loading" role="status">
              Opening {requestedPath.split('/').at(-1)}…
            </p>
          )}
          {isUnits ? (
            <ScopedStructure session={session} onCheck={onCheck} />
          ) : path === '/people/activity' ? (
            <PeopleAudit session={session} />
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
      <details className="access-session-tools">
        <summary>Session and access</summary>
        <Button variant="ghost" className="self-start" onClick={() => void onCheck()}>
          Refresh session and access
        </Button>
      </details>
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
  const [params, setParams] = useSearchParams();
  const filterKey = kind === 'roles' ? 'kind' : kind === 'members' ? 'status' : 'state';
  const search = params.get('search') ?? '';
  const filter = params.get(filterKey) ?? '';
  const roleId = params.get('roleId') ?? '';
  const unitId = params.get('unitId') ?? '';
  const delivery = params.get('delivery') ?? '';
  const actionable = params.get('actionable') === 'true';
  const sort = params.get('sort') ?? (kind === 'invitations' ? 'created_desc' : 'name');
  const binding = params.toString();
  const [pagination, setPagination] = useState<{ binding: string; cursors: string[] }>({
    binding,
    cursors: [],
  });
  const cursors = pagination.binding === binding ? pagination.cursors : [];
  const setCursors = (value: string[] | ((old: string[]) => string[])) =>
    setPagination((old) => ({
      binding,
      cursors:
        typeof value === 'function' ? value(old.binding === binding ? old.cursors : []) : value,
    }));
  const updateFilters = (values: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next);
  };
  const [bulk, setBulk] = useState(false);
  const [imports, setImports] = useState(false);
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
  const query = `${roleId && kind !== 'roles' ? `roleId=${encodeURIComponent(roleId)}&` : ''}${unitId && kind === 'members' ? `unitId=${encodeURIComponent(unitId)}&` : ''}limit=25&sort=${encodeURIComponent(sort)}${search ? `&search=${encodeURIComponent(search)}` : ''}${cursors.length ? `&cursor=${encodeURIComponent(cursors.at(-1) ?? '')}` : ''}${filter ? `&${filterKey}=${encodeURIComponent(filter)}` : ''}${kind === 'invitations' && delivery ? `&delivery=${encodeURIComponent(delivery)}` : ''}${kind === 'invitations' && actionable ? '&actionable=true' : ''}`;
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
        usage?: { roleId: string; memberCount: number; invitationCount: number }[];
      };
    },
    `${session.access?.accessRevision}:${session.access?.fingerprint}`,
  );

  async function changed() {
    setRefreshing(true);
    setSaved(true);
    setSelected(undefined);
    setBulk(false);
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
      <div className="users-section-heading">
        <div>
          <h2>{kind === 'members' ? 'Members' : kind === 'roles' ? 'Roles' : 'Invitations'}</h2>
          <p>
            {kind === 'members'
              ? 'People with workspace membership.'
              : kind === 'roles'
                ? 'Define what people can do. Choose coverage when assigning a role.'
                : 'Track invitations, approvals and email delivery.'}
          </p>
        </div>
        <Button
          disabled={!!selected || bulk || imports || page.loading || refreshing}
          onClick={() => setSelected('new')}
        >
          <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
          {kind === 'roles' ? 'Create role' : 'Invite member'}
        </Button>
      </div>
      {kind !== 'roles' && (
        <div className="users-secondary-actions">
          <Button
            variant="ghost"
            disabled={!!selected || bulk || imports || page.loading || refreshing}
            onClick={() => setBulk(true)}
          >
            Invite multiple members
          </Button>
          <Button
            variant="outline"
            disabled={!!selected || bulk || imports || page.loading || refreshing}
            onClick={() => setImports(true)}
          >
            Import CSV
          </Button>
        </div>
      )}
      <div
        className="users-workbench"
        data-kind={kind}
        data-editing={!!selected || bulk || imports}
      >
        <section className="access-surface" aria-label={`${kind} directory`}>
          <div className="access-toolbar">
            <Search
              value={search}
              placeholder={`Search ${kind}…`}
              onChange={(s) => {
                updateFilters({ search: s });
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
                  updateFilters({ [filterKey]: e.target.value });
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
                    {kind === 'invitations'
                      ? invitationStatus(v as InvitationDto['state'])
                      : v === 'system'
                        ? 'Built-in'
                        : v.charAt(0).toUpperCase() + v.slice(1)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {kind === 'invitations' && (
              <Field className="access-filter">
                <FieldLabel className="sr-only" htmlFor="delivery-filter">
                  Email delivery filter
                </FieldLabel>
                <NativeSelect
                  id="delivery-filter"
                  value={delivery}
                  onChange={(e) => updateFilters({ delivery: e.target.value })}
                >
                  <option value="">All email delivery</option>
                  {['queued', 'sending', 'smtp_accepted', 'failed', 'unknown', 'unavailable'].map(
                    (state) => (
                      <option key={state} value={state}>
                        {state === 'unavailable'
                          ? 'Delivery unavailable'
                          : deliveryStatus(
                              state as NonNullable<InvitationDto['delivery']>['state'],
                            )}
                      </option>
                    ),
                  )}
                </NativeSelect>
              </Field>
            )}
            <Reload loading={page.loading} onClick={page.refresh} />
            <Field className="access-filter">
              <FieldLabel className="sr-only" htmlFor="directory-sort">
                Sort {kind}
              </FieldLabel>
              <NativeSelect
                id="directory-sort"
                value={sort}
                onChange={(e) => updateFilters({ sort: e.target.value })}
              >
                {(kind === 'invitations'
                  ? [
                      ['created_desc', 'Newest invitations'],
                      ['expires_asc', 'Expiring first'],
                      ['id', 'Default order'],
                    ]
                  : kind === 'members'
                    ? [
                        ['name', 'Name A–Z'],
                        ['name_desc', 'Name Z–A'],
                        ['id', 'Default order'],
                      ]
                    : [
                        ['name', 'Name A–Z'],
                        ['name_desc', 'Name Z–A'],
                      ]
                ).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          {kind === 'invitations' && (roleId || actionable) && (
            <div className="directory-filter-disclosure flex flex-wrap items-center gap-2">
              <span>
                Showing {actionable ? 'actionable ' : ''}invitations
                {roleId ? ' using the selected role' : ''}.
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => updateFilters({ roleId: '', actionable: '' })}
              >
                Clear role invitation filter
              </Button>
            </div>
          )}
          {kind === 'members' && (
            <DirectoryFilters
              session={session}
              roleId={roleId}
              unitId={unitId}
              onChange={(role, unit) => {
                updateFilters({ roleId: role, unitId: unit });
              }}
            />
          )}
          {page.loading && !page.value && (
            <ContentLoading label={`Loading ${kind}…`} shape="list" />
          )}
          {page.refreshing && (
            <p className="picker-loading" role="status">
              Updating {kind}…
            </p>
          )}{' '}
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
                    usage={page.value.usage}
                    roles={page.value.items.filter(
                      (item): item is RoleDefinitionDto => 'permissions' in item,
                    )}
                    selectedId={selected && selected !== 'new' ? selected.id : undefined}
                    disabled={!!selected || bulk || imports || page.loading || refreshing}
                    onSelect={setSelected}
                  />
                ) : kind === 'members' ? (
                  <MemberTable
                    members={page.value.items.filter((item): item is MemberDto => 'userId' in item)}
                    currentUserId={session.user.id}
                    selectedId={selected && selected !== 'new' ? selected.id : undefined}
                    disabled={!!selected || bulk || imports || page.loading || refreshing}
                    onSelect={setSelected}
                  />
                ) : (
                  <InvitationTable
                    invitations={page.value.items.filter(
                      (item): item is InvitationDto => 'email' in item,
                    )}
                    selectedId={selected && selected !== 'new' ? selected.id : undefined}
                    disabled={!!selected || bulk || imports || page.loading || refreshing}
                    onSelect={setSelected}
                  />
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
              Select a member to see their roles and where each role applies.
            </p>
          )}
          {kind === 'roles' && (
            <p className="access-caption">
              Roles define permissions. Each person’s assignment determines company or unit
              coverage.
            </p>
          )}
        </section>
        {imports && (
          <TaskSheet label="CSV imports">
            <PeopleImports
              session={session}
              onClose={() => {
                setImports(false);
                page.refresh();
              }}
            />
          </TaskSheet>
        )}
        {bulk && (
          <TaskSheet label="Bulk invitations">
            <BulkInvitations
              session={session}
              onCheck={onCheck}
              onClose={(didSave) => {
                if (didSave) void changed();
                else setBulk(false);
              }}
            />
          </TaskSheet>
        )}
        {selected && (
          <TaskSheet
            key={selected === 'new' ? 'new' : selected.id}
            label={
              kind === 'roles'
                ? 'Role details'
                : selected === 'new'
                  ? 'Invite member'
                  : kind === 'invitations'
                    ? 'Invitation details'
                    : 'Access details'
            }
          >
            <Editor
              key={selected === 'new' ? 'new' : selected.id}
              session={session}
              kind={kind === 'members' && selected === 'new' ? 'invitations' : kind}
              value={selected}
              accessRevision={page.value?.accessRevision ?? session.access?.accessRevision ?? 0}
              onSaved={changed}
              onClose={() => setSelected(undefined)}
            />
          </TaskSheet>
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
  const [roleAction, setRoleAction] = useState(role ? 'overview' : 'details');
  const confirmDiscard = useTaskConfirm();
  const [emailError, setEmailError] = useState<string>();
  const [name, setName] = useState(role?.systemKey ? `${role.name} copy` : (role?.name ?? '')),
    [description, setDescription] = useState(role?.description ?? ''),
    [email, setEmail] = useState(invitation?.email ?? '');
  const [permissions, setPermissions] = useState<PeoplePermission[]>(
    role?.permissions ?? ['turnstile:access'],
  );
  const initial = member?.assignments ?? invitation?.assignments ?? [];
  const [assignments, setAssignments] = useState<RoleAssignmentRequestDto[]>(
    initial.length || member || invitation
      ? initial.map((a) => ({
          roleId: a.role.id,
          expectedRoleVersion: a.role.version,
          scope: a.scope,
        }))
      : [{ roleId: '', expectedRoleVersion: 1, scope: { kind: 'company' } }],
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
  const close = () => {
    if (busy) return;
    const discard = () => {
      markSaved();
      onClose();
    };
    if (dirty || command)
      confirmDiscard('Your unsaved draft will be discarded. Saved access stays in place.', discard);
    else discard();
  };
  useTaskDismiss(close);
  async function review(operation: string, extra: object = {}) {
    try {
      if (
        operation === 'invitation.issue' &&
        !invitationEmailSchema.safeParse(email.trim()).success
      ) {
        setEmailError('Enter a valid email address, for example alex@example.com.');
        document.getElementById('invitation-email')?.focus();
        return;
      }
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
          source: 'new',
          expectedAccessRevision: accessRevision,
          name,
          description: description || null,
          permissions,
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
          onClick={close}
        >
          <HugeiconsIcon icon={Cancel01Icon} />
        </Button>
        {member ? (
          <MemberIdentity member={member} currentUserId={session.user.id} />
        ) : (
          <CardTitle>
            <h2 className="break-words">
              {kind === 'roles'
                ? role
                  ? roleAction === 'overview'
                    ? role.name
                    : roleAction === 'copy'
                      ? 'Duplicate role'
                      : roleAction === 'permissions'
                        ? 'Edit permissions'
                        : roleAction === 'delete'
                          ? 'Delete role'
                          : 'Edit role details'
                  : 'Create role'
                : kind === 'members'
                  ? 'Member access'
                  : invitation
                    ? 'Invitation details'
                    : 'Invite member'}
            </h2>
          </CardTitle>
        )}
        <CardDescription>
          {member
            ? editingMember
              ? 'Edit role assignments, then review the change.'
              : 'Member access overview'
            : role
              ? roleAction === 'overview'
                ? 'Permissions and available actions for this saved role.'
                : `Working with ${role.name}. Changes require review.`
              : kind === 'roles'
                ? 'Give this role a purpose and choose what it allows.'
                : invitation
                  ? 'Saved invitation, approved access and email delivery.'
                  : 'Choose who to invite and the access they need.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="access-panel-body">
        <div className="flex flex-col gap-5">
          {!!failure && <Notice message={message(failure)} />}{' '}
          {command ? (
            <Review
              command={command}
              target={
                (roleAction === 'copy' ? name : role?.name) ??
                invitation?.email ??
                (member && 'name' in member.identity ? member.identity.name : member?.userId) ??
                (kind === 'roles' ? name : email)
              }
              session={session}
              beforeRole={role}
              beforeAssignments={member?.assignments ?? invitation?.assignments}
              onSaved={saved}
              onBusyChange={setBusy}
              actionsTarget={reviewFooter}
              onCancel={() => setCommand(undefined)}
            />
          ) : role && roleAction === 'overview' ? (
            <section className="role-overview flex flex-col gap-5">
              <div className="flex flex-wrap gap-2">
                {company(session, 'turnstile:people:manage') && (
                  <>
                    <AppLink href={`/people/members?roleId=${role.id}`}>
                      View members using this role
                    </AppLink>
                    <AppLink href={`/people/invitations?roleId=${role.id}&actionable=true`}>
                      View open invitations using this role
                    </AppLink>
                    <AppLink href={`/people/activity?subjectId=${role.id}`}>
                      View role activity
                    </AppLink>
                  </>
                )}
                <Badge variant="secondary">
                  {role.systemKey ? 'Built-in role' : 'Custom role'}
                </Badge>
                {role.systemKey === 'workspace_administrator' && (
                  <Badge variant="outline">Protected</Badge>
                )}
              </div>
              <p>{role.description || 'No description added.'}</p>
              <h3>
                {role.permissions.length}{' '}
                {role.permissions.length === 1 ? 'permission' : 'permissions'}
              </h3>
              <div className="access-permission-summary">
                {role.permissions.map((p) => (
                  <Badge key={p} variant="outline">
                    {permissionLabel(p)}
                  </Badge>
                ))}
              </div>
              <p className="panel-help">
                Coverage is chosen separately for each member assignment.
                {role.systemKey ? ' Built-in roles cannot be edited or deleted.' : ''}
              </p>
              <div className="flex flex-wrap gap-2">
                {!role.systemKey && (
                  <>
                    <Button variant="outline" onClick={() => setRoleAction('details')}>
                      Edit details
                    </Button>
                    <Button variant="outline" onClick={() => setRoleAction('permissions')}>
                      Edit permissions
                    </Button>
                  </>
                )}
                <Button
                  variant="outline"
                  onClick={() => {
                    setName(`${role.name} copy`);
                    setRoleAction('copy');
                  }}
                >
                  Duplicate role
                </Button>
                {!role.systemKey && (
                  <Button variant="destructive" onClick={() => setRoleAction('delete')}>
                    Delete role
                  </Button>
                )}
              </div>
            </section>
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
                hidden={catalog.loading && !catalog.value}
                disabled={catalog.loading || !catalog.value}
              >
                {kind === 'roles' ? (
                  <>
                    {role && (
                      <Button
                        variant="ghost"
                        className="self-start"
                        onClick={() => {
                          const reset = () => {
                            setRoleAction('overview');
                            setDirty(false);
                            setName(role.name);
                            setDescription(role.description ?? '');
                            setPermissions(role.permissions);
                          };
                          if (dirty)
                            confirmDiscard('Discard edits and return to the saved role?', reset);
                          else reset();
                        }}
                      >
                        Back to role overview
                      </Button>
                    )}
                    {roleAction === 'delete' && (
                      <Notice message="Remove or replace this role in member assignments and actionable invitations before deleting it. Retained invitation history alone does not prevent deletion." />
                    )}
                    {!role && (
                      <Field>
                        <FieldLabel htmlFor="role-starter">Start from</FieldLabel>
                        <NativeSelect
                          id="role-starter"
                          defaultValue=""
                          onChange={(e) => {
                            const starter = catalog.value?.starters.find(
                              (r) => r.id === e.target.value,
                            );
                            setPermissions(
                              starter ? [...starter.permissions] : ['turnstile:access'],
                            );
                            setDirty(true);
                          }}
                        >
                          <option value="">Blank role</option>
                          {catalog.value?.starters
                            .filter((r) =>
                              r.permissions.every((p) =>
                                catalog.value?.grantableCompanyPermissions?.includes(p),
                              ),
                            )
                            .map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                        </NativeSelect>
                        <p className="panel-help">
                          Use a starting point, then adjust permissions. Creating a role does not
                          assign members.
                        </p>
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
                    {(!role || roleAction === 'permissions' || roleAction === 'copy') && (
                      <Permissions
                        value={permissions}
                        onChange={(p) => {
                          setPermissions(p);
                          setDirty(true);
                        }}
                        allowed={catalog.value?.grantableCompanyPermissions ?? []}
                      />
                    )}
                    {role?.systemKey && roleAction !== 'copy' && (
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
                    {invitation && (
                      <dl className="invitation-dates">
                        {[
                          ['Invited', invitation.createdAt],
                          ['Expires', invitation.expiresAt],
                          [
                            'Accepted',
                            invitation.state === 'accepted' ? invitation.acceptedAt : undefined,
                          ],
                          [
                            'Cancelled',
                            invitation.state === 'cancelled' ? invitation.cancelledAt : undefined,
                          ],
                          [
                            'Needs review since',
                            invitation.state === 'needs_reapproval'
                              ? invitation.invalidatedAt
                              : undefined,
                          ],
                        ]
                          .filter(([, value]) => !!value)
                          .map(([label, value]) => (
                            <div key={label}>
                              <dt>{label}</dt>
                              <dd>
                                <time dateTime={value}>
                                  {new Date(value ?? '').toLocaleString()}
                                </time>
                              </dd>
                            </div>
                          ))}
                      </dl>
                    )}
                    {invitation && invitation.state !== 'needs_reapproval' ? (
                      <section className="invitation-saved flex flex-col gap-4">
                        <div className="access-permission-summary">
                          <Badge variant="secondary">{invitationStatus(invitation.state)}</Badge>
                          <Badge variant="outline">
                            {deliveryStatus(invitation.delivery?.state)}
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
                                setEmailError(undefined);
                                setDirty(true);
                              }}
                              aria-invalid={!!emailError}
                              aria-describedby={emailError ? 'invitation-email-error' : undefined}
                              autoComplete="email"
                            />
                            {emailError && (
                              <p id="invitation-email-error" className="field-error" role="alert">
                                {emailError}
                              </p>
                            )}
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
          {(member && !editingMember) || (role && roleAction === 'overview') ? (
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
              <Button
                variant="outline"
                className="self-start"
                onClick={member ? cancelDraft : close}
              >
                {member
                  ? 'Cancel changes'
                  : invitation && invitation.state !== 'needs_reapproval'
                    ? 'Close details'
                    : 'Cancel and discard draft'}
              </Button>
            </>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
