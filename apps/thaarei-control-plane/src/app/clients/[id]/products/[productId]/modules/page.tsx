import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ZodError } from 'zod';
import { AccessError, requireStaff } from '../../../../../../server/access.ts';
import {
  listAssignmentCatalogues,
  readAssignment,
} from '../../../../../../server/module-assignment-service.ts';
import { readCatalogue } from '../../../../../../server/module-service.ts';
import { PageHeader } from '../../../../../ui/Primitives.tsx';
import { Workspace } from '../../../../../ui/Workspace.tsx';
import { ModuleAssignment } from '../../../../ModuleAssignment.tsx';
export const dynamic = 'force-dynamic';
export default async function ProductModules({
  params,
}: {
  params: Promise<{ id: string; productId: string }>;
}) {
  const input = await headers();
  const staff = await requireStaff(input).catch((error: unknown) => {
    if (error instanceof AccessError) redirect('/access');
    throw error;
  });
  const { id, productId } = await params;
  const initial = await readAssignment(input, productId).catch((error: unknown) => {
    if (
      error instanceof ZodError ||
      (error instanceof AccessError && [404, 409].includes(error.status))
    )
      notFound();
    throw error;
  });
  if (initial.binding.clientId !== id) notFound();
  const catalogues = await listAssignmentCatalogues(input, {});
  const selectedId =
    (initial.draft ?? initial.desired)?.document.profile.catalogueId ??
    catalogues.catalogues[0]?.id;
  const selected = selectedId ? await readCatalogue(input, selectedId) : null;
  return (
    <Workspace staff={staff}>
      <main>
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <a href="/clients">Clients</a>
          <span>/</span>
          <a href={`/clients/${id}`}>Client & installation</a>
          <span>/</span>
          <span>Modules</span>
        </nav>
        <PageHeader
          eyebrow="APPLICATION SETUP"
          title="Turnstile modules"
          description="Choose the desired profile, prepare its package and follow the installation through activation."
        />
        <ModuleAssignment
          initial={initial}
          role={staff.role}
          initialCatalogues={catalogues}
          initialCatalogue={selected?.catalogue ?? null}
        />
      </main>
    </Workspace>
  );
}
