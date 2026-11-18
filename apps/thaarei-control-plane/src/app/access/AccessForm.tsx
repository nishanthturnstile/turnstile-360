'use client';
import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/Icon.tsx';
import { request } from './client.ts';
import { resetEntry } from './reset-entry.ts';
export default function Access() {
  const [mode, setMode] = useState('login');
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const initialized = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousMode = useRef(mode);
  useEffect(() => {
    if (mode !== previousMode.current) heading.current?.focus();
    previousMode.current = mode;
  }, [mode]);
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
      if (!['forgot', 'verify'].includes(mode)) form.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to continue');
    } finally {
      setBusy(false);
    }
  }
  const descriptions: Record<string, string> = {
    login:
      'Sign in with your staff email. We’ll verify your identity before opening the workspace.',
    enroll: 'Secure your account with an authenticator. Confirm your password to get started.',
    mfa: 'Enter the code from your authenticator app to continue securely.',
    backup: 'Enter one of your saved recovery codes. Each code can be used once.',
    forgot: 'Enter your staff email to request a password reset link.',
    verify: 'Request a verification email for your admitted staff account.',
    reset: 'Choose a new password for your staff account.',
  };
  const options =
    mode === 'login'
      ? [
          ['forgot', 'Forgot password?'],
          ['verify', 'Verify your email'],
        ]
      : mode === 'mfa'
        ? [
            ['backup', 'Use a recovery code'],
            ['login', 'Back to sign in'],
          ]
        : mode === 'backup'
          ? [
              ['mfa', 'Use authenticator'],
              ['login', 'Back to sign in'],
            ]
          : [['login', 'Back to sign in']];
  async function copySetup(value: string, description: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${description} copied. Keep it in a secure place.`);
    } catch {
      setMessage(
        'Copy is unavailable. Select the setup link or recovery codes and copy them manually.',
      );
    }
  }
  const submitLabels: Record<string, string> = {
    login: 'Sign in',
    enroll: 'Set up authenticator',
    mfa: 'Verify & open workspace',
    backup: 'Verify & open workspace',
    forgot: 'Send reset link',
    verify: 'Send verification email',
    reset: 'Update password',
  };
  return (
    <div className="auth-layout">
      <aside className="auth-aside">
        <a className="brand" href="/">
          <span className="brand-symbol">t</span>
          <span>
            thaarei<span className="brand-caption">CONTROL PLANE</span>
          </span>
        </a>
        <div className="auth-aside-content">
          <p className="eyebrow">YOUR APPLICATION WORKSPACE</p>
          <h2>
            A clear path.
            <br />
            From setup to launch.
          </h2>
          <p>
            One place to register clients, prepare installations and manage application approvals.
          </p>
        </div>
        <div className="auth-aside-footer">
          <Icon name="lock" />
          Private access for Thaarei staff
        </div>
      </aside>
      <main className="auth-main">
        <div className="auth-content">
          <div
            className="auth-step"
            role="img"
            aria-label={
              mode === 'login'
                ? 'Step 1: Sign in'
                : mode === 'enroll'
                  ? 'Step 2: Secure account'
                  : 'Verify account'
            }
          >
            <span className="complete" />
            <span className={mode !== 'login' ? 'complete' : ''} />
            <span className={['mfa', 'backup'].includes(mode) ? 'complete' : ''} />
          </div>
          <p className="eyebrow">STAFF ACCESS</p>
          <h1 ref={heading} tabIndex={-1}>
            {mode === 'login'
              ? 'Sign in'
              : mode === 'enroll'
                ? 'Set up your authenticator'
                : mode === 'mfa' || mode === 'backup'
                  ? 'Verify your identity'
                  : mode === 'verify'
                    ? 'Verify your email'
                    : mode === 'reset'
                      ? 'Choose a new password'
                      : 'Reset your password'}
          </h1>
          <p className="page-description">{descriptions[mode]}</p>
          {setup && (
            <section>
              <h2>Add this account to your authenticator</h2>
              <p>Open the setup link in your authenticator app, then enter a code below.</p>
              <a className="button secondary" href={setup.totpURI}>
                Open authenticator
              </a>
              <button
                className="secondary"
                type="button"
                onClick={() => void copySetup(setup.totpURI, 'Authenticator setup link')}
              >
                Copy setup link
              </button>
              <details>
                <summary>Manual setup link</summary>
                <code>{setup.totpURI}</code>
              </details>
              <h2>Save your recovery codes</h2>
              <p>Each code can be used once. Keep them in a secure place.</p>
              <button
                className="secondary"
                type="button"
                onClick={() => void copySetup(setup.backupCodes.join('\n'), 'Recovery codes')}
              >
                Copy recovery codes
              </button>
              <ul className="recovery-codes">
                {setup.backupCodes.map((code) => (
                  <li key={code}>
                    <code>{code}</code>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <form onSubmit={submit}>
            <fieldset disabled={busy}>
              {['login', 'forgot', 'verify'].includes(mode) && (
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    autoComplete="username"
                    required
                    maxLength={254}
                  />
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
                  {mode === 'reset' && (
                    <span id="password-requirements">Use 15–128 characters.</span>
                  )}
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
                {busy ? 'Please wait…' : submitLabels[mode]}
              </button>
            </fieldset>
          </form>
          <p role="status" className={message ? 'notice' : ''}>
            {message}
          </p>
          <nav className="auth-options" aria-label="Account options">
            {options.map(([value, label]) => (
              <button
                key={value}
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  setMode(value ?? 'login');
                  setMessage('');
                  if (!['mfa', 'backup'].includes(value ?? 'login')) setSetup(null);
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          <p className="auth-help">
            Access is limited to admitted employees. New employees: verify your email, then reset
            your password to choose one. If you have lost all MFA recovery codes, contact your
            administrator.
          </p>
        </div>
      </main>
    </div>
  );
}
