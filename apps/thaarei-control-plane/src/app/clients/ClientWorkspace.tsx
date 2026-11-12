'use client';
import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { ClientDetail, RegistryCommand } from '../../contracts/registry.ts';
import { registryCommand } from '../../contracts/registry.ts';
import { PairingControls } from './PairingControls.tsx';
import { date, nullable, readClient, sendCommand } from './registry-client.ts';

const titles: Record<RegistryCommand['type'], string> = {
  'client.create': 'Register client',
  'client.update': 'Update client',
  'installation.reserve': 'Reserve fresh installation',
  'installation.create': 'Register installation',
  'product.create': 'Register product',
  'product.policy': 'Change product policy',
};
export function ClientWorkspace({ initial, role }: { initial: ClientDetail; role: string }) {
  const [detail, setDetail] = useState(initial);
  const [review, setReview] = useState<RegistryCommand | null>(null);
  const [pending, setPending] = useState<RegistryCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [productKind, setProductKind] = useState('dms');
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (review) reviewHeading.current?.focus();
  }, [review]);
  const canWrite = role === 'admin' || role === 'operator';
  const locked = busy || review !== null || pending !== null;
  function propose(event: FormEvent<HTMLFormElement>, build: (fields: FormData) => unknown) {
    event.preventDefault();
    setMessage('');
    try {
      setReview(registryCommand.parse(build(new FormData(event.currentTarget))));
      window.scrollTo({ top: 0, behavior: 'instant' });
    } catch {
      setMessage('Check the required fields and installation identifiers.');
    }
  }
  async function save(command: RegistryCommand) {
    setReview(null);
    setPending(command);
    setBusy(true);
    setMessage('');
    try {
      const saved = await sendCommand(command);
      setDetail(await readClient(saved.clientId));
      setPending(null);
      setMessage('Saved. The record below shows the current registered data.');
    } catch (error) {
      setMessage(
        `${error instanceof Error ? error.message : 'Unable to confirm the change'}. Retry the same request to recover its saved result, or reload before making another change.`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    if (
      (review || pending) &&
      !window.confirm('Discard this draft and load the current saved record?')
    )
      return;
    setBusy(true);
    setMessage('');
    try {
      setDetail(await readClient(detail.client.id));
      setReview(null);
      setPending(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to reload');
    } finally {
      setBusy(false);
    }
  }
  const client = detail.client;
  return (
    <>
      <p className="eyebrow">
        {client.code}
        {client.archived ? ' · ARCHIVED' : ''}
      </p>
      <h1>{client.name}</h1>
      <p>
        {client.contactName}
        {client.contactName && client.contactEmail ? ' · ' : ''}
        {client.contactEmail}
      </p>
      <p>
        Registered {date(client.registeredAt)} · Updated {date(client.updatedAt)}
      </p>
      <button className="secondary" type="button" disabled={busy} onClick={() => void reload()}>
        Reload saved record
      </button>
      <p role="status" className={message ? 'notice' : ''}>
        {message}
      </p>
      {review && (
        <section aria-label="Review registry change">
          <h2 ref={reviewHeading} tabIndex={-1}>
            Review: {titles[review.type]}
          </h2>
          {review.type === 'client.update' && (
            <dl>
              <dt>Name</dt>
              <dd>
                {client.name} → {review.name}
              </dd>
              <dt>Contact name</dt>
              <dd>
                {client.contactName ?? 'None'} → {review.contactName ?? 'None'}
              </dd>
              <dt>Contact email</dt>
              <dd>
                {client.contactEmail ?? 'None'} → {review.contactEmail ?? 'None'}
              </dd>
              <dt>Client status</dt>
              <dd>
                {client.archived ? 'Archived' : 'Active'} →{' '}
                {review.archived ? 'Archived' : 'Active'}
              </dd>
            </dl>
          )}
          {review.type === 'installation.create' && (
            <dl>
              <dt>Environment</dt>
              <dd>{review.environment}</dd>
              <dt>Installation</dt>
              <dd>{review.label}</dd>
              <dt>Local installation ID</dt>
              <dd>
                <code>{review.localInstallationId}</code>
              </dd>
              <dt>Tenant ID</dt>
              <dd>
                <code>{review.tenantId}</code>
              </dd>
            </dl>
          )}
          {review.type === 'product.create' && (
            <p>
              Register {review.binding.product === 'dms' ? 'DMS' : 'Turnstile'} in{' '}
              {detail.installations.find((i) => i.id === review.installationId)?.label}. It starts
              pending approval.
              {review.binding.applicationId && (
                <>
                  {' '}
                  Application ID: <code>{review.binding.applicationId}</code>.
                </>
              )}
            </p>
          )}
          {review.type === 'product.policy' && (
            <p>
              {review.decision === 'approve'
                ? 'Approve'
                : review.decision === 'reject'
                  ? 'Reject'
                  : 'Suspend'}{' '}
              {detail.products.find((p) => p.id === review.id)?.product} in{' '}
              {detail.products.find((p) => p.id === review.id)?.environment}.
            </p>
          )}
          {review.type === 'client.update' && review.archived !== client.archived && (
            <p>Changing archive status leaves every product's approval unchanged.</p>
          )}
          <p>Reason: {review.reason}</p>
          <button type="button" disabled={busy} onClick={() => void save(review)}>
            Confirm change
          </button>
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={() => setReview(null)}
          >
            Keep editing
          </button>
        </section>
      )}
      {pending && (
        <section>
          <h2>Confirm the saved outcome</h2>
          <p>
            This request keeps the same identity when retried. A retry recovers the existing receipt
            if the change already committed.
          </p>
          <button type="button" disabled={busy} onClick={() => void save(pending)}>
            {busy ? 'Saving…' : 'Retry same request'}
          </button>
        </section>
      )}
      {canWrite && (
        <details>
          <summary>Edit client details or archive status</summary>
          <form
            key={client.revision}
            onSubmit={(event) =>
              propose(event, (fields) => ({
                type: 'client.update',
                requestId: crypto.randomUUID(),
                id: client.id,
                revision: client.revision,
                name: fields.get('name'),
                contactName: nullable(fields.get('contactName')),
                contactEmail: nullable(fields.get('contactEmail')),
                archived: fields.get('archived') === 'true',
                reason: fields.get('reason'),
              }))
            }
          >
            <fieldset disabled={locked}>
              <label>
                Name
                <input name="name" required maxLength={160} defaultValue={client.name} />
              </label>
              <label>
                Contact name (optional)
                <input name="contactName" maxLength={100} defaultValue={client.contactName ?? ''} />
              </label>
              <label>
                Contact email (optional)
                <input
                  name="contactEmail"
                  type="email"
                  maxLength={254}
                  defaultValue={client.contactEmail ?? ''}
                />
              </label>
              <label>
                Client status
                <select name="archived" defaultValue={String(client.archived)}>
                  <option value="false">Active</option>
                  <option value="true">Archived</option>
                </select>
              </label>
              <label>
                Reason
                <input name="reason" required maxLength={300} />
              </label>
              <button type="submit">Review client changes</button>
            </fieldset>
          </form>
        </details>
      )}
      <h2>Installations</h2>
      {detail.installations.length === 0 && (
        <section>
          <p>No installations registered.</p>
        </section>
      )}
      {detail.installations.map((installation) => (
        <section key={installation.id}>
          <h3>
            {installation.label} <span className="badge">{installation.environment}</span>
          </h3>
          <dl>
            <dt>Registered</dt>
            <dd>{date(installation.registeredAt)}</dd>
            <dt>Central installation ID</dt>
            <dd>
              <code>{installation.id}</code>
            </dd>
            <dt>Local installation ID</dt>
            <dd>
              <code>{installation.localInstallationId}</code>
            </dd>
            <dt>Tenant ID</dt>
            <dd>
              <code>{installation.tenantId}</code>
            </dd>
          </dl>
          {detail.products
            .filter((p) => p.installationId === installation.id)
            .map((product) => {
              const choices: Array<{ value: string; label: string }> = [];
              if (product.policyState !== 'approved' && product.pairingVerifiedAt)
                choices.push({
                  value: 'approve',
                  label: product.firstApprovedAt ? 'Reapprove' : 'Approve',
                });
              if (product.policyState === 'pending')
                choices.push({ value: 'reject', label: 'Reject' });
              if (role === 'admin' && product.policyState !== 'suspended')
                choices.push({ value: 'suspend', label: 'Suspend' });
              return (
                <article key={product.id}>
                  <h4>
                    {product.product === 'dms' ? 'DMS' : 'Turnstile'}{' '}
                    <span className="badge">{product.policyState}</span>
                  </h4>
                  <p>
                    {product.pairingVerifiedAt
                      ? 'Pairing verified'
                      : 'Pairing not verified. Approval requires verified pairing.'}
                  </p>
                  {product.policyState === 'approved' &&
                    !product.currentActivationAcknowledgedAt && (
                      <p className="notice">Approved, awaiting activation acknowledgement.</p>
                    )}
                  <dl>
                    <dt>Product ID</dt>
                    <dd>
                      <code>{product.id}</code>
                    </dd>
                    {product.applicationId && (
                      <>
                        <dt>Application ID</dt>
                        <dd>
                          <code>{product.applicationId}</code>
                        </dd>
                      </>
                    )}
                    <dt>Registered</dt>
                    <dd>{date(product.registeredAt)}</dd>
                    <dt>First approved</dt>
                    <dd>{date(product.firstApprovedAt)}</dd>
                    <dt>Latest approval</dt>
                    <dd>{date(product.lastApprovedAt)}</dd>
                    <dt>Policy changed</dt>
                    <dd>{date(product.policyChangedAt)}</dd>
                    <dt>First issued approval</dt>
                    <dd>{date(product.firstIssuedApprovalAt)}</dd>
                    <dt>Current pairing activation acknowledged</dt>
                    <dd>{date(product.currentActivationAcknowledgedAt)}</dd>
                    <dt>First activation acknowledged</dt>
                    <dd>{date(product.firstActivationAcknowledgedAt)}</dd>
                    <dt>First activity</dt>
                    <dd>{date(product.firstReportedActivityAt)}</dd>
                    <dt>Latest contact</dt>
                    <dd>{date(product.lastContactAt)}</dd>
                    <dt>Reported version / health</dt>
                    <dd>Not reported</dd>
                  </dl>
                  <PairingControls
                    productId={product.id}
                    revision={product.revision}
                    paired={!!product.pairingVerifiedAt}
                    role={role}
                    reload={reload}
                  />
                  {product.product === 'turnstile' && (
                    <p>
                      <a href={`/clients/${client.id}/products/${product.id}/modules`}>
                        Modules and dependencies →
                      </a>
                    </p>
                  )}
                  {product.policyReason && <p>Latest policy reason: {product.policyReason}</p>}
                  {canWrite && choices.length > 0 && (
                    <form
                      key={product.revision}
                      onSubmit={(event) =>
                        propose(event, (fields) => ({
                          type: 'product.policy',
                          requestId: crypto.randomUUID(),
                          id: product.id,
                          revision: product.revision,
                          decision: fields.get('decision'),
                          reason: fields.get('reason'),
                        }))
                      }
                    >
                      <fieldset disabled={locked}>
                        <label>
                          Decision
                          <select name="decision">
                            {choices.map((choice) => (
                              <option value={choice.value} key={choice.value}>
                                {choice.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Reason
                          <input name="reason" required maxLength={300} />
                        </label>
                        <button type="submit">Review decision</button>
                      </fieldset>
                    </form>
                  )}
                </article>
              );
            })}
          {!detail.products.some((p) => p.installationId === installation.id) && (
            <p>No products registered.</p>
          )}
        </section>
      ))}
      {canWrite && !client.archived && (
        <>
          <details>
            <summary>Reserve a fresh installation</summary>
            <p>
              Central generates permanent installation, tenant and application IDs and registers
              both pending products. Current MFA is required.
            </p>
            <form
              key={`fresh-${detail.installations.length}`}
              onSubmit={(event) =>
                propose(event, (fields) => ({
                  type: 'installation.reserve',
                  requestId: crypto.randomUUID(),
                  clientId: client.id,
                  environment: fields.get('environment'),
                  label: fields.get('label'),
                  reason: fields.get('reason'),
                }))
              }
            >
              <fieldset disabled={locked}>
                <label>
                  Environment code
                  <input
                    name="environment"
                    required
                    maxLength={32}
                    pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,31}"
                  />
                </label>
                <label>
                  Installation label
                  <input name="label" required maxLength={100} />
                </label>
                <label>
                  Reason
                  <input name="reason" required maxLength={300} />
                </label>
                <button type="submit">Review fresh reservation</button>
              </fieldset>
            </form>
          </details>
          <details>
            <summary>Register an installation</summary>
            <p>
              Use the durable installation and tenant identifiers supplied by the customer operator.
              These bindings are permanent.
            </p>
            <form
              key={detail.installations.length}
              onSubmit={(event) =>
                propose(event, (fields) => ({
                  type: 'installation.create',
                  requestId: crypto.randomUUID(),
                  clientId: client.id,
                  environment: fields.get('environment'),
                  label: fields.get('label'),
                  localInstallationId: fields.get('localInstallationId'),
                  tenantId: fields.get('tenantId'),
                  reason: fields.get('reason'),
                }))
              }
            >
              <fieldset disabled={locked}>
                <label>
                  Environment code
                  <input
                    name="environment"
                    required
                    maxLength={32}
                    pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,31}"
                    placeholder="production"
                  />
                </label>
                <label>
                  Installation label
                  <input name="label" required maxLength={100} />
                </label>
                <label>
                  Local installation ID
                  <input name="localInstallationId" required />
                </label>
                <label>
                  Tenant ID
                  <input name="tenantId" required />
                </label>
                <label>
                  Reason
                  <input name="reason" required maxLength={300} />
                </label>
                <button type="submit">Review installation</button>
              </fieldset>
            </form>
          </details>
        </>
      )}
      {canWrite && !client.archived && detail.installations.length > 0 && (
        <details>
          <summary>Register a product</summary>
          <form
            key={detail.products.length}
            onSubmit={(event) =>
              propose(event, (fields) => ({
                type: 'product.create',
                requestId: crypto.randomUUID(),
                clientId: client.id,
                installationId: fields.get('installationId'),
                binding:
                  productKind === 'dms'
                    ? { product: 'dms', applicationId: null }
                    : { product: 'turnstile', applicationId: fields.get('applicationId') },
                reason: fields.get('reason'),
              }))
            }
          >
            <fieldset disabled={locked}>
              <label>
                Installation
                <select name="installationId">
                  {detail.installations.map((installation) => (
                    <option key={installation.id} value={installation.id}>
                      {installation.label} · {installation.environment}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Product
                <select
                  value={productKind}
                  onChange={(event) => setProductKind(event.target.value)}
                >
                  <option value="dms">DMS</option>
                  <option value="turnstile">Turnstile</option>
                </select>
              </label>
              {productKind === 'turnstile' && (
                <label>
                  Turnstile application ID
                  <input name="applicationId" required />
                </label>
              )}
              <label>
                Reason
                <input name="reason" required maxLength={300} />
              </label>
              <button type="submit">Review product registration</button>
            </fieldset>
          </form>
        </details>
      )}
      {canWrite && (
        <p>
          <a href="/access" target="_blank" rel="noreferrer">
            Verify MFA in another tab
          </a>
          , then return here to confirm a sensitive change.
        </p>
      )}
      <h2>Recent activity</h2>
      <p>The latest 50 registered changes are shown.</p>
      <ul>
        {detail.activity.map((item) => (
          <li key={item.id}>
            <strong>{item.action.replaceAll('.', ' ')}</strong> · {date(item.committedAt)}
            <p>
              {item.reason}
              <br />
              Actor: <code>{item.actorId}</code> ({item.actorRole})
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
