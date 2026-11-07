'use client';
import { useState } from 'react';
import { request } from './client.ts';
export function AccountActions() {
  const [message, setMessage] = useState('');
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          try {
            await request('/api/auth/sign-out', {});
            location.replace('/access');
          } catch {
            setMessage('Sign-out unavailable. Retry.');
          }
        }}
      >
        Sign out
      </button>
      <a href="/access">Verify MFA again</a>
      <p role="status">{message}</p>
    </>
  );
}
