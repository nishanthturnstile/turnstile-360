import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AccessError, requireStaff } from '../../server/access.ts';
import { listCatalogues } from '../../server/module-service.ts';
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
    <main>
      <p>
        <a href="/">← Workspace</a>
      </p>
      <h1>Module catalogues</h1>
      <p>
        Review code-supported modules and prepare a new Core/Individual classification. Released
        versions never change existing installations.
      </p>
      <CatalogueEditor role={staff.role} list={list} />
    </main>
  );
}
