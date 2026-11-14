import {
  eligibleRolesResponseSchema,
  permissionCatalogSchema,
  roleListResponseSchema,
  type UserSessionDto,
} from '@thaarei/turnstile-contracts';
import { useState } from 'react';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { NativeSelect } from '@/components/ui/native-select';
import { company, message } from './client';
import { Search, UnitPicker, usePage } from './shared';

const eligibleOptions = {
  parse: (value: unknown) => {
    const result = eligibleRolesResponseSchema.parse(value);
    return { ...result, items: result.items.map((r) => r.role) };
  },
};
export function DirectoryFilters(props: {
  session: UserSessionDto;
  roleId: string;
  unitId: string;
  onChange: (roleId: string, unitId: string) => void;
}) {
  const capabilities = usePage(
    '/api/people/catalog',
    permissionCatalogSchema,
    props.session.access.fingerprint,
  );
  const [open, setOpen] = useState(false);
  if (!capabilities.value?.memberAssignmentFilters) return null;
  return (
    <details
      className="directory-filter-disclosure"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        Filter by role or coverage{props.roleId || props.unitId ? ' · applied' : ''}
      </summary>
      {open && <AssignmentFilters {...props} />}
    </details>
  );
}

function AssignmentFilters({
  session,
  roleId,
  unitId,
  onChange,
}: {
  session: UserSessionDto;
  roleId: string;
  unitId: string;
  onChange: (roleId: string, unitId: string) => void;
}) {
  const definitions = company(session, 'turnstile:roles:manage');
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string>();
  const page = usePage(
    `/api/people/${definitions ? 'roles' : 'eligible-roles'}?limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    definitions ? roleListResponseSchema : eligibleOptions,
    session.access.fingerprint,
  );
  return (
    <div className="directory-assignment-filters">
      <p className="panel-help directory-filter-help">
        Role and coverage match the same saved assignment, including child-unit coverage. Membership
        status is filtered separately.
      </p>
      <FieldGroup className="directory-filter-role min-w-0 gap-3">
        <Field>
          <FieldLabel htmlFor="member-role-filter">Role</FieldLabel>
          <NativeSelect
            id="member-role-filter"
            aria-label={definitions ? 'Role filter' : 'Eligible role filter'}
            value={roleId}
            onChange={(e) => onChange(e.target.value, unitId)}
          >
            <option value="">Any role</option>
            {roleId && !page.value?.items.some((r) => r.id === roleId) && (
              <option value={roleId}>Selected role</option>
            )}
            {page.value?.items.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Search
          placeholder="Search roles…"
          onChange={(value) => {
            setSearch(value);
            setCursor(undefined);
          }}
        />
        {!!page.failure && <Notice message={message(page.failure)} />}
        {page.value?.nextCursor && (
          <Button variant="ghost" onClick={() => setCursor(page.value?.nextCursor ?? undefined)}>
            More roles
          </Button>
        )}
        {cursor && (
          <Button variant="ghost" onClick={() => setCursor(undefined)}>
            First roles
          </Button>
        )}
      </FieldGroup>
      <FieldGroup className="directory-filter-coverage min-w-0 gap-3">
        <Field>
          <FieldLabel>Coverage includes unit</FieldLabel>
          <UnitPicker
            session={session}
            value={unitId ? [unitId] : []}
            onChange={(ids) => onChange(roleId, ids.at(-1) ?? '')}
          />
        </Field>
      </FieldGroup>
      {(roleId || unitId) && (
        <div className="directory-filter-actions">
          <Button variant="outline" onClick={() => onChange('', '')}>
            Clear assignment filters
          </Button>
        </div>
      )}
    </div>
  );
}
