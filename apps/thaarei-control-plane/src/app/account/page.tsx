import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AccessError, requireStaff } from '../../server/access.ts';
import { AccountActions } from '../access/AccountActions.tsx';
import { Badge, PageHeader } from '../ui/Primitives.tsx';
import { Workspace } from '../ui/Workspace.tsx';
export const dynamic = 'force-dynamic';
export default async function Account() {
  const staff = await requireStaff(await headers()).catch((error: unknown) => {
    if (error instanceof AccessError) redirect('/access');
    throw error;
  });
  return (
    <Workspace staff={staff}>
      <main>
        <PageHeader
          eyebrow="YOUR WORKSPACE"
          title="Your account"
          description="Manage your staff session and verify your identity for sensitive changes."
        />
        <section>
          <h2>Staff profile</h2>
          <dl>
            <dt>Name</dt>
            <dd>{staff.name}</dd>
            <dt>Email</dt>
            <dd>{staff.email}</dd>
            <dt>Role</dt>
            <dd>
              <Badge>{staff.role}</Badge>
            </dd>
            <dt>MFA verification</dt>
            <dd>
              <Badge tone={staff.recent ? 'success' : 'warning'}>
                {staff.recent ? 'Recently verified' : 'Verify again for sensitive changes'}
              </Badge>
            </dd>
          </dl>
        </section>
        <section>
          <h2>Session & security</h2>
          <p className="muted">
            Keep your authenticator and recovery codes available. Open verification in another tab
            to preserve any pending request in your current workspace.
          </p>
          <AccountActions />
        </section>
      </main>
    </Workspace>
  );
}
