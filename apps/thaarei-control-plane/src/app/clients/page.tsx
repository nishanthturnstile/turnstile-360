import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AccessError, requireStaff } from '../../server/access.ts';
import { listClients } from '../../server/registry-service.ts';
import { PageHeader } from '../ui/Primitives.tsx';
import { Workspace } from '../ui/Workspace.tsx';
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
    <Workspace staff={context}>
      <main>
        <PageHeader
          eyebrow="CLIENT REGISTRY"
          title="Clients & installations"
          description="Register a client, prepare an installation and guide each application through setup."
        />
        <ClientRegistry initial={initial} role={context.role} />
      </main>
    </Workspace>
  );
}
