'use client';
import { pairingCommand, pairingFile } from '@thaarei/control-plane-contracts';
import { useEffect, useState } from 'react';
import type { z } from 'zod';
import { Icon } from '../ui/Icon.tsx';
import { ReviewHeading } from '../ui/ReviewHeading.tsx';

function download(content: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'deployment-pairing.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function PairingControls({
  productId,
  revision,
  paired,
  role,
  reload,
  locked = false,
}: {
  productId: string;
  revision: number;
  paired: boolean;
  role: string;
  reload: () => Promise<void>;
  locked?: boolean;
}) {
  const [action, setAction] = useState(
    paired ? (role === 'admin' ? 'replace' : 'revoke') : 'issue',
  );
  const [review, setReview] = useState<z.infer<typeof pairingCommand> | null>(null);
  useEffect(() => {
    if (paired && action === 'issue') setAction(role === 'admin' ? 'replace' : 'revoke');
  }, [paired, action, role]);
  const [pending, setPending] = useState<z.infer<typeof pairingCommand> | null>(null);
  const [file, setFile] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function send(command: z.infer<typeof pairingCommand>) {
    setBusy(true);
    setReview(null);
    setPending(command);
    setMessage('');
    try {
      const response = await fetch('/api/pairing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
        cache: 'no-store',
      });
      if (!response.ok)
        throw new Error(
          response.status === 403
            ? 'Verify recent MFA and your role before retrying.'
            : 'Unable to confirm; retry the same request or reload the record.',
        );
      const result = await response.json();
      if (command.code) {
        const next = pairingFile.parse({
          version: 1,
          origin: result.origin,
          binding: result.binding,
          pairingId: result.pairingId,
          code: command.code,
          expiresAt: result.expiresAt,
        });
        setFile(next);
        download(next);
      }
      setPending(null);
      setMessage('Saved. Pairing files expire after 24 hours and must be delivered privately.');
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to confirm');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details id={`pairing-${productId}`}>
      <summary>
        {paired ? 'Pairing & credential management' : 'Connect product · Pairing file'}
      </summary>
      <p className="muted">
        {paired
          ? 'Pairing is verified. Replacement or credential revocation requires an Administrator and explicit reapproval.'
          : 'Download the setup manifest and issue a pairing file. The customer operator runs private setup; refresh the client record after they pair.'}
      </p>
      <p>
        <a href={`/api/registry/products/${productId}/manifest`}>
          Download nonsecret setup manifest
        </a>
      </p>
      {role !== 'viewer' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            const action = String(fields.get('action'));
            const bytes = crypto.getRandomValues(new Uint8Array(32));
            const code = btoa(String.fromCharCode(...bytes))
              .replaceAll('+', '-')
              .replaceAll('/', '_')
              .replaceAll('=', '');
            try {
              setReview(
                pairingCommand.parse({
                  requestId: crypto.randomUUID(),
                  productId,
                  revision,
                  action,
                  pairingId: action === 'revoke' ? fields.get('pairingId') : crypto.randomUUID(),
                  code: action === 'issue' || action === 'replace' ? code : null,
                  reason: fields.get('reason'),
                }),
              );
            } catch {
              setMessage(
                'Check the reason and pairing ID. Unused-code revocation requires a valid pairing ID.',
              );
            }
          }}
        >
          <fieldset disabled={locked || busy || pending !== null || review !== null}>
            <label htmlFor={`pairing-action-${productId}`}>Action</label>
            <select
              id={`pairing-action-${productId}`}
              name="action"
              value={action}
              onChange={(event) => setAction(event.target.value)}
            >
              {!paired && <option value="issue">Issue initial pairing file</option>}
              <option value="revoke">Revoke unused pairing code</option>
              {role === 'admin' && (
                <>
                  <option value="replace">Replace machine and issue pairing file</option>
                  <option value="revoke-credential">Revoke machine credential</option>
                </>
              )}
            </select>
            {action === 'revoke' && (
              <label>
                Pairing ID (for unused code revocation)
                <input name="pairingId" required />
              </label>
            )}
            {(action === 'replace' || action === 'revoke-credential') && (
              <p className="notice notice-danger">
                This revokes the existing credential and suspends any approval. Replacement requires
                fresh pairing and explicit reapproval.
              </p>
            )}
            <label>
              Reason
              <input name="reason" required maxLength={300} />
            </label>
            <button type="submit">Review and confirm</button>
          </fieldset>
        </form>
      )}
      {review && (
        <section className="review-panel" aria-label="Review pairing change">
          <ReviewHeading>
            Confirm{' '}
            {action === 'issue'
              ? 'initial pairing file'
              : action === 'replace'
                ? 'machine replacement'
                : action === 'revoke'
                  ? 'unused code revocation'
                  : 'machine credential revocation'}
          </ReviewHeading>
          <p>Reason: {review.reason}</p>
          <p className="muted">
            {action === 'replace' || action === 'revoke-credential'
              ? 'The existing machine credential will be revoked and approval suspended.'
              : 'Pairing grants no product approval. Pairing files expire after 24 hours and must be delivered privately.'}
          </p>
          <button
            className={action === 'replace' || action === 'revoke-credential' ? 'danger' : ''}
            type="button"
            disabled={busy || locked}
            onClick={() => void send(review)}
          >
            Confirm pairing change
          </button>
          <button
            className="secondary"
            type="button"
            disabled={busy || locked}
            onClick={() => setReview(null)}
          >
            Keep editing
          </button>
        </section>
      )}
      {pending && (
        <button type="button" disabled={busy || locked} onClick={() => void send(pending)}>
          Retry same request
        </button>
      )}
      {file !== null && (
        <button type="button" onClick={() => download(file)}>
          <Icon name="arrow" />
          Download pairing file again
        </button>
      )}
      <p role="status" className={message ? 'notice' : ''}>
        {message}
      </p>
      <p>
        Pairing creates no approval. Keep the file private. It is held only in this page's memory;
        reloading clears it.
      </p>
    </details>
  );
}
