import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ZodError } from 'zod';
import { AccessError, requireStaff } from '../../../../../../server/access.ts';
import {
  listAssignmentCatalogues,
  readAssignment,
} from '../../../../../../server/module-assignment-service.ts';
import { readCatalogue } from '../../../../../../server/module-service.ts';
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
    <main>
      <p>
        <a href={`/clients/${id}`}>← Client and installation</a>
      </p>
      <h1>Turnstile modules</h1>
      <ModuleAssignment
        initial={initial}
        role={staff.role}
        initialCatalogues={catalogues}
        initialCatalogue={selected?.catalogue ?? null}
      />
    </main>
  );
}
