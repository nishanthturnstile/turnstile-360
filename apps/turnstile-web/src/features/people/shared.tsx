import { Search01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  COMPANY_ONLY_PERMISSIONS,
  eligibleRolesResponseSchema,
  PEOPLE_PERMISSIONS,
  type PeoplePermission,
  type RoleAssignmentRequestDto,
  type RoleDefinitionDto,
  scopedUnitDetailSchema,
  scopedUnitsResponseSchema,
  type UserSessionDto,
} from '@thaarei/turnstile-contracts';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Notice } from '@/components/notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { usePeopleActivity } from './activity';
import { canReadUnits, message, PeopleError, request } from './client';
import { permissionLabel } from './labels';

export { permissionLabel } from './labels';
export function Check({
  children,
  checked,
  onChange,
  disabled = false,
}: {
  children: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Field orientation="horizontal" data-disabled={disabled}>
      <FieldLabel>
        <Checkbox checked={checked} disabled={disabled} onCheckedChange={onChange} />
        {children}
      </FieldLabel>
    </Field>
  );
}
export function Permissions({
  value,
  onChange,
  allowed,
}: {
  value: PeoplePermission[];
  onChange: (p: PeoplePermission[]) => void;
  allowed: PeoplePermission[];
}) {
  const groups = [
    {
      title: 'Workspace access',
      description: 'Basic entry to the workspace.',
      permissions: ['turnstile:access'],
    },
    {
      title: 'Administration',
      description: 'Company-wide management of settings, people and roles.',
      permissions: [
        'turnstile:configuration:manage',
        'turnstile:people:manage',
        'turnstile:roles:manage',
      ],
    },
    {
      title: 'Organization structure',
      description: 'Read or manage the units covered by an assignment.',
      permissions: ['turnstile:units:read', 'turnstile:units:manage'],
    },
    {
      title: 'Document service',
      description: 'Inspect the document-service connection; this does not grant document access.',
      permissions: ['turnstile:dms:capabilities:read'],
    },
  ];
  return (
    <FieldSet className="permission-picker">
      <FieldLegend>Permissions</FieldLegend>
      <p className="panel-help">
        Choose what this role allows. Coverage is selected when assigning it to a person.
      </p>
      {groups.map((group) => (
        <FieldSet className="permission-group" key={group.title}>
          <FieldLegend>{group.title}</FieldLegend>
          <p className="panel-help">{group.description}</p>
          {PEOPLE_PERMISSIONS.filter((p) => group.permissions.includes(p)).map((p) => (
            <div className="permission-option" key={p} data-checked={value.includes(p)}>
              <Check
                checked={value.includes(p)}
                disabled={p === 'turnstile:access' || (!value.includes(p) && !allowed.includes(p))}
                onChange={(yes) => onChange(yes ? [...value, p] : value.filter((x) => x !== p))}
              >
                {permissionLabel(p)}
                {p === 'turnstile:access' ? (
                  <Badge variant="outline">Required</Badge>
                ) : COMPANY_ONLY_PERMISSIONS.includes(p) ? (
                  <Badge variant="outline">Company</Badge>
                ) : null}
              </Check>
              {!value.includes(p) && !allowed.includes(p) && (
                <p className="panel-help">Outside your current grant permissions.</p>
              )}
            </div>
          ))}
        </FieldSet>
      ))}
    </FieldSet>
  );
}

