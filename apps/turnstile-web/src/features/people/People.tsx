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
import { useState } from 'react';
import { ButtonLink } from '@/components/button-link';
import { ContentLoading } from '@/components/content-loading';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { useUnsavedEntries } from '../configuration/shared';
import { PeopleActivity } from './activity';
import { company, message } from './client';
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
}: {
  session: UserSessionDto;
  path: string;
  active?: boolean;
  onCheck: (fresh?: boolean) => Promise<boolean>;
}) {
  const isRoles = path === '/people/roles',
    isUnits = path === '/structure';
  const allowed = isUnits
    ? true
    : company(session, isRoles ? 'turnstile:roles:manage' : 'turnstile:people:manage');
  return (
    <div className="flex flex-col gap-6">
      <header>
        <span className="eyebrow">WORKSPACE ACCESS</span>
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
          Manage who can work here, what they can do, and where their access applies.
        </p>
      </header>
      <nav aria-label="People sections" className="flex flex-wrap gap-2">
        {peoplePaths
          .filter(
            (p) =>
              p === '/structure' ||
              company(
                session,
                p.endsWith('roles') ? 'turnstile:roles:manage' : 'turnstile:people:manage',
              ),
          )
          .map((p) => (
            <ButtonLink
              href={p}
              key={p}
              variant={path === p ? 'secondary' : 'ghost'}
              aria-current={path === p ? 'page' : undefined}
            >
              {p.split('/').at(-1)}
            </ButtonLink>
          ))}
      </nav>
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
  const [search, setSearch] = useState(''),
    [cursors, setCursors] = useState<string[]>([]),
    [filter, setFilter] = useState('');
  const [serial, setSerial] = useState(0);
  const [saved, setSaved] = useState(false);
  const [selected, setSelected] = useState<MemberDto | InvitationDto | RoleDefinitionDto | 'new'>();
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
    `${serial}:${session.access?.accessRevision}:${session.access?.fingerprint}`,
  );

  async function changed() {
    setSaved(true);
    setSelected(undefined);
    // Refresh the cookie/access generation before any dependent owning list read.
    if (await onCheck(true)) {
      setSerial((n) => n + 1);
      setCursors([]);
    }
  }
  return (
    <>
      {saved && <Notice success message="Saved. Current access data is being refreshed." />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Search
          onChange={(s) => {
            setSearch(s);
            setCursors([]);
          }}
        />
        <Field className="max-w-xs">
          <FieldLabel htmlFor="people-filter">Filter</FieldLabel>
          <NativeSelect
            className="max-w-full"
            id="people-filter"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setCursors([]);
            }}
          >
            <option value="">All</option>
            {(kind === 'members'
              ? ['active', 'suspended']
              : kind === 'roles'
                ? ['system', 'custom']
                : ['pending', 'needs_reapproval', 'accepted', 'cancelled', 'expired']
            ).map((v) => (
              <option key={v} value={v}>
                {v.replaceAll('_', ' ')}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {kind !== 'members' && (
          <Button disabled={!!selected || page.loading} onClick={() => setSelected('new')}>
            {kind === 'roles' ? 'Create role' : 'Invite person'}
          </Button>
        )}
      </div>
      {page.loading && <ContentLoading label={`Loading ${kind}…`} />}{' '}
      <Button variant="outline" onClick={page.refresh}>
        Reload current data
      </Button>
      {!!page.failure && (
        <>
          <Notice message={message(page.failure)} />
          <Button onClick={page.refresh}>Reload current data</Button>
        </>
      )}
      {page.value && (
        <>
          <div className="flex flex-col gap-4">
            {!page.value.items.length && <p>No matching {kind}. Try another search or filter.</p>}
            {page.value.items.map((item) => (
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
                      <summary className="cursor-pointer">Assignments and grant sources</summary>
                      <AssignmentSummary assignments={item.assignments} session={session} />
                      {'legacySource' in item && item.legacySource && (
                        <p className="text-sm">
                          Imported source ({item.legacySource.retired ? 'retired' : 'retained'}):{' '}
                          {item.legacySource.permissions.map(permissionLabel).join(', ')}
                        </p>
                      )}
                    </details>
                  ) : (
                    <p className="text-sm">{item.permissions.map(permissionLabel).join(', ')}</p>
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
                    disabled={!!selected || page.loading}
                    onClick={() => setSelected(item)}
                  >
                    View and manage
                  </Button>
                </CardContent>
              </Card>
            ))}
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
      {selected && (
        <Editor
          key={selected === 'new' ? 'new' : selected.id}
          session={session}
          kind={kind}
          value={selected}
          accessRevision={page.value?.accessRevision ?? session.access?.accessRevision ?? 0}
          onSaved={changed}
          onClose={() => setSelected(undefined)}
        />
      )}
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
  const [name, setName] = useState(role?.name ?? ''),
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
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="break-words">
            {kind === 'roles'
              ? 'Role editor'
              : kind === 'members'
                ? 'Member access'
                : 'Invitation approval'}
          </h2>
        </CardTitle>
        <CardDescription>
          Changes stay in this page until you review and confirm them.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
              onCancel={() => setCommand(undefined)}
            />
          ) : (
            <>
              {catalog.loading && <ContentLoading label="Loading current grant choices…" />}
              {!!catalog.failure && <Notice message={message(catalog.failure)} />}
              <Button
                className="self-start"
                variant="outline"
                disabled={catalog.loading}
                onClick={catalog.refresh}
              >
                Reload grant choices
              </Button>
              <FieldSet disabled={catalog.loading || !catalog.value}>
                {kind === 'roles' ? (
                  <>
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
                    {!role?.systemKey && (
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
                      <p>
                        System templates are read-only. Choose a new name to copy permissions into a
                        custom role. Copies do not become protected administrators.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-3">
                      {!role ? (
                        <Button onClick={() => void review('role.create')}>Review new role</Button>
                      ) : (
                        <>
                          <Button
                            disabled={
                              !catalog.value ||
                              role.permissions.some(
                                (p) => !catalog.value?.grantableCompanyPermissions?.includes(p),
                              )
                            }
                            onClick={() => void review('role.copy')}
                          >
                            Copy saved permissions as custom role
                          </Button>
                          {!role.systemKey && (
                            <>
                              <Button onClick={() => void review('role.details')}>
                                Review details
                              </Button>
                              <Button onClick={() => void review('role.permissions')}>
                                Review permissions
                              </Button>
                              <Button
                                variant="destructive"
                                onClick={() => void review('role.delete')}
                              >
                                Review deletion
                              </Button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                    {catalog.value && (
                      <details>
                        <summary>Starter templates</summary>
                        {catalog.value.starters.map((r) => (
                          <p key={r.id}>
                            {r.name}: {r.permissions.map(permissionLabel).join(', ')}
                          </p>
                        ))}
                      </details>
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
                    <FieldSet disabled={!!invitation && invitation.state !== 'needs_reapproval'}>
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
                      {member && (
                        <p>
                          {member.userId} · {member.status} · Identity {member.identity.state}
                        </p>
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
                    <div className="flex flex-wrap gap-3">
                      {member ? (
                        <>
                          <Button onClick={() => void review('member.assignments')}>
                            Review assignments
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() =>
                              void review(
                                `member.${member.status === 'active' ? 'suspend' : 'reactivate'}`,
                              )
                            }
                          >
                            Review {member.status === 'active' ? 'suspension' : 'reactivation'}
                          </Button>
                        </>
                      ) : !invitation ? (
                        <Button onClick={() => void review('invitation.issue')}>
                          Review invitation
                        </Button>
                      ) : (
                        <>
                          {invitation.state === 'pending' && (
                            <Button onClick={() => void review('invitation.resend')}>
                              Review resend
                            </Button>
                          )}
                          {invitation.state === 'needs_reapproval' && (
                            <Button onClick={() => void review('invitation.reapprove')}>
                              Review reapproval
                            </Button>
                          )}
                          {['pending', 'needs_reapproval'].includes(invitation.state) && (
                            <Button
                              variant="outline"
                              onClick={() => void review('invitation.cancel')}
                            >
                              Review cancellation
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </FieldSet>
              <Button
                variant="outline"
                className="self-start"
                onClick={() => {
                  markSaved();
                  onClose();
                }}
              >
                Cancel and discard draft
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
