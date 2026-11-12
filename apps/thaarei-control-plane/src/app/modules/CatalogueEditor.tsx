'use client';
import { catalogue } from '@thaarei/module-catalog';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  type CatalogueCommand,
  type CatalogueList,
  type CatalogueRecord,
  catalogueCommand,
  catalogueReceipt,
} from '../../contracts/module-catalogues.ts';
import { request } from '../access/client.ts';
import { ActionLink } from '../ui/ActionLink.tsx';
import { Badge, NextAction, Workflow } from '../ui/Primitives.tsx';

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
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (pending) reviewHeading.current?.focus();
  }, [pending]);
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
      {!admin && (
        <p className="notice">
          Read-only catalogue access · An Administrator imports metadata, changes classification and
          publishes releases.
        </p>
      )}
      {list && (
        <>
          <NextAction
            title={
              !list.codes.length
                ? 'Import the verified module metadata'
                : !list.catalogues.length
                  ? 'Create your first classification draft'
                  : 'Review or prepare a catalogue version'
            }
            href={
              admin
                ? !list.codes.length
                  ? '#catalogue-import'
                  : '#catalogue-draft'
                : '#catalogue-versions'
            }
            label={
              admin ? (!list.codes.length ? 'Import catalogue' : 'Create draft') : 'Browse versions'
            }
          >
            {!list.codes.length
              ? 'Start with the signed attestation supplied by the release pipeline. Then classify modules and publish a verified version.'
              : 'Open an existing version below or create a draft from verified code metadata. Published versions are immutable.'}
          </NextAction>
          <section>
            <h2>Catalogue release workflow</h2>
            <Workflow
              label="Catalogue release guide"
              steps={[
                {
                  title: 'Import code metadata',
                  description:
                    'Administrator verifies a signed attestation from the release pipeline.',
                  state: list.codes.length ? 'complete' : 'current',
                  href: admin ? '#catalogue-import' : undefined,
                },
                {
                  title: 'Classify modules',
                  description:
                    'Create a draft, choose Core or Individual and check required dependencies.',
                  state: list.catalogues.length
                    ? 'complete'
                    : list.codes.length
                      ? 'current'
                      : 'waiting',
                  href: '#catalogue-versions',
                },
                {
                  title: 'Build & publish',
                  description:
                    'Export the exact plan, obtain matching signed release evidence and publish.',
                  state: list.catalogues.some((c) => c.status === 'released')
                    ? 'complete'
                    : list.catalogues.length
                      ? 'current'
                      : 'waiting',
                  href: '#catalogue-versions',
                },
              ]}
            />
          </section>
        </>
      )}
      {record && (
        <NextAction
          title={
            record.status === 'released'
              ? 'This version is published'
              : changes.length
                ? 'Save your classification changes'
                : 'Prepare the exact release evidence'
          }
          href={
            record.status === 'released'
              ? '/clients'
              : admin && changes.length === 0
                ? '#catalogue-publish'
                : '#catalogue-classification'
          }
          label={
            record.status === 'released'
              ? 'Choose a client'
              : admin && changes.length === 0
                ? 'View release steps'
                : 'Review modules'
          }
        >
          {record.status === 'released'
            ? 'This catalogue is immutable and available for a client’s desired module selection. Existing installations keep their assigned version.'
            : 'Review the categories below and save any changes. Export the exact saved build plan, obtain matching signed evidence from the release operator, then publish this version.'}
        </NextAction>
      )}
      <p role="status" className={message ? 'notice' : ''}>
        {message}
      </p>
      {pending && (
        <section className="review-panel" aria-label="Review catalogue change">
          <h2 ref={reviewHeading} tabIndex={-1}>
            Review and confirm
          </h2>
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
          <section>
            <h2>Verified code catalogues</h2>
            <p className="muted">
              Signed code metadata received from the release pipeline. These are sources for
              classification versions.
            </p>
            {list.codes.length ? (
              <ul className="evidence-list">
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
          </section>
          <section id="catalogue-versions">
            <div className="section-heading">
              <h2>Classification versions</h2>
              {admin && list.codes.length > 0 && (
                <ActionLink className="button secondary" href="#catalogue-draft">
                  Create draft
                </ActionLink>
              )}
            </div>
            {list.catalogues.length ? (
              <ul className="evidence-list">
                {list.catalogues.map((c) => (
                  <li key={c.id}>
                    <div className="split-heading">
                      <a href={`/modules/${c.id}`}>
                        Catalogue {c.id.slice(0, 8)} <span aria-hidden="true">→</span>
                      </a>
                      <Badge tone={c.status === 'released' ? 'success' : 'warning'}>
                        {c.status === 'released' ? 'Published' : 'Draft'}
                      </Badge>
                    </div>
                    <p className="muted">
                      Revision {c.revision} · {c.moduleCount} modules · <code>{c.id}</code>
                    </p>
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
          </section>
          {admin && (
            <fieldset disabled={busy || !!pending}>
              <details id="catalogue-import" open={list.codes.length === 0}>
                <summary>Import verified code catalogue</summary>
                <form onSubmit={(e) => void prepare(e, 'code.import')}>
                  <p className="eyebrow">STEP 1 · VERIFIED SOURCE</p>
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
              </details>
              {list.codes.length > 0 && (
                <details id="catalogue-draft" open={list.catalogues.length === 0}>
                  <summary>Create classification draft</summary>
                  <form onSubmit={(e) => void prepare(e, 'draft.create')}>
                    <p className="eyebrow">STEP 2 · CLASSIFICATION</p>
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
                </details>
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
          <details>
            <summary>Source identity & catalogue digest</summary>
            <p>
              Source code catalogue: <code>{record.sourceId}</code>
            </p>
            <p>
              Digest: <code>{record.digest}</code>
            </p>
          </details>
          <h2 id="catalogue-classification">Modules and dependencies</h2>
          <p>
            Required links must stay valid. Core modules cannot depend on Individual modules;
            foundation always stays Core.
          </p>
          {record.status === 'released' && (
            <p className="notice">
              Published version · Classification is read-only. Create another version to make
              changes.
            </p>
          )}
          <form onSubmit={(e) => void prepare(e, 'draft.classify')}>
            <fieldset disabled={!editable || busy || !!pending}>
              {record.catalogue.modules.map((m) => (
                <article className="module-card" id={`module-${m.id}`} key={m.id}>
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
              Export exact saved release/build plan
            </a>
          </p>
          {admin && (
            <fieldset disabled={busy || !!pending}>
              {record.status === 'draft' && (
                <form id="catalogue-publish" onSubmit={(e) => void prepare(e, 'catalogue.publish')}>
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
                  {changes.length > 0 && (
                    <p className="notice notice-warning">
                      Save your classification changes before exporting release evidence and
                      publishing. Publication always uses the saved version.
                    </p>
                  )}
                  <button type="submit" disabled={changes.length > 0 || !candidate?.success}>
                    Review publication
                  </button>
                </form>
              )}
              <details>
                <summary>Create another classification version</summary>
                <form onSubmit={(e) => void prepare(e, 'draft.create')}>
                  <p className="muted">
                    Start a new draft from the same verified code source. This version remains
                    unchanged.
                  </p>
                  {reason}
                  <button type="submit">Review new version</button>
                </form>
              </details>
            </fieldset>
          )}
        </>
      )}
    </>
  );
}