export function usePage<T>(url: string, schema: { parse(value: unknown): T }, revision: unknown) {
  const active = usePeopleActivity();
  const [value, setValue] = useState<T>();
  const [failure, setFailure] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    void revision;
    void reload;
    if (!active) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();

    setFailure(undefined);
    setLoading(true);
    void request(url, schema, { signal: controller.signal })
      .then((v) => {
        if (!controller.signal.aborted) setValue(v);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setFailure(e);
          if (e instanceof PeopleError && [401, 403].includes(e.status)) setValue(undefined);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [url, schema, revision, reload, active]);
  return {
    value,
    failure,
    loading,
    refresh: () => {
      setLoading(true);
      setReload((n) => n + 1);
    },
  };
}
export function Search({
  onChange,
  placeholder = 'Search…',
}: {
  onChange: (search: string) => void;
  placeholder?: string;
}) {
  const id = useId();
  const [value, setValue] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onChange(value);
      }}
      className="access-search"
    >
      <Field>
        <FieldLabel className="sr-only" htmlFor={id}>
          Search
        </FieldLabel>
        <InputGroup>
          <InputGroupAddon>
            <HugeiconsIcon icon={Search01Icon} />
          </InputGroupAddon>
          <InputGroupInput
            id={id}
            value={value}
            placeholder={placeholder}
            maxLength={120}
            onChange={(e) => setValue(e.target.value)}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton type="submit">Search</InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </Field>
    </form>
  );
}
export function Pager({
  total,
  next,
  previous,
  onNext,
  onPrevious,
}: {
  total: number;
  next: string | null;
  previous: boolean;
  onNext: () => void;
  onPrevious: () => void;
}) {
  return (
    <nav aria-label="Results pages" className="access-pagination">
      <span className="text-sm text-muted-foreground">
        {total} {total === 1 ? 'result' : 'results'}
      </span>
      <Button variant="outline" disabled={!previous} onClick={onPrevious}>
        Previous
      </Button>
      <Button variant="outline" disabled={!next} onClick={onNext}>
        Next
      </Button>
    </nav>
  );
}
type Eligible = ReturnType<typeof eligibleRolesResponseSchema.parse>['items'];
export function AssignmentEditor({
  value,
  onChange,
  session,
}: {
  value: RoleAssignmentRequestDto[];
  onChange: (value: RoleAssignmentRequestDto[]) => void;
  session: UserSessionDto;
}) {
  const rowIds = useRef<string[]>([]);
  while (rowIds.current.length < value.length) rowIds.current.push(crypto.randomUUID());
  const roles = usePage(
    '/api/people/eligible-roles?limit=100',
    eligibleRolesResponseSchema,
    session.access?.fingerprint,
  );
  const [extra, setExtra] = useState<Eligible>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    void session.access?.fingerprint;
    setExtra([]);
    setCursor(undefined);
  }, [session.access?.fingerprint]);
  const choices = [...(roles.value?.items ?? []), ...extra];
  async function more() {
    try {
      const result = await request(
        `/api/people/eligible-roles?limit=100&cursor=${encodeURIComponent((cursor === undefined ? roles.value?.nextCursor : cursor) ?? '')}`,
        eligibleRolesResponseSchema,
      );
      setExtra((old) => [...old, ...result.items]);
      setCursor(result.nextCursor);
    } catch (e) {
      setError(e);
    }
  }
  const update = (index: number, part: Partial<RoleAssignmentRequestDto>) =>
    onChange(value.map((a, i) => (i === index ? { ...a, ...part } : a)));
  return (
    <FieldSet>
      <FieldLegend>Access & coverage</FieldLegend>
      <p className="panel-help">
        Choose a role, then decide where it applies. Multiple assignments add access together.
      </p>
      {!!roles.failure && <Notice message={message(roles.failure)} />}{' '}
      {!!error && <Notice message={message(error)} />}
      {!!roles.failure && (
        <details className="member-choice-refresh">
          <summary>Refresh available roles</summary>
          <Button
            type="button"
            className="self-start"
            variant="outline"
            disabled={roles.loading}
            onClick={() => {
              setExtra([]);
              setCursor(undefined);
              roles.refresh();
            }}
          >
            Reload eligible roles
          </Button>
        </details>
      )}
      {!value.length && (
        <div className="assignment-empty">
          <h3>No roles selected</h3>
          <p>
            Start with the access this person needs. Nothing is granted until you review and
            confirm.
          </p>
        </div>
      )}
      {value.map((a, index) => {
        const choice = choices.find((c) => c.role.id === a.roleId);
        return (
          <FieldSet key={rowIds.current[index]} className="member-assignment-fields">
            <FieldLegend>Role {index + 1}</FieldLegend>
            <Field>
              <FieldLabel htmlFor={`assignment-role-${rowIds.current[index]}`}>Role</FieldLabel>
              <NativeSelect
                id={`assignment-role-${rowIds.current[index]}`}
                className="max-w-full"
                value={a.roleId}
                onChange={(e) => {
                  const c = choices.find((x) => x.role.id === e.target.value);
                  if (c)
                    update(index, {
                      roleId: c.role.id,
                      expectedRoleVersion: c.role.version,
                      scope: c.allowedScopes.includes('company')
                        ? { kind: 'company' }
                        : { kind: 'units', unitIds: [], includeChildren: true },
                    });
                }}
              >
                <option value={a.roleId}>
                  {choice?.role.name ??
                    (a.roleId ? 'Retained role (outside current grant choices)' : 'Choose a role…')}
                </option>
                {choices
                  .filter((c) => c.role.id !== a.roleId)
                  .map((c) => (
                    <option value={c.role.id} key={c.role.id}>
                      {c.role.name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            {choice && (
              <details className="member-permission-preview">
                <summary>
                  What this role allows · {choice.role.permissions.length}{' '}
                  {choice.role.permissions.length === 1 ? 'permission' : 'permissions'}
                </summary>
                <p className="member-meta">
                  {choice.role.permissions.map(permissionLabel).join(', ')}
                </p>
              </details>
            )}
            <Field>
              <FieldLabel htmlFor={`assignment-scope-${rowIds.current[index]}`}>Scope</FieldLabel>
              <NativeSelect
                id={`assignment-scope-${rowIds.current[index]}`}
                className="max-w-full"
                value={a.scope.kind}
                onChange={(e) =>
                  update(index, {
                    scope:
                      e.target.value === 'company'
                        ? { kind: 'company' }
                        : { kind: 'units', unitIds: [], includeChildren: true },
                  })
                }
              >
                <option
                  value="company"
                  disabled={!!choice && !choice.allowedScopes.includes('company')}
                >
                  Whole company
                </option>
                <option
                  value="units"
                  disabled={!!choice && !choice.allowedScopes.includes('units')}
                >
                  Selected sites / departments
                </option>
              </NativeSelect>
            </Field>
            {a.scope.kind === 'units' && (
              <UnitPicker
                session={session}
                value={a.scope.unitIds}
                onChange={(unitIds) =>
                  update(index, {
                    scope: {
                      kind: 'units',
                      unitIds,
                      includeChildren: a.scope.kind === 'units' && a.scope.includeChildren,
                    },
                  })
                }
              />
            )}
            {a.scope.kind === 'units' && (
              <Check
                checked={a.scope.includeChildren}
                onChange={(includeChildren) =>
                  update(index, { scope: { ...a.scope, includeChildren } as typeof a.scope })
                }
              >
                Include child units
              </Check>
            )}
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                rowIds.current.splice(index, 1);
                onChange(value.filter((_, i) => i !== index));
              }}
            >
              Remove assignment {index + 1}
            </Button>
          </FieldSet>
        );
      })}
      <Button
        type="button"
        variant="outline"
        disabled={!choices.length || value.length >= 32}
        onClick={() => {
          const c = choices[0];
          if (c)
            onChange([
              ...value,
              {
                roleId: '',
                expectedRoleVersion: 1,
                scope: c.allowedScopes.includes('company')
                  ? { kind: 'company' }
                  : { kind: 'units', unitIds: [], includeChildren: true },
              },
            ]);
        }}
      >
        Add role assignment
      </Button>
      {(cursor === undefined ? roles.value?.nextCursor : cursor) && (
        <Button type="button" variant="ghost" onClick={() => void more()}>
          More eligible roles
        </Button>
      )}
      <p className="text-sm text-muted-foreground">
        Roles add access together. Company-only roles apply across the company. Changes take effect
        only after review and confirmation.
      </p>
    </FieldSet>
  );
}
export function UnitPicker({
  session,
  value,
  onChange,
}: {
  session: UserSessionDto;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  if (!canReadUnits(session))
    return (
      <p>Unit reading permission is needed to choose units. Existing selections are retained.</p>
    );
  return <UnitChoices session={session} value={value} onChange={onChange} />;
}
function UnitChoices({
  session,
  value,
  onChange,
}: {
  session: UserSessionDto;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const page = usePage(
    `/api/structure/units?limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    scopedUnitsResponseSchema,
    session.access?.fingerprint,
  );

  return (
    <div className="flex flex-col gap-3">
      <Search
        onChange={(q) => {
          setCursor(null);
          setSearch(q);
        }}
      />
      {!!page.failure && <Notice message={message(page.failure)} />}
      <p className="text-sm">{value.length} selected</p>
      {page.value?.units.map((u) => {
        const labels = new Map(
          [...(page.value?.units ?? []), ...(page.value?.ancestors ?? [])].map((x) => [
            x.id,
            x.name,
          ]),
        );
        return (
          <Check
            key={u.id}
            checked={value.includes(u.id)}
            onChange={(yes) => onChange(yes ? [...value, u.id] : value.filter((x) => x !== u.id))}
          >
            {[...u.ancestorIds.map((id) => labels.get(id) ?? id), u.name].join(' / ')}
          </Check>
        );
      })}
      {page.value?.nextCursor && (
        <Button
          type="button"
          variant="outline"
          onClick={() => setCursor(page.value?.nextCursor ?? null)}
        >
          More units
        </Button>
      )}
      <Button variant="ghost" type="button" onClick={() => setCursor(null)}>
        First units
      </Button>
    </div>
  );
}
export function AssignmentSummary({
  assignments,
  session,
}: {
  session?: UserSessionDto | undefined;
  assignments: { role: RoleDefinitionDto; scope: RoleAssignmentRequestDto['scope'] }[];
}) {
  return (
    <ul className="flex flex-col gap-3">
      {assignments.map((a) => (
        <li key={`${a.role.id}:${JSON.stringify(a.scope)}`} className="rounded-xl border p-3">
          <strong>{a.role.name}</strong>
          <p className="text-sm">{a.role.permissions.map(permissionLabel).join(', ')}</p>
          <p className="break-words text-sm text-muted-foreground">
            {a.scope.kind === 'company'
              ? 'Whole company'
              : `${a.scope.unitIds.length} selected units · ${a.scope.includeChildren ? 'Includes child units' : 'Exact units only'}`}
          </p>
          {a.scope.kind === 'units' && <UnitPaths ids={a.scope.unitIds} session={session} />}
        </li>
      ))}
    </ul>
  );
}
export function FormFields({
  name,
  setName,
  description,
  setDescription,
}: {
  name: string;
  setName: (s: string) => void;
  description: string;
  setDescription: (s: string) => void;
}) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="role-name">Name</FieldLabel>
        <Input
          id="role-name"
          placeholder="For example, Site coordinator"
          maxLength={80}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="role-description">Description</FieldLabel>
        <Textarea
          rows={3}
          placeholder="What is this role responsible for?"
          id="role-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
    </FieldGroup>
  );
}

export function UnitPaths({
  ids,
  session,
}: {
  ids: string[];
  session: UserSessionDto | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer">Unit paths</summary>
      {open &&
        (session && canReadUnits(session) ? (
          ids.map((id) => <UnitPath key={id} id={id} session={session} />)
        ) : (
          <p>Unit names are unavailable within your current read access.</p>
        ))}
    </details>
  );
}
function UnitPath({ id, session }: { id: string; session: UserSessionDto }) {
  const page = usePage(
    `/api/structure/units/${id}`,
    scopedUnitDetailSchema,
    session.access?.fingerprint,
  );
  return (
    <p className="break-words text-sm">
      {page.value
        ? [...page.value.ancestors.map((a) => a.name), page.value.unit.name].join(' / ')
        : page.loading
          ? 'Loading unit path…'
          : 'Unit unavailable within current read access'}
    </p>
  );
}
