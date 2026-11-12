'use client';
import { useState } from 'react';
import type { ClientList } from '../../contracts/registry.ts';
import { readClients } from '../clients/registry-client.ts';

export function ClientFilter({
  initial,
  selected = '',
}: {
  initial: ClientList;
  selected?: string | undefined;
}) {
  const [list, setList] = useState(initial);
  const [value, setValue] = useState(selected);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function search() {
    setBusy(true);
    try {
      setList(await readClients(new URLSearchParams({ q: query, archived: 'all' })));
      setMessage('Client options updated. Choose a client, then apply the report filters.');
    } catch {
      setMessage('Unable to search clients. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="client-filter">
      <label>
        Client
        <select name="clientId" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">All clients</option>
          {value && !list.clients.some((c) => c.id === value) && (
            <option value={value}>Selected client · {value}</option>
          )}
          {list.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.code}
              {c.archived ? ' (archived)' : ''}
            </option>
          ))}
        </select>
      </label>
      <details>
        <summary>Find another client</summary>
        <label>
          Search client name or code
          <input
            type="search"
            value={query}
            maxLength={100}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void search();
              }
            }}
          />
        </label>
        <button type="button" className="secondary" disabled={busy} onClick={() => void search()}>
          {busy ? 'Searching…' : 'Find clients'}
        </button>
        <p className="muted">
          Search narrows the client choices. Select “All clients” to remove this filter.
        </p>
        <p role="status">{message}</p>
      </details>
    </div>
  );
}
