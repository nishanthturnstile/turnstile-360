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
import { AccessEmpty, RoleTable, StructureOutline } from '@/features/people/AccessViews';
import { MemberTable } from '@/features/people/Members';
import { Permissions } from '@/features/people/shared';
export function PeopleGallery() {
  const [selected, setSelected] = useState<string>();
  return (
    <section className="flex flex-col gap-5" aria-label="People administration examples">
      <h2 className="section-title">People and scoped access</h2>
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
