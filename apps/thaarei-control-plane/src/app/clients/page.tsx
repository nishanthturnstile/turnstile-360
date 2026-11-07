import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AccessError, requireStaff } from '../../server/access.ts';
import { listClients } from '../../server/registry-service.ts';
import { ClientRegistry } from './ClientRegistry.tsx';
export const dynamic = 'force-dynamic';
export default async function Clients() {
  const input = await headers();
  const context = await requireStaff(input).catch((error: unknown) => {
    if (error instanceof AccessError) redirect('/access');
    throw error;
  });
  const initial = await listClients(input, {});
  return (
    <main>
      <p>
        <a href="/">← Workspace</a>
      </p>
      <h1>Clients</h1>
      <p>Register customers and review their installations and deployed products.</p>
      <ClientRegistry initial={initial} role={context.role} />
    </main>
  );
}
