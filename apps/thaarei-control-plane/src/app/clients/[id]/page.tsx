import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ZodError } from 'zod';
import { AccessError, requireStaff } from '../../../server/access.ts';
import { getClient } from '../../../server/registry-service.ts';
import { ClientWorkspace } from '../ClientWorkspace.tsx';
export const dynamic = 'force-dynamic';
export default async function Client({ params }: { params: Promise<{ id: string }> }) {
  const input = await headers();
  const context = await requireStaff(input).catch((error: unknown) => {
    if (error instanceof AccessError) redirect('/access');
    throw error;
  });
  const initial = await getClient(input, (await params).id).catch((error: unknown) => {
    if (error instanceof ZodError || (error instanceof AccessError && error.status === 404))
      notFound();
    throw error;
  });
  return (
    <main>
      <p>
        <a href="/clients">← Clients</a>
      </p>
      <p>
        <a href={`/reports?clientId=${(await params).id}`}>Usage and health reports →</a>
      </p>
      <ClientWorkspace initial={initial} role={context.role} />
    </main>
  );
}
