'use client';
import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { request } from './client.ts';
import { resetEntry } from './reset-entry.ts';
export default function Access() {
  const [mode, setMode] = useState('login');
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const initialized = useRef(false);
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const entry = resetEntry(location.search);
    if (entry) {
      setMode(entry.mode);
      setToken(entry.token);
      setMessage(entry.message);
    }
    history.replaceState(null, '', '/access');
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'login') {
        const data = await request('/api/auth/sign-in/email', {
          email: fields.email,
          password: fields.password,
        });
        setMode(data.twoFactorRedirect ? 'mfa' : 'enroll');
      } else if (mode === 'enroll') {
        setSetup(await request('/api/auth/two-factor/enable', { password: fields.password }));
        setMode('mfa');
      } else if (mode === 'mfa' || mode === 'backup') {
        await request(
          `/api/auth/two-factor/${mode === 'mfa' ? 'verify-totp' : 'verify-backup-code'}`,
          { code: fields.code },
        );
        setSetup(null);
        location.replace('/');
      } else if (mode === 'reset') {
        if (!token) {
          setMode('forgot');
          setMessage(
            'This reset link is invalid or has expired. Request a new password reset email.',
          );
          return;
        }
        await request('/api/auth/reset-password', { token, newPassword: fields.password });
        setToken('');
        setMode('login');
        setMessage('Password updated. Sign in and complete MFA.');
      } else {
        await request(
          `/api/auth/${mode === 'verify' ? 'send-verification-email' : 'request-password-reset'}`,
          { email: fields.email },
        );
        setMessage('If the account is eligible, an email will arrive shortly.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to continue');
    } finally {
      form.reset();
      setBusy(false);
    }
  }
  return (
    <main>
      <p className="eyebrow">THAAREI STAFF</p>
      <h1>
        {mode === 'login'
          ? 'Sign in'
          : mode === 'enroll'
            ? 'Set up your authenticator'
            : mode === 'mfa' || mode === 'backup'
              ? 'Verify your identity'
              : 'Account recovery'}
      </h1>
      <p>Access is limited to admitted employees. Customer accounts cannot sign in here.</p>
      {setup && (
        <section>
          <h2>Add this account to your authenticator</h2>
          <p>Use the setup URI, then enter a code below.</p>
          <code>{setup.totpURI}</code>
          <h2>Save your recovery codes</h2>
          <p>Each code can be used once. Keep them in a secure place.</p>
          <ul>
            {setup.backupCodes.map((code) => (
              <li key={code}>
                <code>{code}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
      <form onSubmit={submit}>
        {['login', 'forgot', 'verify'].includes(mode) && (
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required maxLength={254} />
          </label>
        )}
        {['login', 'enroll', 'reset'].includes(mode) && (
          <label>
            {mode === 'reset' ? 'New password' : 'Password'}
            <input
              name="password"
              type="password"
              autoComplete={mode === 'reset' ? 'new-password' : 'current-password'}
              minLength={mode === 'reset' ? 15 : 1}
              maxLength={128}
              aria-describedby={mode === 'reset' ? 'password-requirements' : undefined}
              required
            />
            {mode === 'reset' && <span id="password-requirements">Use 15–128 characters.</span>}
          </label>
        )}
        {['mfa', 'backup'].includes(mode) && (
          <label>
            {mode === 'backup' ? 'Recovery code' : 'Authenticator code'}
            <input
              name="code"
              autoComplete="one-time-code"
              inputMode={mode === 'mfa' ? 'numeric' : 'text'}
              required
              maxLength={128}
            />
          </label>
        )}
        <button disabled={busy} type="submit">
          {busy ? 'Please wait…' : 'Continue'}
        </button>
      </form>
      <p role="status" className={message ? 'notice' : ''}>
        {message}
      </p>
      <nav aria-label="Account options">
        {[
          ['login', 'Sign in'],
          ['mfa', 'Authenticator code'],
          ['backup', 'Use a recovery code'],
          ['forgot', 'Reset password'],
          ['verify', 'Verify email'],
        ]
          .filter(([value]) => value !== mode)
          .map(([value, label]) => (
            <button
              key={value}
              className="secondary"
              type="button"
              onClick={() => {
                setMode(value ?? 'login');
                setMessage('');
                setSetup(null);
              }}
            >
              {label}
            </button>
          ))}
      </nav>
      <p>
        New employees: verify your email, then reset your password to choose one. If you have lost
        all MFA recovery codes, contact your administrator.
      </p>
    </main>
  );
}
