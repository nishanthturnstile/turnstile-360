'use client';
import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { ClientDetail, RegistryCommand } from '../../contracts/registry.ts';
import { registryCommand } from '../../contracts/registry.ts';
import { ActionLink } from '../ui/ActionLink.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Badge, EmptyState, NextAction, Workflow } from '../ui/Primitives.tsx';
import { productGuidance } from '../ui/workflow.ts';
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
  const nextProduct =
    detail.products.find((p) => p.policyState === 'suspended' || p.policyState === 'rejected') ??
    detail.products.find(
      (p) =>
        !p.pairingVerifiedAt || p.policyState !== 'approved' || !p.currentActivationAcknowledgedAt,
    );
  const turnstile = detail.products.find((p) => p.product === 'turnstile');
  return (
    <>
      <div className="page-heading">
        <div>
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
          <p className="muted">
            Client record · {client.archived ? 'Archived' : 'Active'} · Updated{' '}
            {date(client.updatedAt)}
          </p>
        </div>
        <div className="heading-action">
          <button className="secondary" type="button" disabled={busy} onClick={() => void reload()}>
            <Icon name="refresh" />
            {busy ? 'Refreshing…' : 'Reload saved record'}
          </button>
          <a className="button secondary" href={`/reports?clientId=${client.id}`}>
            <Icon name="reports" />
            Usage & health
          </a>
        </div>
      </div>
      <nav className="local-nav" aria-label="Client sections">
        <a href="#installations">Installations</a>
        {canWrite && !client.archived && <a href="#installation-setup">Add installation</a>}
        <a href="#client-details">Client details</a>
        <a href="#client-activity">Activity</a>
      </nav>
      {client.archived ? (
        <NextAction
          title="This client is archived"
          href={canWrite ? '#client-details' : undefined}
          label="Review client details"
        >
          New installations and module changes are read-only. Archiving does not suspend existing
          products; their policy and credential controls remain separate.
        </NextAction>
      ) : !detail.installations.length ? (
        <NextAction
          title="Prepare the first installation"
          href={canWrite ? '#fresh-installation' : undefined}
          label="Start installation"
        >
          Reserve a fresh installation to generate its permanent identities and both product
          records. For an existing deployment, use its exported identifiers instead.
          {!canWrite && ' An Operator or Administrator must complete this step.'}
        </NextAction>
      ) : !detail.products.length ? (
        <NextAction
          title="Register an application"
          href={canWrite ? '#register-product' : undefined}
          label="Add product"
        >
          The installation is registered. Add its DMS or Turnstile product using the expected
          deployment identities.
        </NextAction>
      ) : nextProduct ? (
        <NextAction
          title={productGuidance(nextProduct).title}
          href={`#product-${nextProduct.id}`}
          label="View application"
        >
          {productGuidance(nextProduct).description}
        </NextAction>
      ) : (
        <NextAction
          title={turnstile ? 'Continue module setup and handover' : 'Review customer handover'}
          href={
            turnstile
              ? `/clients/${client.id}/products/${turnstile.id}/modules`
              : `/reports?clientId=${client.id}`
          }
          label={turnstile ? 'Open Turnstile modules' : 'Review reports'}
        >
          Product approvals are acknowledged.{' '}
          {turnstile
            ? 'Module delivery and activation still need their own review.'
            : 'Check current reporting and complete local administrator setup with the customer operator.'}
        </NextAction>
      )}
      {!canWrite && (
        <p className="notice">
          Viewer access · You can inspect setup and evidence. An Operator or Administrator must make
          changes.
        </p>
      )}
      <p role="status" className={message ? 'notice' : ''}>
        {message}
      </p>
      {review && (
        <section className="review-panel" aria-label="Review registry change">
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
          {review.type === 'installation.reserve' && (
            <dl>
              <dt>Installation</dt>
              <dd>{review.label}</dd>
              <dt>Environment</dt>
              <dd>{review.environment}</dd>
              <dt>Products</dt>
              <dd>DMS and Turnstile · both pending approval</dd>
              <dt>Identifiers</dt>
              <dd>Permanent identities will be generated centrally.</dd>
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
              {review.decision === 'approve' && (
                <>
                  {' '}
                  Licence expiry:{' '}
                  {date(
                    review.licenceExpiresAt ??
                      detail.products.find((p) => p.id === review.id)?.licenceExpiresAt ??
                      null,
                  )}
                  .
                </>
              )}
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
      <details id="client-details">
        <summary>Client details & archive status</summary>
        <dl>
          <dt>Client code</dt>
          <dd>{client.code} · permanent</dd>
          <dt>Registered</dt>
          <dd>{date(client.registeredAt)}</dd>
          <dt>Contact</dt>
          <dd>
            {client.contactName ?? 'Not provided'} · {client.contactEmail ?? 'No email provided'}
          </dd>
        </dl>
        <p className="muted">
          Archiving organizes the client registry. It does not suspend any product.
        </p>
        {canWrite && (
          <>
            <h3>Edit client details or archive status</h3>
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
                  <input
                    name="contactName"
                    maxLength={100}
                    defaultValue={client.contactName ?? ''}
                  />
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
          </>
        )}
      </details>
      <div className="section-heading" id="installations">
        <div>
          <h2>Installations</h2>
          <p>{detail.installations.length} registered · each product has independent approval</p>
        </div>
        {canWrite && !client.archived && (
          <ActionLink href="#installation-setup" className="button secondary">
            <Icon name="plus" />
            Add installation
          </ActionLink>
        )}
      </div>
      {detail.installations.length === 0 && (
        <EmptyState title="No installations registered">
          Start with a fresh reservation below, or register an existing deployment using its
          permanent identifiers.
        </EmptyState>
      )}
      {detail.installations.map((installation) => (
        <section className="installation-card" key={installation.id}>
          <h3>
            {installation.label} <span className="badge">{installation.environment}</span>
          </h3>
          <details>
            <summary>Installation identity & registration</summary>
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
          </details>
          {detail.products
            .filter((p) => p.installationId === installation.id)
            .map((product) => {
              const choices: Array<{ value: string; label: string }> = [];
              if (product.pairingVerifiedAt)
                choices.push({
                  value: 'approve',
                  label:
                    product.policyState === 'approved'
                      ? 'Update licence'
                      : product.firstApprovedAt
                        ? 'Reapprove'
                        : 'Approve',
                });
              if (product.policyState === 'pending')
                choices.push({ value: 'reject', label: 'Reject' });
              if (role === 'admin' && product.policyState !== 'suspended')
                choices.push({ value: 'suspend', label: 'Suspend' });
              return (
                <article className="product-card" id={`product-${product.id}`} key={product.id}>
                  <h4>
                    {product.product === 'dms' ? 'DMS' : 'Turnstile'}{' '}
                    <Badge
                      tone={
                        product.policyState === 'approved'
                          ? 'success'
                          : product.policyState === 'pending'
                            ? 'warning'
                            : 'danger'
                      }
                    >
                      {product.policyState}
                    </Badge>
                  </h4>
                  <div className="product-status">
                    <Icon
                      name={
                        product.currentActivationAcknowledgedAt &&
                        product.policyState === 'approved'
                          ? 'check'
                          : 'clock'
                      }
                    />
                    <div>
                      <strong>{productGuidance(product).title}</strong>
                      <p>{productGuidance(product).description}</p>
                    </div>
                  </div>
                  <Workflow
                    label={`${product.product} product setup`}
                    steps={[
                      {
                        title: 'Pair product',
                        description: product.pairingVerifiedAt
                          ? 'Expected deployment pairing is verified.'
                          : 'Deliver its private pairing file to the customer operator.',
                        state: product.pairingVerifiedAt ? 'complete' : 'current',
                        href: `#pairing-${product.id}`,
                      },
                      {
                        title: 'Approve product',
                        description:
                          product.policyState === 'approved'
                            ? 'Central product policy is approved.'
                            : 'Review the independent product decision below.',
                        state:
                          product.policyState === 'approved'
                            ? 'complete'
                            : product.pairingVerifiedAt
                              ? 'current'
                              : 'waiting',
                        href: choices.length && canWrite ? `#policy-${product.id}` : undefined,
                      },
                      {
                        title: 'Confirm acknowledgement',
                        description: product.currentActivationAcknowledgedAt
                          ? 'Current approval acknowledgement recorded.'
                          : 'Wait for customer sync, then refresh this record.',
                        state:
                          product.currentActivationAcknowledgedAt &&
                          product.policyState === 'approved'
                            ? 'complete'
                            : product.policyState === 'approved'
                              ? 'current'
                              : 'waiting',
                      },
                    ]}
                  />
                  <details>
                    <summary>Product identity, dates & evidence</summary>
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
                      <dd>
                        <a href={`/reports/${product.id}`}>View current usage & health reports →</a>
                      </dd>
                    </dl>
                  </details>
                  <PairingControls
                    productId={product.id}
                    revision={product.revision}
                    paired={!!product.pairingVerifiedAt}
                    role={role}
                    reload={reload}
                    locked={locked}
                  />
                  {product.product === 'turnstile' && (
                    <p>
                      <a
                        className="button"
                        href={`/clients/${client.id}/products/${product.id}/modules`}
                      >
                        <Icon name="modules" />
                        Modules and dependencies <Icon name="arrow" />
                      </a>
                    </p>
                  )}
                  <p>
                    Licence expiry:{' '}
                    {product.licenceExpiresAt
                      ? date(product.licenceExpiresAt)
                      : 'Not configured — approval requires an expiry'}
                    .
                  </p>
                  {product.policyReason && <p>Latest policy reason: {product.policyReason}</p>}
                  {canWrite && choices.length > 0 && (
                    <details
                      id={`policy-${product.id}`}
                      open={!!product.pairingVerifiedAt && product.policyState === 'pending'}
                    >
                      <summary>Review product policy</summary>
                      <p className="muted">
                        Approval requires verified pairing and current MFA. This decision applies
                        only to this product. Licence changes reach the customer on signed sync; an
                        offline customer keeps its previously issued deadline until then.
                      </p>
                      <form
                        key={product.revision}
                        onSubmit={(event) =>
                          propose(event, (fields) => ({
                            type: 'product.policy',
                            requestId: crypto.randomUUID(),
                            id: product.id,
                            revision: product.revision,
                            decision: fields.get('decision'),
                            ...(fields.get('decision') === 'approve' &&
                            fields.get('licenceExpiresAt')
                              ? {
                                  licenceExpiresAt: new Date(
                                    `${fields.get('licenceExpiresAt')}Z`,
                                  ).toISOString(),
                                }
                              : {}),
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
                          <label>
                            Licence expires at (UTC; required for approval)
                            <input
                              name="licenceExpiresAt"
                              type="datetime-local"
                              step="1"
                              defaultValue={product.licenceExpiresAt?.slice(0, 19) ?? ''}
                            />
                          </label>
                          <button type="submit">Review decision</button>
                        </fieldset>
                      </form>
                    </details>
                  )}
                </article>
              );
            })}
          {!detail.products.some((p) => p.installationId === installation.id) && (
            <p className="notice">
              No products registered.{' '}
              {canWrite && !client.archived ? (
                <ActionLink href="#register-product" className="">
                  Register a product
                </ActionLink>
              ) : (
                'An Operator or Administrator can register a product for an active client'
              )}{' '}
              using this installation’s expected identities.
            </p>
          )}
        </section>
      ))}
      {canWrite && !client.archived && (
        <>
          <div className="section-heading" id="installation-setup">
            <div>
              <h2>Add an installation</h2>
              <p>Choose the path that matches the customer deployment.</p>
            </div>
          </div>
          <details id="fresh-installation" open={detail.installations.length === 0}>
            <summary>New deployment · Reserve a fresh installation</summary>
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
          <details id="existing-installation">
            <summary>Existing deployment · Register an installation</summary>
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
        <details id="register-product">
          <summary>Register a product manually</summary>
          <p className="muted">
            For an existing installation, register DMS and Turnstile separately. A fresh reservation
            already registers both products.
          </p>
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
      <section id="client-activity">
        <h2>Recent activity</h2>
        <p className="muted">The latest 50 registered changes are shown. Times are UTC.</p>
        <ul className="activity-list">
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
      </section>
    </>
  );
}
