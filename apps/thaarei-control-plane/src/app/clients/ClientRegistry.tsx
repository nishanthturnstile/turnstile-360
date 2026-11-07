'use client';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { ZodError } from 'zod';
import type { ClientList, RegistryCommand } from '../../contracts/registry.ts';
import { clientCreate } from '../../contracts/registry.ts';
import { nullable, readClients, sendCommand } from './registry-client.ts';

export function ClientRegistry({ initial, role }: { initial: ClientList; role: string }) {
  const [list, setList] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState({ q: '', archived: 'active' });
  const [retry, setRetry] = useState<RegistryCommand | null>(null);

  const [appliedQuery, setAppliedQuery] = useState(query);
  async function load(next: boolean) {
    setBusy(true);
    setMessage('');
    try {
      const params = new URLSearchParams(next ? appliedQuery : query);
      if (next && list.nextCursor) params.set('after', list.nextCursor);
      setList(await readClients(params));
      if (!next) setAppliedQuery(query);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load clients');
    } finally {
      setBusy(false);
    }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setMessage('');
    try {
      const command = clientCreate.parse({
        type: 'client.create',
        requestId: crypto.randomUUID(),
        code: fields.get('code'),
        name: fields.get('name'),
        contactName: nullable(fields.get('contactName')),
        contactEmail: nullable(fields.get('contactEmail')),
        reason: fields.get('reason'),
      });
      setRetry(command);
      setBusy(true);
      const saved = await sendCommand(command);
      setRetry(null);
      location.assign(`/clients/${saved.clientId}`);
    } catch (error) {
      setMessage(
        error instanceof ZodError
          ? 'Check the client code and contact details.'
          : error instanceof Error
            ? error.message
            : 'Unable to create client',
      );
    } finally {
      setBusy(false);
    }
  }
  async function retryCreate() {
    if (!retry) return;
    setBusy(true);
    setMessage('');
    try {
      const saved = await sendCommand(retry);
      setRetry(null);
      location.assign(`/clients/${saved.clientId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to recover saved client');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load(false);
        }}
      >
        <label>
          Search by code or name
          <input
            value={query.q}
            maxLength={100}
            onChange={(event) => setQuery({ ...query, q: event.target.value })}
          />
        </label>
        <label>
          Show
          <select
            value={query.archived}
            onChange={(event) => setQuery({ ...query, archived: event.target.value })}
          >
            <option value="active">Active clients</option>
            <option value="archived">Archived clients</option>
            <option value="all">All clients</option>
          </select>
        </label>
        <button disabled={busy} type="submit">
          Search
        </button>
      </form>
      <p role="status" className={message ? 'notice' : ''}>
        {message}
      </p>
      {list.clients.length === 0 ? (
        <section>
          <p>No clients match this search.</p>
        </section>
      ) : (
        <ul className="registry-list">
          {list.clients.map((client) => (
            <li key={client.id}>
              <a href={`/clients/${client.id}`}>
                <strong>{client.name}</strong>
                <span>
                  {client.code}
                  {client.archived ? ' · Archived' : ''}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {list.nextCursor && (
        <button type="button" disabled={busy} onClick={() => void load(true)}>
          Next page
        </button>
      )}
      {role !== 'viewer' && (
        <section>
          <h2>Register a client</h2>
          {retry ? (
            <>
              <p>
                The previous request may already have saved. Retry it to recover the same client.
              </p>
              <button type="button" disabled={busy} onClick={() => void retryCreate()}>
                Retry saved request
              </button>
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  setRetry(null);
                }}
              >
                Edit draft
              </button>
            </>
          ) : null}
          <form onSubmit={create}>
            <label>
              Client code
              <input
                name="code"
                required
                maxLength={32}
                pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,31}"
                disabled={busy || retry !== null}
              />
            </label>
            <label>
              Client name
              <input name="name" required maxLength={160} disabled={busy || retry !== null} />
            </label>
            <label>
              Contact name (optional)
              <input name="contactName" maxLength={100} disabled={busy || retry !== null} />
            </label>
            <label>
              Contact email (optional)
              <input
                name="contactEmail"
                type="email"
                maxLength={254}
                disabled={busy || retry !== null}
              />
            </label>
            <label>
              Reason
              <input name="reason" required maxLength={300} disabled={busy || retry !== null} />
            </label>
            <button disabled={busy || retry !== null} type="submit">
              Register client
            </button>
          </form>
          <p>The code is permanent. Keep it stable when contact details change.</p>
        </section>
      )}
    </>
  );
}
