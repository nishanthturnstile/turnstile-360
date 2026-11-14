import {
  accessInspectionSchema,
  type MemberDto,
  PEOPLE_PERMISSIONS,
  type UserSessionDto,
} from '@thaarei/turnstile-contracts';
import { useState } from 'react';
import { Notice } from '@/components/notice';
import { Badge } from '@/components/ui/badge';
import { Field, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { NativeSelect } from '@/components/ui/native-select';
import { message } from './client';
import { permissionLabel, UnitPicker, usePage } from './shared';

export function AccessInspection({
  member,
  session,
}: {
  member: MemberDto;
  session: UserSessionDto;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer">Check effective access</summary>
      {open && <Inspection member={member} session={session} />}
    </details>
  );
}
function Inspection({ member, session }: { member: MemberDto; session: UserSessionDto }) {
  const [permission, setPermission] = useState('turnstile:units:read');
  const [unit, setUnit] = useState('');
  const page = usePage(
    `/api/people/members/${member.id}/access?permission=${encodeURIComponent(permission)}${unit ? `&unitId=${encodeURIComponent(unit)}` : ''}`,
    accessInspectionSchema,
    session.access.fingerprint,
  );
  return (
    <FieldSet className="flex flex-col gap-4 mt-4 min-w-0 break-words">
      <FieldLegend>Effective workspace access</FieldLegend>
      <Field>
        <FieldLabel htmlFor="inspect-permission">Permission to check</FieldLabel>
        <NativeSelect
          id="inspect-permission"
          value={permission}
          onChange={(e) => setPermission(e.target.value)}
        >
          {PEOPLE_PERMISSIONS.map((p) => (
            <option key={p} value={p}>
              {permissionLabel(p)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel>Coverage to check</FieldLabel>
        <p className="panel-help">
          {unit ? 'Selected unit only' : 'Whole company. Select a unit to check its exact context.'}
        </p>
        <UnitPicker
          session={session}
          value={unit ? [unit] : []}
          onChange={(ids) => setUnit(ids.at(-1) ?? '')}
        />
      </Field>
      {page.loading ? (
        <p role="status">Checking access…</p>
      ) : page.failure ? (
        <Notice message={message(page.failure)} />
      ) : (
        page.value && (
          <div className="flex flex-col gap-3" aria-live="polite">
            <Badge variant={page.value.allowed ? 'secondary' : 'outline'}>
              {page.value.allowed
                ? 'Allowed by workspace access'
                : 'Not allowed by workspace access'}
            </Badge>
            <p>
              {
                {
                  granted: 'These saved sources grant this permission in the selected context.',
                  suspended: 'Membership suspension blocks every source of workspace access.',
                  no_workspace_entry: 'No active source grants workspace entry.',
                  company_only: 'This permission requires whole-company scope.',
                  no_matching_grant:
                    'No saved source grants this permission in the selected context.',
                }[page.value.reason]
              }
            </p>
            {page.value.sources.map((source) => (
              <p key={source.id}>
                {source.name} ·{' '}
                {source.scope.kind === 'company'
                  ? 'Whole company'
                  : `${source.scope.unitIds.length} selected units${source.scope.includeChildren ? ' and their children' : ''}`}
              </p>
            ))}
          </div>
        )
      )}
      <p className="panel-help">
        This checks saved workspace authorization. Identity sign-in restrictions and installation
        availability are checked separately when the person uses the application.
      </p>
    </FieldSet>
  );
}
