import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AccessError, requireStaff } from '../../server/access.ts';
import { listStaff } from '../../server/staff-service.ts';
import { PageHeader } from '../ui/Primitives.tsx';
import { Workspace } from '../ui/Workspace.tsx';
import { StaffEditor } from './StaffEditor.tsx';
export const dynamic = 'force-dynamic';
export default async function Staff() {
  const input = await headers();
  const context = await requireStaff(input).catch((error: unknown) => {
    if (error instanceof AccessError) redirect('/access');
    throw error;
  });
  if (context.role !== 'admin')
    return (
      <Workspace staff={context}>
        <main>
          <PageHeader
            title="Administrator access required"
            description="Only Administrators can manage staff access. Your current role can still browse clients, catalogues and reports."
          />
          <a className="button" href="/">
            Return to overview
          </a>
        </main>
      </Workspace>
    );
  const staff = await listStaff(input).catch((error: unknown) => {
    if (error instanceof AccessError) redirect('/access');
    throw error;
  });
  return (
    <Workspace staff={context}>
      <main>
        <PageHeader
          eyebrow="WORKSPACE SECURITY"
          title="Staff access"
          description="Admit employees and manage their central workspace roles. Customer accounts and permissions are managed independently."
        />
        <StaffEditor initial={staff} />
      </main>
    </Workspace>
  );
}
