import { PEOPLE_PERMISSIONS, SYSTEM_ROLE_TEMPLATES } from '@thaarei/turnstile-contracts';
import { useState } from 'react';
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
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { NativeSelect } from '@/components/ui/native-select';
import { AccessEmpty, RoleTable, StructureOutline } from '@/features/people/AccessViews';
import { AuditEvent } from '@/features/people/AuditEvent';
import { ImportProgress } from '@/features/people/Imports';
import { InvitationTable } from '@/features/people/Invitations';
import { MemberTable } from '@/features/people/Members';
import { Permissions, Search } from '@/features/people/shared';
import { TaskSheet, useTaskDismiss } from '@/features/people/TaskSheet';
export function PeopleGallery() {
  const [selected, setSelected] = useState<string>();
  const [taskOpen, setTaskOpen] = useState(false);
  return (
    <section className="flex flex-col gap-5" aria-label="People administration examples">
      <h2 className="section-title">People and scoped access</h2>
      <ImportProgress
        job={{
          id: '10000000-0000-4000-8000-000000000195',
          actorId: 'example-admin',
          filename: 'team.csv',
          state: 'queued',
          version: 1,
          reason: null,
          createdAt: '2026-11-14T00:00:00Z',
          updatedAt: '2026-11-14T00:00:00Z',
          reviewExpiresAt: '2026-11-14T00:10:00Z',
          nextAttemptAt: '2026-11-14T00:00:07Z',
          assignments: [],
          counts: {
            pending: 12,
            processing: 0,
            succeeded: 30,
            failed: 2,
            skipped: 6,
            cancelled: 0,
          },
        }}
      />

      <details className="directory-filter-disclosure">
        <summary>Compact directory filters · inert layout example</summary>
        <div className="directory-assignment-filters">
          <p className="panel-help directory-filter-help">
            Role and coverage controls align on wide screens and stack at smaller widths. No API
            requests.
          </p>
          <FieldGroup className="directory-filter-role min-w-0 gap-3">
            <Field>
              <FieldLabel htmlFor="gallery-role-filter">Role</FieldLabel>
              <NativeSelect id="gallery-role-filter">
                <option>Any role</option>
                <option>Site coordinator</option>
              </NativeSelect>
            </Field>
            <Search placeholder="Search roles…" onChange={() => {}} />
          </FieldGroup>
          <FieldGroup className="directory-filter-coverage min-w-0 gap-3">
            <Field>
              <FieldLabel>Coverage includes unit</FieldLabel>
              <Search placeholder="Search units…" onChange={() => {}} />
              <p className="panel-help">No units selected.</p>
            </Field>
          </FieldGroup>
        </div>
      </details>
      <AuditEvent
        event={{
          id: '10000000-0000-4000-8000-000000000001',
          source: 'access',
          action: 'member_assignments_changed',
          occurredAt: '2026-11-14T00:00:00Z',
          actorKind: 'user',
          actorId: 'example-administrator',
          actorName: 'Example Administrator',
          subjectId: '10000000-0000-4000-8000-000000000002',
          subjectLabel: 'Alex Morgan',
          subjectKind: 'member',
          revisionBefore: 4,
          revisionAfter: 5,
          generation: null,
        }}
      />
      <Button variant="outline" className="self-start" onClick={() => setTaskOpen(true)}>
        Preview Users task sheet
      </Button>
      {taskOpen && (
        <TaskSheet label="Example role overview">
          <GalleryTask onClose={() => setTaskOpen(false)} />
        </TaskSheet>
      )}
      <div className="access-surface">
        <MemberTable
          members={[
            {
              id: 'gallery-member',
              userId: 'gallery-subject',
              version: 1,
              status: 'active',
              identity: {
                state: 'fresh',
                name: 'Alex Morgan',
                email: 'alex@example.test',
                verifiedAt: '2026-11-04T00:00:00Z',
              },
              legacySource: null,
              assignments: [
                {
                  id: 'gallery-assignment',
                  role: {
                    ...SYSTEM_ROLE_TEMPLATES[2],
                    id: 'gallery-unit-role',
                    description: null,
                    version: 1,
                    permissionVersion: 1,
                    permissions: [...SYSTEM_ROLE_TEMPLATES[2].permissions],
                  },
                  scope: { kind: 'company' },
                },
              ],
            },
          ]}
          currentUserId="gallery-subject"
          selectedId={selected}
          disabled={false}
          onSelect={(m) => setSelected(m.id)}
        />
      </div>
      <div className="access-surface">
        <InvitationTable
          invitations={[
            {
              id: 'gallery-invitation',
              email: 'jordan@example.test',
              version: 1,
              generation: 1,
              createdAt: '2026-11-01T00:00:00Z',
              expiresAt: '2026-11-08T00:00:00Z',
              state: 'expired',
              approval: null,
              assignments: [
                {
                  id: 'gallery-invitation-assignment',
                  role: {
                    ...SYSTEM_ROLE_TEMPLATES[3],
                    id: 'gallery-member-role',
                    description: null,
                    version: 1,
                    permissionVersion: 1,
                    permissions: [...SYSTEM_ROLE_TEMPLATES[3].permissions],
                  },
                  scope: { kind: 'company' },
                },
              ],
              delivery: {
                state: 'unknown',
                generation: 1,
                attempts: 1,
                at: '2026-11-14T00:00:00Z',
                reason: 'deadline',
              },
            },
          ]}
          onSelect={(i) => setSelected(i.id)}
        />
      </div>
      <Card variant="panel" className="access-panel">
        <CardHeader className="access-panel-header">
          <div className="access-panel-kicker">Role definition · Inert fixture</div>
          <CardTitle>Create role</CardTitle>
          <CardDescription>Choose what this role allows.</CardDescription>
        </CardHeader>
        <CardContent className="access-panel-body">
          <Permissions
            value={['turnstile:access']}
            allowed={[...PEOPLE_PERMISSIONS]}
            onChange={() => {}}
          />
        </CardContent>
        <CardFooter className="access-panel-footer">
          <Button disabled>Review new role</Button>
          <Button disabled variant="outline">
            Cancel
          </Button>
        </CardFooter>
      </Card>
      <div className="access-surface">
        <p className="picker-loading" role="status">
          Updating roles…
        </p>
        <RoleTable
          roles={SYSTEM_ROLE_TEMPLATES.map((r, i) => ({
            ...r,
            permissions: [...r.permissions],
            id: `gallery-role-${i}`,
            description: null,
            version: 1,
            permissionVersion: 1,
          }))}
          selectedId={selected}
          onSelect={(r) => setSelected(r.id)}
        />
      </div>
      <div className="access-surface">
        <StructureOutline
          snapshot={{
            revision: 1,
            accessRevision: 1,
            total: 2,
            nextCursor: null,
            ancestors: [
              {
                id: 'gallery-root',
                name: 'Example organization',
                type: 'organization',
                actionable: false,
              },
            ],
            units: [
              {
                id: 'gallery-site',
                name: 'North',
                type: 'site',
                parentId: 'gallery-root',
                ancestorIds: ['gallery-root'],
              },
              {
                id: 'gallery-department',
                name: 'Operations',
                type: 'department',
                parentId: 'gallery-site',
                ancestorIds: ['gallery-root', 'gallery-site'],
              },
            ],
          }}
          selectedId={selected}
          onSelect={setSelected}
        />
      </div>
      <div className="access-surface">
        <AccessEmpty title="No matching roles" description="Try another search or role type." />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Example member</CardTitle>
          <CardDescription>Active · Verified display · Inert gallery fixture</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Badge>Unit manager</Badge>
          <p>Read and manage units · Example organization / North / Operations</p>
          <p>
            Includes child units. Role names describe assignments; permissions and scope determine
            access.
          </p>
          <Notice message="Saved access changed. Keep the draft, reload current data, then review again." />
          <Notice success message="Saved. Current access has been refreshed." />
        </CardContent>
      </Card>
      <Notice message="Delivery is uncertain. Check the current command outcome before making another change." />
    </section>
  );
}

function GalleryTask({ onClose }: { onClose: () => void }) {
  useTaskDismiss(onClose);
  return (
    <Card variant="panel" className="access-panel">
      <CardHeader className="access-panel-header">
        <CardTitle>Site coordinator</CardTitle>
        <CardDescription>Inert role overview · no account or API access</CardDescription>
      </CardHeader>
      <CardContent className="access-panel-body">
        <div className="flex flex-col gap-4">
          <Badge variant="secondary">Custom role</Badge>
          <p>Coordinates people at assigned sites.</p>
          <div className="access-change-comparison">
            <div>
              <h3>Added permissions</h3>
              <p>Read units</p>
            </div>
            <div>
              <h3>Removed permissions</h3>
              <p>None</p>
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="access-panel-footer">
        <Button variant="outline" onClick={onClose}>
          Close example
        </Button>
      </CardFooter>
    </Card>
  );
}
