import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AccessError, requireStaff } from '../server/access.ts';
import { AccountActions } from './access/AccountActions.tsx';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const staff = await requireStaff(await headers()).catch((error: unknown) => {
    if (error instanceof AccessError) redirect('/access');
    throw error;
  });
  return (
    <main>
      <p className="eyebrow">PRIVATE WORKSPACE</p>
      <h1>Welcome, {staff.name}</h1>
      <p>
        Signed in as {staff.email} · {staff.role}
      </p>
      <section>
        <h2>Your account</h2>
        <p>Your staff access is active. Keep your authenticator and recovery codes available.</p>
      </section>
      <p>
        <a href="/clients">Clients and deployments →</a>
      </p>
      <p>
        <a href="/reports">Usage and health →</a>
      </p>
      {staff.role === 'admin' && (
        <p>
          <a href="/staff">Manage staff →</a>
        </p>
      )}
      <AccountActions />
    </main>
  );
}
