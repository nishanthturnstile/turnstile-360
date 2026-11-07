import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ZodError } from 'zod';
import { AccessError } from '../../server/access.ts';
import { listReports } from '../../server/report-service.ts';
import { Status } from './Status.tsx';
export const dynamic = 'force-dynamic';
export default async function Reports({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const query = await searchParams;
  const filter = Object.fromEntries(Object.entries(query).filter(([, v]) => v));
  const data = await listReports(await headers(), filter).catch((error: unknown) => {
    if (error instanceof AccessError) redirect('/access');
    if (error instanceof ZodError) return null;
    throw error;
  });
  if (!data)
    return (
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
    );
  const next = new URLSearchParams(filter as Record<string, string>);
  if (data.next) next.set('after', data.next);
  return (
    <main>
      <p>
        <a href="/">← Workspace</a>
      </p>
      <h1>Usage and health</h1>
      <p>
        Snapshots arrive about every 15 minutes. Reports older than 45 minutes are overdue. Counts
        are customer-reported aggregates; missing data is unknown. All times are UTC.
      </p>
      <form method="get">
        <label>
          Client ID
          <input
            name="clientId"
            defaultValue={query.clientId}
            maxLength={36}
            pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
          />
        </label>
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
      {data.items.length === 0 && <p>No matching deployments.</p>}
      {data.items.map((item) => (
        <section key={item.id}>
          <h2>
            <a href={`/reports/${item.id}`}>
              {item.clientName} · {item.environment} · {item.product}
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
  );
}
