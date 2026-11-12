'use client';
import { catalogue } from '@thaarei/module-catalog';
import { type FormEvent, useState } from 'react';
import {
  type CatalogueCommand,
  type CatalogueList,
  type CatalogueRecord,
  catalogueCommand,
  catalogueReceipt,
} from '../../contracts/module-catalogues.ts';
import { request } from '../access/client.ts';

export function CatalogueEditor({
  role,
  list,
  record,
}: {
  role: string;
  list?: CatalogueList;
  record?: CatalogueRecord;
}) {
  const [choices, setChoices] = useState(
    record?.catalogue.modules.map(({ id, category }) => ({ id, category })) ?? [],
  );
  const [pending, setPending] = useState<CatalogueCommand | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const admin = role === 'admin';
  const candidate = record
    ? catalogue.safeParse({
        ...record.catalogue,
        modules: record.catalogue.modules.map((m) => ({
          ...m,
          category: choices.find((c) => c.id === m.id)?.category,
        })),
      })
    : null;
  const changes =
    record?.catalogue.modules.filter(
      (m) => choices.find((c) => c.id === m.id)?.category !== m.category,
    ) ?? [];
  const editable = admin && record?.status === 'draft';
  async function prepare(event: FormEvent<HTMLFormElement>, type: CatalogueCommand['type']) {
    event.preventDefault();
    setMessage('');
    const fields = new FormData(event.currentTarget);
    try {
      const base = { type, requestId: crypto.randomUUID(), reason: fields.get('reason') };
      if (type === 'code.import')
        setPending(catalogueCommand.parse({ ...base, attestation: fields.get('attestation') }));
      else if (type === 'draft.create') {
        setBusy(true);
        const sourceId = record?.sourceId ?? String(fields.get('sourceId'));
        const source =
          record?.catalogue ??
          catalogue.parse(
            await request(`/api/module-catalogues/code/${sourceId}`, undefined, 'GET'),
          );
        setPending(
          catalogueCommand.parse({
            ...base,
            id: crypto.randomUUID(),
            sourceId,
            categories: source.modules.map(({ id, category }) => ({ id, category })),
          }),
        );
      } else if (record)
        setPending(
          catalogueCommand.parse({
            ...base,
            id: record.id,
            revision: record.revision,
            ...(type === 'draft.classify'
              ? { categories: choices }
              : { attestation: fields.get('attestation') }),
          }),
        );
    } catch {
      setMessage('Check the reason, selected code catalogue and evidence.');
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setMessage('');
    try {
      const result = catalogueReceipt.parse(await request('/api/module-catalogues', pending));
      location.assign(
        pending.type === 'code.import' ? '/modules' : `/modules/${result.resourceId}`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to complete request');
    } finally {
      setBusy(false);
    }
  }
  const reason = (
    <label>
      Reason
      <input name="reason" required maxLength={300} />
    </label>
  );
  return (
    <>
      <p role="status" className={message ? 'notice' : ''}>
        {message}
      </p>
      {pending && (
        <section aria-label="Review catalogue change">
          <h2>Review and confirm</h2>
          <p>
            Action: {pending.type}. Reason: {pending.reason}
          </p>
          {'categories' in pending && (
            <ul>
              {pending.categories.map((m) => (
                <li key={m.id}>
                  {m.id}: {m.category}
                </li>
              ))}
            </ul>
          )}
          <p>
            Current Administrator MFA is required. If the response is lost, keep this tab open and
            retry this same request. You can reauthenticate in another tab.
          </p>
          <button type="button" disabled={busy} onClick={() => void confirm()}>
            Confirm / retry same request
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  'Reload current state before preparing another change? The previous command may have committed.',
                )
              )
                location.reload();
            }}
          >
            Reload current state
          </button>
        </section>
      )}
      {list && (
        <>
          <h2>Verified code catalogues</h2>
          {list.codes.length ? (
            <ul>
              {list.codes.map((c) => (
                <li key={c.id}>
                  {c.id} · {c.platform} · {c.moduleCount} modules · source{' '}
                  {c.sourceDigest.slice(0, 12)}
                </li>
              ))}
            </ul>
          ) : (
            <p>No verified code catalogue has been imported.</p>
          )}
          {list.nextCodeCursor && (
            <p>
              <a href={`/modules?codeAfter=${list.nextCodeCursor}`}>Next code catalogues →</a>
            </p>
          )}
          <h2>Classification versions</h2>
          {list.catalogues.length ? (
            <ul>
              {list.catalogues.map((c) => (
                <li key={c.id}>
                  <a href={`/modules/${c.id}`}>{c.id}</a> · {c.status} · revision {c.revision} ·{' '}
                  {c.moduleCount} modules
                </li>
              ))}
            </ul>
          ) : (
            <p>No classification versions yet.</p>
          )}
          {list.nextCursor && (
            <p>
              <a href={`/modules?after=${list.nextCursor}`}>Next classification versions →</a>
            </p>
          )}
          {admin && (
            <fieldset disabled={busy || !!pending}>
              <form onSubmit={(e) => void prepare(e, 'code.import')}>
                <h2>Import verified code catalogue</h2>
                <p>
                  Supply the signed metadata attestation from the trusted release pipeline. This
                  does not upload executable code.
                </p>
                <label>
                  Signed code attestation
                  <textarea name="attestation" required maxLength={196608} rows={5} />
                </label>
                {reason}
                <button type="submit">Review import</button>
              </form>
              {list.codes.length > 0 && (
                <form onSubmit={(e) => void prepare(e, 'draft.create')}>
                  <h2>Create classification draft</h2>
                  <label>
                    Verified code catalogue
                    <select name="sourceId">
                      {list.codes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.id} · {c.platform}
                        </option>
                      ))}
                    </select>
                  </label>
                  {reason}
                  <button type="submit">Review new draft</button>
                </form>
              )}
            </fieldset>
          )}
        </>
      )}
      {record && (
        <>
          <p>
            Version {record.id} · {record.status} · revision {record.revision}
          </p>
          <p>Source code catalogue: {record.sourceId}</p>
          <p>
            Digest: <code>{record.digest}</code>
          </p>
          <h2>Modules and dependencies</h2>
          <p>
            Required links must stay valid. Core modules cannot depend on Individual modules;
            foundation always stays Core.
          </p>
          <form onSubmit={(e) => void prepare(e, 'draft.classify')}>
            <fieldset disabled={!editable || busy || !!pending}>
              {record.catalogue.modules.map((m) => (
                <article id={`module-${m.id}`} key={m.id}>
                  <h3>
                    {m.label} · {m.version}
                  </h3>
                  <label>
                    Classification for {m.label}
                    <select
                      value={choices.find((c) => c.id === m.id)?.category}
                      disabled={m.id === 'foundation'}
                      onChange={(e) =>
                        setChoices(
                          choices.map((c) =>
                            c.id === m.id
                              ? { ...c, category: e.target.value as 'core' | 'individual' }
                              : c,
                          ),
                        )
                      }
                    >
                      <option value="core">Core</option>
                      <option value="individual">Individual</option>
                    </select>
                  </label>
                  <p>
                    Requires:{' '}
                    {m.requires.length
                      ? m.requires.map((id) => (
                          <a key={id} href={`#module-${id}`}>
                            {id}{' '}
                          </a>
                        ))
                      : 'No other module'}
                  </p>
                  <p>
                    Optional integrations:{' '}
                    {m.optionalIntegrations.length ? m.optionalIntegrations.join(', ') : 'None'}
                  </p>
                </article>
              ))}
              {editable && (
                <>
                  {candidate && !candidate.success && (
                    <p role="alert">
                      Invalid classification. Check required links: every dependency of a Core
                      module must also be Core.
                    </p>
                  )}
                  {changes.length > 0 && (
                    <p>
                      New-version impact:{' '}
                      {changes
                        .map((m) => `${m.label} → ${choices.find((c) => c.id === m.id)?.category}`)
                        .join('; ')}
                      . Installed customers keep their existing version.
                    </p>
                  )}
                  {reason}
                  <button type="submit" disabled={!candidate?.success || changes.length === 0}>
                    Review classification change
                  </button>
                </>
              )}
            </fieldset>
          </form>
          <p>
            <a
              href={`/api/module-catalogues/${record.id}?buildPlan=1`}
              download={`catalogue-${record.id}-revision-${record.revision}.json`}
            >
              Export exact release/build plan
            </a>
          </p>
          {admin && (
            <fieldset disabled={busy || !!pending}>
              {record.status === 'draft' && (
                <form onSubmit={(e) => void prepare(e, 'catalogue.publish')}>
                  <h2>Publish verified classification</h2>
                  <p>
                    The release pipeline must attest this exact catalogue digest, source and draft
                    revision. Publication makes this version immutable.
                  </p>
                  <label>
                    Signed classification attestation
                    <textarea name="attestation" required maxLength={196608} rows={5} />
                  </label>
                  {reason}
                  <button type="submit">Review publication</button>
                </form>
              )}
              <form onSubmit={(e) => void prepare(e, 'draft.create')}>
                <h2>Create another classification version</h2>
                {reason}
                <button type="submit">Review new version</button>
              </form>
            </fieldset>
          )}
        </>
      )}
    </>
  );
}
