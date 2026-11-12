import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AccessError, requireStaff } from '../../server/access.ts';
import { listCatalogues } from '../../server/module-service.ts';
import { PageHeader } from '../ui/Primitives.tsx';
import { Workspace } from '../ui/Workspace.tsx';
import { CatalogueEditor } from './CatalogueEditor.tsx';
export const dynamic = 'force-dynamic';
export default async function Modules({
  searchParams,
}: {
  searchParams: Promise<{ after?: string; codeAfter?: string }>;
}) {
  const input = await headers();
  const staff = await requireStaff(input).catch((error: unknown) => {
    if (error instanceof AccessError) redirect('/access');
    throw error;
  });
  const list = await listCatalogues(input, await searchParams);
  return (
    <Workspace staff={staff}>
      <main>
        <PageHeader
          eyebrow="RELEASE LIBRARY"
          title="Module catalogues"
          description="Prepare verified module versions. Publishing a catalogue makes it available for selection; it does not change customer installations."
        />
        <CatalogueEditor role={staff.role} list={list} />
      </main>
    </Workspace>
  );
}
