import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { AccessError, requireStaff } from '../../../server/access.ts';
import { readCatalogue } from '../../../server/module-service.ts';
import { PageHeader } from '../../ui/Primitives.tsx';
import { Workspace } from '../../ui/Workspace.tsx';
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
    <Workspace staff={staff}>
      <main>
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <a href="/modules">Module catalogues</a>
          <span>/</span>
          <span>Classification</span>
        </nav>
        <PageHeader
          eyebrow="CATALOGUE VERSION"
          title="Catalogue classification"
          description="Review module categories and dependencies before publishing an immutable release."
        />
        <CatalogueEditor role={staff.role} record={record} />
      </main>
    </Workspace>
  );
}
