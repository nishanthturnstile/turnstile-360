'use client';
import { pairingCommand, pairingFile } from '@thaarei/control-plane-contracts';
import { useState } from 'react';
import type { z } from 'zod';

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
}: {
  productId: string;
  revision: number;
  paired: boolean;
  role: string;
  reload: () => Promise<void>;
}) {
  const [pending, setPending] = useState<z.infer<typeof pairingCommand> | null>(null);
  const [file, setFile] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function send(command: z.infer<typeof pairingCommand>) {
    setBusy(true);
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
    <details>
      <summary>Deployment setup and credentials</summary>
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
            if (
              !window.confirm(
                action === 'replace' || action === 'revoke-credential'
                  ? 'Revoke the existing credential and suspend any approval? Replacement requires fresh pairing and explicit reapproval.'
                  : 'Confirm this pairing code change?',
              )
            )
              return;
            const bytes = crypto.getRandomValues(new Uint8Array(32));
            const code = btoa(String.fromCharCode(...bytes))
              .replaceAll('+', '-')
              .replaceAll('/', '_')
              .replaceAll('=', '');
            void send(
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
          }}
        >
          <fieldset disabled={busy || pending !== null}>
            <label>
              Action
              <select name="action">
                {!paired && <option value="issue">Issue initial pairing file</option>}
                <option value="revoke">Revoke unused pairing code</option>
                {role === 'admin' && (
                  <>
                    <option value="replace">Replace machine and issue pairing file</option>
                    <option value="revoke-credential">Revoke machine credential</option>
                  </>
                )}
              </select>
            </label>
            <label>
              Pairing ID (for unused code revocation)
              <input name="pairingId" />
            </label>
            <label>
              Reason
              <input name="reason" required maxLength={300} />
            </label>
            <button type="submit">Review and confirm</button>
          </fieldset>
        </form>
      )}
      {pending && (
        <button type="button" disabled={busy} onClick={() => void send(pending)}>
          Retry same request
        </button>
      )}
      {file !== null && (
        <button type="button" onClick={() => download(file)}>
          Download pairing file again
        </button>
      )}
      <p role="status">{message}</p>
      <p>
        Pairing creates no approval. Keep the file private. It is held only in this page's memory;
        reloading clears it.
      </p>
    </details>
  );
}
