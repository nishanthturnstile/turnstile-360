import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AccessError } from '../../server/access.ts';
import { listStaff } from '../../server/staff-service.ts';
import { StaffEditor } from './StaffEditor.tsx';
export const dynamic = 'force-dynamic';
export default async function Staff() {
  const staff = await listStaff(await headers()).catch((error: unknown) => {
    if (error instanceof AccessError) redirect('/access');
    throw error;
  });
  return (
    <main>
      <p>
        <a href="/">← Workspace</a>
      </p>
      <h1>Staff</h1>
      <p>
        Employees can see the client fleet according to their fixed role. Access changes take effect
        for existing sessions.
      </p>
      <StaffEditor initial={staff} />
    </main>
  );
}
