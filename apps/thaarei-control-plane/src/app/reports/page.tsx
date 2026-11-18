import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ZodError } from 'zod';
import { AccessError, requireStaff } from '../../server/access.ts';
import { listClients } from '../../server/registry-service.ts';
import { listReports } from '../../server/report-service.ts';
import { EmptyState, PageHeader } from '../ui/Primitives.tsx';
import { Workspace } from '../ui/Workspace.tsx';
import { ClientFilter } from './ClientFilter.tsx';
import { Status } from './Status.tsx';
export const dynamic = 'force-dynamic';
export default async function Reports({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const input = await headers();
  const staff = await requireStaff(input).catch((error: unknown) => {
    if (error instanceof AccessError) redirect('/access');
    throw error;
  });
  const clients = await listClients(input, { archived: 'all' });
  const query = await searchParams;
  const filter = Object.fromEntries(Object.entries(query).filter(([, v]) => v));
  const data = await listReports(input, filter).catch((error: unknown) => {
    if (error instanceof AccessError) redirect('/access');
    if (error instanceof ZodError) return null;
    throw error;
  });
  if (!data)
    return (
      <Workspace staff={staff}>
        <main>
          <h1>Usage and health</h1>
          <p className="notice">
            The report filters are invalid. Use a client UUID, a valid environment name, and a
            supported product.
          </p>
          <p>
            <a href="/reports">Clear filters</a>
          </p>
        </main>
      </Workspace>
    );
  const next = new URLSearchParams(filter as Record<string, string>);
  if (data.next) next.set('after', data.next);
  return (
    <Workspace staff={staff}>
      <main>
        <PageHeader
          eyebrow="FLEET REPORTING"
          title="Usage & health"
          description="Review what customer installations report, when they last checked in and which policies they have applied."
        />
        <p className="notice">
          Reports arrive about every 15 minutes. After 45 minutes, reporting is overdue; that does
          not prove the product is down. Missing data stays unknown. All times are UTC.
        </p>
        <form className="list-toolbar" method="get">
          <ClientFilter initial={clients} selected={query.clientId} />
          <label>
            Environment
            <input
              name="environment"
              defaultValue={query.environment}
              maxLength={32}
              pattern="[a-z0-9][a-z0-9_\-]{0,31}"
            />
          </label>
          <label>
            Product
            <select name="product" defaultValue={query.product ?? ''}>
              <option value="">All products</option>
              <option value="dms">DMS</option>
              <option value="turnstile">Turnstile</option>
            </select>
          </label>
          <button type="submit">Filter reports</button>
        </form>
        {data.items.length === 0 && (
          <EmptyState title="No matching deployments">
            Try another client, product or environment. Reporting begins after the customer product
            connects and sends a summary.
          </EmptyState>
        )}
        <div className="section-heading">
          <h2>Deployment reports</h2>
          <p>{data.items.length} on this page</p>
        </div>
        {data.items.map((item) => (
          <section key={item.id} className="report-card">
            <h2>
              <a href={`/reports/${item.id}`}>
                {item.clientName} <span className="badge">{item.environment}</span>{' '}
                <span className="badge">{item.product === 'dms' ? 'DMS' : 'Turnstile'}</span>
              </a>
            </h2>
            <Status item={item} />
          </section>
        ))}
        {data.next && (
          <p>
            <a href={`/reports?${next}`}>Next deployments →</a>
          </p>
        )}
      </main>
    </Workspace>
  );
}
