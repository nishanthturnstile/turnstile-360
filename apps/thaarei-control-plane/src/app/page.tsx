import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AccessError, requireStaff } from '../server/access.ts';
import { listClients } from '../server/registry-service.ts';
import { Icon } from './ui/Icon.tsx';
import { EmptyState, PageHeader, Workflow } from './ui/Primitives.tsx';
import { Workspace } from './ui/Workspace.tsx';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const input = await headers();
  const staff = await requireStaff(input).catch((error: unknown) => {
    if (error instanceof AccessError) redirect('/access');
    throw error;
  });
  const directory = await listClients(input, {});
  return (
    <Workspace staff={staff}>
      <main>
        <PageHeader
          eyebrow="YOUR WORKSPACE"
          title="Every installation. One clear view."
          description={`Welcome back, ${staff.name}. Register clients, guide application setup and keep track of what happens next.`}
          action={
            <a className="button" href="/clients">
              <Icon name="clients" />
              View clients
              <Icon name="arrow" />
            </a>
          }
        />
        <div className="card-grid">
          <a className="destination-card" href="/clients">
            <span className="destination-icon">
              <Icon name="server" />
            </span>
            <h2>Clients & installations</h2>
            <p>Start a new installation or continue setting up an existing client.</p>
            <span>
              Manage installations <Icon name="arrow" />
            </span>
          </a>
          <a className="destination-card" href="/modules">
            <span className="destination-icon">
              <Icon name="modules" />
            </span>
            <h2>Module catalogues</h2>
            <p>Prepare the verified module versions available for installation.</p>
            <span>
              Explore catalogues <Icon name="arrow" />
            </span>
          </a>
          <a className="destination-card" href="/reports">
            <span className="destination-icon">
              <Icon name="reports" />
            </span>
            <h2>Usage & health</h2>
            <p>Review customer-reported activity, policy and reporting freshness.</p>
            <span>
              View reports <Icon name="arrow" />
            </span>
          </a>
        </div>
        <div className="two-column">
          <section>
            <div className="split-heading">
              <div>
                <p className="eyebrow">FROM REGISTRATION TO HANDOVER</p>
                <h2>Your installation workflow</h2>
              </div>
              <span className="badge">Setup guide</span>
            </div>
            <Workflow
              label="Installation workflow guide"
              steps={[
                {
                  title: 'Register your client',
                  description: 'Create a client record with a permanent code and contact details.',
                  state: 'current',
                  href: '/clients',
                },
                {
                  title: 'Prepare an installation',
                  description:
                    'Reserve a fresh installation or register existing deployment identities.',
                  state: 'waiting',
                  href: '/clients',
                },
                {
                  title: 'Select, deliver and approve',
                  description:
                    'Choose Turnstile modules, verify a package, then pair and approve each product.',
                  state: 'waiting',
                  href: '/clients',
                },
                {
                  title: 'Activate and hand over',
                  description:
                    'Activate modules, check signed acknowledgements and complete customer setup.',
                  state: 'waiting',
                  href: '/clients',
                },
              ]}
            />
            <p className="muted">
              This is a guide. Open a client to see its actual setup state and next action.
            </p>
          </section>
          <section>
            <div className="section-heading">
              <h2>Client directory</h2>
              <a href="/clients">
                View all <Icon name="arrow" />
              </a>
            </div>
            {directory.clients.length ? (
              <ul className="registry-list">
                {directory.clients.slice(0, 5).map((c) => (
                  <li key={c.id}>
                    <a href={`/clients/${c.id}`}>
                      <div className="client-identity">
                        <span className="avatar">{c.name.slice(0, 1).toUpperCase()}</span>
                        <div>
                          <strong>{c.name}</strong>
                          <small>{c.code}</small>
                        </div>
                      </div>
                      <Icon name="arrow" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Your first client starts here">
                Open Clients & installations to register a client and start setup.
              </EmptyState>
            )}
            <p className="muted">
              Up to five active clients, ordered by client code. Open a client to review its
              installations.
            </p>
          </section>
        </div>
        <div className="notice">
          <Icon name="lock" /> <strong>Central approval is one part of setup.</strong> Customer
          infrastructure, local administrator handover and user permissions are managed separately.
        </div>
      </main>
    </Workspace>
  );
}
