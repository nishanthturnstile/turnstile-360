'use client';
import { useState } from 'react';
import { request } from './client.ts';
export function AccountActions() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await request('/api/auth/sign-out', {});
            location.replace('/access');
          } catch {
            setMessage('Sign-out unavailable. Retry.');
            setBusy(false);
          }
        }}
      >
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
      <a className="button" href="/access" target="_blank" rel="noreferrer">
        Verify MFA again
      </a>
      <p role="status">{message}</p>
    </>
  );
}
