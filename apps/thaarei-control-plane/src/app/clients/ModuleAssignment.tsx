'use client';
import {
  type Catalogue,
  catalogueDigest,
  removalClosure,
  resolveSelection,
} from '@thaarei/module-catalog';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  type AssignmentCatalogueList,
  type AssignmentMutation,
  type AssignmentView,
  assignmentCatalogueList,
  assignmentMutation,
  assignmentView,
} from '../../contracts/module-assignments.ts';
import { catalogueReceipt, catalogueRecord } from '../../contracts/module-catalogues.ts';
import { enforcementCommand, moduleActivationCommand } from '../../contracts/module-transitions.ts';
import { request } from '../access/client.ts';
import { ModuleDependencyGraph } from './ModuleDependencyGraph.tsx';

const titles = {
  unassigned: 'No approved module assignment',
  'awaiting-package': 'Awaiting package',
  'ready-for-setup': 'Ready for setup',
  'awaiting-activation': 'Awaiting activation',
  'awaiting-acknowledgement': 'Awaiting signed application acknowledgement',
  active: 'Active',
  restricted: 'Restricted',
  'upgrade-required': 'Upgrade required',
  'inventory-mismatch': 'Inventory mismatch',
};
export function ModuleAssignment({
  initial,
  role,
  initialCatalogues,
  initialCatalogue,
}: {
  initial: AssignmentView;
  role: string;
  initialCatalogues: AssignmentCatalogueList;
  initialCatalogue: Catalogue | null;
}) {
  const [view, setView] = useState(initial);
  const [list, setList] = useState(initialCatalogues);
  const [source, setSource] = useState(initialCatalogue);
  const [requested, setRequested] = useState(
    (initial.draft ?? initial.desired)?.document.command.requestedIndividualIds ?? [],
  );
  const [pending, setPending] = useState<AssignmentMutation | null>(null);
  const [activation, setActivation] = useState<ReturnType<
    typeof moduleActivationCommand.parse
  > | null>(null);
  const [enforcement, setEnforcement] = useState<ReturnType<
    typeof enforcementCommand.parse
  > | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [intentOperation, setIntentOperation] = useState<{
    operationId: string;
    expectedRevision: number;
    reason: string;
  } | null>(null);
  const [intentFile, setIntentFile] = useState<{ intent: string } | null>(null);
  const [message, setMessage] = useState('');
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (pending) reviewHeading.current?.focus();
  }, [pending]);
  const canWrite = ['admin', 'operator'].includes(role) && !view.archived;
  const locked = busy || pending !== null;
  const resolution = source
    ? resolveSelection(source, { requestedIndividualIds: requested })
    : null;
  const sameDraft =
    !!view.draft &&
    source?.id === view.draft.document.profile.catalogueId &&
    JSON.stringify([...requested].sort()) ===
      JSON.stringify([...view.draft.document.command.requestedIndividualIds].sort()) &&
    view.draft.revision === view.productRevision;
  const explicitRemovals =
    view.authority && view.activeCatalogue
      ? view.authority.allowedIds.filter(
          (id) =>
            view.activeCatalogue?.modules.find((m) => m.id === id)?.category === 'individual' &&
            !resolution?.resolvedIds.includes(id),
        )
      : [];
  const removalIds =
    view.authority && view.activeCatalogue
      ? removalClosure(view.activeCatalogue, view.authority.allowedIds, explicitRemovals)
      : [];
  const removedDesired =
    view.desired?.document.profile.modules
      .filter((m) => !resolution?.resolvedIds.includes(m.id))
      .map((m) => m.id) ?? [];
  async function issueIntent() {
    if (!intentOperation) return;
    setBusy(true);
    try {
      const result = await request(
        `/api/registry/products/${view.binding.productId}/modules/installation-intent`,
        intentOperation,
      );
      if (
        !result ||
        typeof result !== 'object' ||
        !('intent' in result) ||
        typeof result.intent !== 'string'
      )
        throw new Error();
      const file = { intent: result.intent };
      setIntentFile(file);
      downloadIntent(file);
      setMessage(
        'Intent issued. Private preparation, independent pairing and approval remain required.',
      );
    } catch {
      setMessage(
        'Issuance did not complete. Retry this exact operation to recover its result, or reload current state before preparing a new operation.',
      );
    } finally {
      setBusy(false);
    }
  }
  function downloadIntent(file: { intent: string }) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'installation-intent.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function choose(id: string) {
    setBusy(true);
    setMessage('');
    try {
      const record = catalogueRecord.parse(
        await request(`/api/module-catalogues/${id}`, undefined, 'GET'),
      );
      if (record.status !== 'released') throw new Error('Choose a published catalogue');
      setSource(record.catalogue);
      const saved = [view.draft, view.desired].find(
        (entry) => entry?.document.profile.catalogueId === id,
      );
      setRequested(saved?.document.command.requestedIndividualIds ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load catalogue');
    } finally {
      setBusy(false);
    }
  }
  async function more() {
    if (!list.nextCursor) return;
    setBusy(true);
    setMessage('');
    try {
      const next = assignmentCatalogueList.parse(
        await request(
          `/api/module-catalogues/assignable?after=${list.nextCursor}`,
          undefined,
          'GET',
        ),
      );
      setList({
        catalogues: [
          ...list.catalogues,
          ...next.catalogues.filter((c) => !list.catalogues.some((old) => old.id === c.id)),
        ],
        nextCursor: next.nextCursor,
      });
    } catch {
      setMessage('Unable to load more catalogues');
    } finally {
      setBusy(false);
    }
  }
  async function prepare(event: FormEvent<HTMLFormElement>, type: AssignmentMutation['type']) {
    event.preventDefault();
    if (!source || !resolution) return;
    const reason = new FormData(event.currentTarget).get('reason');
    setBusy(true);
    setMessage('');
    try {
      setPending(
        assignmentMutation.parse({
          type,
          command: {
            version: 1,
            operationId: crypto.randomUUID(),
            expectedRevision: view.productRevision,
            binding: view.binding,
            catalogueDigest: await catalogueDigest(source),
            requestedIndividualIds: resolution.requestedIndividualIds,
            confirmedResolvedIds: resolution.resolvedIds,
            explicitlyRemovedIds: explicitRemovals,
            confirmedRemovalClosureIds: removalIds,
            activeBasis: view.authority?.active ?? null,
            reason,
          },
        }),
      );
      setAttempted(false);
      setConfirmed(false);
    } catch {
      setMessage('Check the catalogue, selection and reason');
    } finally {
      setBusy(false);
    }
  }
  async function readback() {
    const current = assignmentView.parse(
      await request(`/api/registry/products/${view.binding.productId}/modules`, undefined, 'GET'),
    );
    const saved = current.draft ?? current.desired;
    if (saved) {
      const record = catalogueRecord.parse(
        await request(
          `/api/module-catalogues/${saved.document.profile.catalogueId}`,
          undefined,
          'GET',
        ),
      );
      setSource(record.catalogue);
      setRequested(saved.document.command.requestedIndividualIds);
    }
    setView(current);
    setActivation(null);
    setPending(null);
    setAttempted(false);
    setConfirmed(false);
  }
  async function confirm() {
    if (!pending || !confirmed) return;
    setBusy(true);
    setAttempted(true);
    setMessage('');
    try {
      catalogueReceipt.parse(
        await request(`/api/registry/products/${view.binding.productId}/modules`, pending),
      );
      await readback();
      setMessage(
        'Saved. The current assignment is shown below. Customer activation remains separate.',
      );
    } catch (error) {
      setMessage(
        `${error instanceof Error ? error.message : 'Unable to complete request'}. Retry the same request, or reload current state before another change.`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    if (
      pending &&
      attempted &&
      !window.confirm(
        'The last request may have committed. Discard this pending request and load current state?',
      )
    )
      return;
    setBusy(true);
    setMessage('');
    try {
      await readback();
    } catch {
      setMessage('Unable to reload. Keep this tab open and retry.');
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
      <p>
        Installation <code>{view.binding.localInstallationId}</code> · Product{' '}
        <code>{view.binding.productId}</code>
      </p>
      <p>
        Product policy: {view.policyState} · Revision {view.productRevision}
      </p>
      <p>
        Module selection grants no customer role or action permission. Package delivery and signed
        customer activation are separate steps.
      </p>
      <p role="status" className={message ? 'notice' : ''}>
        {message}
      </p>
      <button type="button" className="secondary" disabled={busy} onClick={() => void reload()}>
        Reload current assignment
      </button>
      <section aria-label="Module assignment status">
        <h2>Assignment and delivery</h2>
        <ul>
          {view.statuses.map((status) => (
            <li key={status}>{titles[status]}</li>
          ))}
        </ul>
        <dl>
          <dt>Draft</dt>
          <dd>
            {view.draft
              ? `Saved revision ${view.draft.revision}${view.draft.revision !== view.productRevision ? ' · Review again after the product changed' : ''}`
              : 'None'}
          </dd>
          <dt>Approved desired assignment</dt>
          <dd>
            {view.desired ? (
              <>
                Revision {view.desired.revision} ·{' '}
                {view.desired.document.profile.modules.map((m) => m.id).join(', ')}
                <br />
                Profile <code>{view.desired.document.profileDigest}</code>
              </>
            ) : (
              'None'
            )}
          </dd>
          <dt>Verified delivery</dt>
          <dd>
            {view.delivery ? (
              <>
                Local bundle reference <code>{view.delivery.key}</code>
                <br />
                Release <code>{view.delivery.inventory.releaseId}</code>
              </>
            ) : (
              'No matching verified package available.'
            )}
          </dd>
          <dt>Observed installation</dt>
          <dd>
            {view.inventory ? (
              <>
                Reported profile <code>{view.inventory.installed.profileDigest}</code> ·{' '}
                {view.inventory.observedAt}. This is an installation claim.
              </>
            ) : (
              'No current module-aware inventory received.'
            )}
          </dd>
          <dt>Central module authority</dt>
          <dd>
            {view.authority ? (
              <>
                Central allowed IDs: {view.authority.allowedIds.join(', ')}. Local signed
                application and user permissions still apply.
              </>
            ) : (
              'No active module authority. Product approval remains separate.'
            )}
          </dd>
          <dt>Last acknowledged module grant</dt>
          <dd>
            {view.effective ? (
              <>
                Profile <code>{view.effective.profileDigest}</code>; allowed IDs:{' '}
                {view.effective.allowedIds.join(', ')}. Applied {view.effective.appliedAt}; expires{' '}
                {view.effective.expiresAt}. This is product-reported application evidence. Current
                local trust, enablement and user permissions still apply.
              </>
            ) : (
              'No valid acknowledgement for the current policy and pairing epoch.'
            )}
          </dd>
        </dl>
        <section aria-label="Installation handover">
          <h3>Installation handover</h3>
          {!view.handover.authorityReady && (
            <p role="status">Central recovery reconciliation is required.</p>
          )}
          <ul>
            {view.handover.products.map((p) => (
              <li key={p.productId}>
                {p.product === 'dms' ? 'DMS' : 'Turnstile'}:{' '}
                {p.paired ? 'Paired' : 'Awaiting pairing'}; policy {p.policyState};{' '}
                {p.acknowledged
                  ? 'Current approval acknowledged'
                  : 'Awaiting current approval acknowledgement'}
                ; report {p.reportFreshness}
                {p.reportReceivedAt ? ` (${p.reportReceivedAt})` : ''}.
              </li>
            ))}
          </ul>
          <p>
            Staff must approve each product independently. Reports describe installation claims;
            they do not prove customer user access. The customer operator completes private setup
            and handover using the verified installation bundle.
          </p>
          <ol>
            <li>Confirm the published catalogue, approved selection and verified package.</li>
            <li>
              Deliver the signed fresh installation intent and independently provisioned public
              trust to the customer operator.
            </li>
            <li>
              Deliver each protected pairing file separately. Approve DMS and Turnstile with current
              MFA.
            </li>
            <li>
              Require v2 enforcement, review the reported exact installed inventory, then activate
              the selected module profile.
            </li>
            <li>
              Wait for both products to acknowledge current decisions and report independently.
            </li>
            <li>
              The customer verifies email, provisions purpose-separated clients, completes private
              administrator handover and grants module permissions explicitly.
            </li>
          </ol>
          <p>
            A changed assignment or incompatible package requires reconciliation or a reviewed
            upgrade. Never reset local identities to bypass it. Central staff do not receive
            customer database or Docker credentials.
          </p>
        </section>
        {role === 'admin' && !view.archived && view.minimumDecisionVersion === 1 && (
          <details>
            <summary>Require signed module decisions</summary>
            <p>
              This permanently requires module-aware v2 decisions. It grants no module access and
              prevents legacy protocol fallback.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setEnforcement(
                  enforcementCommand.parse({
                    operationId: crypto.randomUUID(),
                    expectedRevision: view.productRevision,
                    reason: f.get('reason'),
                  }),
                );
              }}
            >
              <fieldset disabled={busy || enforcement !== null}>
                <label>
                  Reason
                  <input name="reason" required maxLength={300} />
                </label>
                <button type="submit">Review module enforcement</button>
              </fieldset>
            </form>
            {enforcement && (
              <section aria-label="Confirm module enforcement">
                <p>{enforcement.reason}</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await request(
                        `/api/registry/products/${view.binding.productId}/modules/enforce`,
                        enforcement,
                      );
                      setEnforcement(null);
                      await readback();
                      setMessage(
                        'Module-aware v2 enforcement is required. Pairing, approval and activation remain separate.',
                      );
                    } catch {
                      setMessage(
                        'Unable to confirm enforcement. Reauthenticate if required, then retry this exact operation.',
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Confirm permanent module enforcement
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setEnforcement(null)}
                >
                  Close enforcement review
                </button>
              </section>
            )}
          </details>
        )}
        {canWrite && view.desired && view.inventory && view.delivery && (
          <details>
            <summary>Activate installed modules</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setActivation(
                  moduleActivationCommand.parse({
                    operationId: crypto.randomUUID(),
                    expectedRevision: view.productRevision,
                    desiredRevision: view.desired?.revision,
                    epoch: view.inventory?.epoch,
                    installed: view.inventory?.installed,
                    activeBasis: view.authority?.active ?? null,
                    reason: new FormData(event.currentTarget).get('reason'),
                  }),
                );
              }}
            >
              <fieldset disabled={busy || activation !== null}>
                {reason}
                <button type="submit">Review module activation</button>
              </fieldset>
            </form>
            {activation && (
              <section aria-label="Review module activation">
                <p>
                  Activate the approved desired profile for the currently reported installation. The
                  server verifies the package, current assignment, pairing and MFA again. Customer
                  permissions remain separate.
                </p>
                <p>Reason: {activation.reason}</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void request(
                      `/api/registry/products/${view.binding.productId}/modules/activate`,
                      activation,
                    )
                      .then(() => readback())
                      .then(() =>
                        setMessage(
                          'Activation approved. Sync the customer installation to apply the signed decision.',
                        ),
                      )
                      .catch(() =>
                        setMessage(
                          'Activation did not complete. Retry the same operation to recover its receipt, or reload and review current state.',
                        ),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  Confirm module activation
                </button>
                <button type="button" disabled={busy} onClick={() => setActivation(null)}>
                  Close activation review
                </button>
              </section>
            )}
          </details>
        )}
        {view.desired && (
          <p>
            <a href={`/api/registry/products/${view.binding.productId}/modules/build-request`}>
              Download approved profile build request
            </a>
          </p>
        )}
        {canWrite && view.desired && view.delivery && (
          <details>
            <summary>Prepare installation intent</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
                if (reason) {
                  setIntentOperation({
                    operationId: crypto.randomUUID(),
                    expectedRevision: view.productRevision,
                    reason,
                  });
                  setIntentFile(null);
                }
              }}
            >
              <fieldset disabled={busy || intentOperation !== null}>
                <label>
                  Reason
                  <input name="reason" required maxLength={300} />
                </label>
                <button type="submit">Review installation intent</button>
              </fieldset>
            </form>
            {intentOperation && (
              <section aria-label="Review installation intent">
                <p>
                  Issue public setup metadata for the current approved profile. It contains no
                  pairing credential and grants no access.
                </p>
                <button
                  type="button"
                  disabled={busy || intentFile !== null}
                  onClick={() => void issueIntent()}
                >
                  Confirm and download intent
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setIntentOperation(null);
                    setIntentFile(null);
                  }}
                >
                  Close intent review
                </button>
              </section>
            )}
            {intentFile && (
              <button type="button" onClick={() => downloadIntent(intentFile)}>
                Download issued intent again
              </button>
            )}
          </details>
        )}
        {view.legacy && (
          <p>
            This product uses the legacy activation protocol. A reviewed module-aware upgrade is
            required before selected modules can activate.
          </p>
        )}
        {view.archived && <p>This client is archived. Assignments are read-only.</p>}
      </section>
      {pending && (
        <section aria-label="Review module assignment">
          <h2 ref={reviewHeading} tabIndex={-1}>
            {pending.type === 'assignment.approve'
              ? 'Approve desired assignment'
              : 'Review draft selection'}
          </h2>
          <p>Reason: {pending.command.reason}</p>
          <p>
            Catalogue <code>{pending.command.catalogueDigest}</code> · Product revision{' '}
            {pending.command.expectedRevision}
          </p>
          {pending.command.confirmedRemovalClosureIds.length > 0 && (
            <p>
              On approval, immediately restrict these currently active modules and dependants:{' '}
              {pending.command.confirmedRemovalClosureIds.join(', ')}. Additions await verified
              delivery and activation; existing data and user grants are retained.
            </p>
          )}
          <p>Complete resolved set:</p>
          <ul>
            {pending.command.confirmedResolvedIds.map((id) => (
              <li key={id}>
                {source?.modules.find((m) => m.id === id)?.label ?? id} ({id})
              </li>
            ))}
          </ul>
          {resolution && resolution.additionalRequiredIds.length > 0 && (
            <p>
              Additional required modules: {resolution.additionalRequiredIds.join(', ')}. These
              requirements must be explicitly confirmed.
            </p>
          )}
          {removedDesired.length > 0 && (
            <p>
              Removed from the desired package: {removedDesired.join(', ')}. This is a desired-state
              change; no active module authority has been reported.
            </p>
          )}
          <label className="module-check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I confirm the complete resolved module set, including required dependencies.
          </label>
          <button type="button" disabled={busy || !confirmed} onClick={() => void confirm()}>
            Confirm / retry same assignment
          </button>
          {!attempted && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Back to selection
            </button>
          )}
          <p>
            <a href="/access" target="_blank" rel="noreferrer">
              Verify MFA in another tab
            </a>
            , then return here to retry the same request.
          </p>
        </section>
      )}
      <section aria-label="Module selection">
        <h2>Choose a published catalogue</h2>
        {!list.catalogues.length && !source ? (
          <p>
            No published catalogue is available. An Administrator must publish verified module
            metadata first.
          </p>
        ) : (
          <>
            <label>
              Catalogue version
              <select
                disabled={!canWrite || locked}
                value={source?.id ?? ''}
                onChange={(e) => void choose(e.target.value)}
              >
                {source && !list.catalogues.some((c) => c.id === source.id) && (
                  <option value={source.id}>{source.id} · Saved assignment version</option>
                )}
                {list.catalogues.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} · {c.platform} · {c.moduleCount} modules
                  </option>
                ))}
              </select>
            </label>
            {list.nextCursor && (
              <button
                type="button"
                className="secondary"
                disabled={locked}
                onClick={() => void more()}
              >
                Load more published catalogues
              </button>
            )}
          </>
        )}
        {source && resolution && (
          <>
            <p>
              <a href={`/modules/${source.id}`}>View immutable catalogue and classification →</a>
            </p>
            <ModuleDependencyGraph
              catalogue={source}
              requested={requested}
              resolved={resolution.resolvedIds}
            />
            <fieldset disabled={!canWrite || locked}>
              <legend>Core and Individual modules</legend>
              {source.modules.map((m) => (
                <article id={`selection-${m.id}`} key={m.id}>
                  <label className="module-check">
                    <input
                      type="checkbox"
                      checked={m.category === 'core' || requested.includes(m.id)}
                      disabled={m.category === 'core'}
                      onChange={(e) =>
                        setRequested(
                          e.target.checked
                            ? [...requested, m.id]
                            : requested.filter((id) => id !== m.id),
                        )
                      }
                    />
                    {m.label} · {m.category === 'core' ? 'Core (required)' : 'Individual'}
                  </label>
                  <p>
                    Requires:{' '}
                    {m.requires.length
                      ? m.requires.map((id) => (
                          <a key={id} href={`#selection-${id}`}>
                            {source.modules.find((m) => m.id === id)?.label ?? id}{' '}
                          </a>
                        ))
                      : 'None'}
                    . Optional integrations:{' '}
                    {m.optionalIntegrations.length ? m.optionalIntegrations.join(', ') : 'None'}.
                  </p>
                  {resolution.additionalRequiredIds.includes(m.id) && (
                    <p className="notice">
                      Required by your selection. Included in the proposed set; confirmation is
                      required.
                    </p>
                  )}
                  {requested.includes(m.id) &&
                    m.requires.some((id) => resolution.additionalRequiredIds.includes(id)) && (
                      <p>Additional requirements must be reviewed before saving.</p>
                    )}
                  {!resolution.resolvedIds.includes(m.id) && (
                    <p>Not included in the proposed package.</p>
                  )}
                </article>
              ))}
            </fieldset>
            <p aria-live="polite">
              Proposed package: {resolution.resolvedIds.join(', ')}
              {resolution.additionalRequiredIds.length
                ? `. Additional requirements: ${resolution.additionalRequiredIds.join(', ')}`
                : '. No additional Individual dependencies.'}
            </p>
            {removedDesired.length > 0 && (
              <p>
                Previous desired modules removed by this selection: {removedDesired.join(', ')}.
              </p>
            )}
            {canWrite && (
              <>
                <form onSubmit={(e) => void prepare(e, 'assignment.draft')}>
                  <fieldset disabled={locked}>
                    {reason}
                    <button type="submit">Review and save draft</button>
                  </fieldset>
                </form>
                <form onSubmit={(e) => void prepare(e, 'assignment.approve')}>
                  <fieldset disabled={locked || !sameDraft}>
                    <p>
                      Approve the saved draft as the desired assignment. This does not approve
                      customer activation.
                    </p>
                    {reason}
                    <button type="submit">Review desired approval</button>
                  </fieldset>
                </form>
              </>
            )}
          </>
        )}
      </section>
    </>
  );
}
