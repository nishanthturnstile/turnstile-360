import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { AccessError, requireStaff } from '../../../server/access.ts';
import { readCatalogue } from '../../../server/module-service.ts';
import { CatalogueEditor } from '../CatalogueEditor.tsx';
export const dynamic = 'force-dynamic';
export default async function Catalogue({ params }: { params: Promise<{ id: string }> }) {
  const input = await headers();
  const staff = await requireStaff(input).catch((error: unknown) => {
    if (error instanceof AccessError) redirect('/access');
    throw error;
  });
  const record = await readCatalogue(input, (await params).id).catch((error: unknown) => {
    if (error instanceof AccessError && error.status === 404) notFound();
    throw error;
  });
  return (
    <main>
      <p>
        <a href="/modules">← Module catalogues</a>
      </p>
      <h1>Catalogue classification</h1>
      <CatalogueEditor role={staff.role} record={record} />
    </main>
  );
}
