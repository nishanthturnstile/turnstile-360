import { type FormEvent, useEffect, useState } from 'react';
import { authMessage, beginSignIn, identity } from './client';

function Notice({ message, success = false }: { message: string; success?: boolean }) {
  return (
    <p className={`notice ${success ? 'notice-success' : ''}`} role={success ? 'status' : 'alert'}>
      {message}
    </p>
  );
}

export { Notice };

export function SignIn() {
  const signed = new URLSearchParams(window.location.search).has('sig');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [unverified, setUnverified] = useState(false);
  useEffect(() => {
    if (!signed) window.location.replace('/api/auth/login');
  }, [signed]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !signed) return;
    setBusy(true);
    setMessage('');
    setUnverified(false);
    const credential = password;
    setPassword('');
    try {
      const result = await identity.signIn.email({ email, password: credential });
      if (result.error) {
        setUnverified(result.error.code === 'EMAIL_NOT_VERIFIED');
        setMessage(authMessage(result.error.code, result.error.status));
      } else if (!result.data?.redirect || !result.data.url) {
        // Successful authority login alone does not establish a product session.
        setMessage('Start sign-in again to continue to your workspace.');
      }
    } catch {
      setMessage('Sign-in is temporarily unavailable. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    setBusy(true);
    try {
      const result = await identity.sendVerificationEmail({
        email,
        callbackURL: `${window.location.origin}/sign-in`,
      });
      setMessage(
        result.error
          ? authMessage(result.error.code, result.error.status)
          : 'If the account needs verification, a new email is on its way.',
      );
    } catch {
      setMessage('Email delivery is temporarily unavailable. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <span className="eyebrow">YOUR WORKSPACE</span>
      <h1>Welcome back</h1>
      <p className="intro">Sign in to continue to Turnstile 360.</p>
      {signed ? (
        <form onSubmit={submit} aria-busy={busy}>
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={busy}
          />
          <div className="label-row">
            <label htmlFor="password">Password</label>
            <a href="/forgot-password">Forgot password?</a>
          </div>
          <div className="password-field">
            <input
              id="password"
              type={visible ? 'text' : 'password'}
              autoComplete="current-password"
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              disabled={busy}
            />
            <button
              type="button"
              className="reveal"
              onClick={() => setVisible(!visible)}
              aria-pressed={visible}
              aria-label={visible ? 'Hide password' : 'Show password'}
            >
              {visible ? 'Hide' : 'Show'}
            </button>
          </div>
          {message && <Notice message={message} />}
          {unverified && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => void resend()}
            >
              Resend verification email
            </button>
          )}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
            <span aria-hidden="true">↗</span>
          </button>
        </form>
      ) : (
        <p role="status">Preparing secure sign-in…</p>
      )}
      <p className="footnote">
        Access is provided by your organization.
        <br />
        Contact your administrator if you need an account.
      </p>
      <button className="text-button subtle" type="button" disabled={busy} onClick={beginSignIn}>
        Start sign-in again
      </button>
    </>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await identity.requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (result.error) setMessage(authMessage(result.error.code, result.error.status));
      else setSent(true);
    } catch {
      setMessage('Email delivery is temporarily unavailable. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <span className="eyebrow">ACCOUNT RECOVERY</span>
      <h1>{sent ? 'Check your inbox' : 'Forgot your password?'}</h1>
      <p className="intro">
        {sent
          ? 'If an account matches that email, we’ll send a password reset link. It expires in 30 minutes.'
          : 'Enter your email and we’ll help you get back in.'}
      </p>
      {!sent && (
        <form onSubmit={submit} aria-busy={busy}>
          <label htmlFor="recovery-email">Email address</label>
          <input
            id="recovery-email"
            type="email"
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={busy}
          />
          {message && <Notice message={message} />}
          <button className="primary" disabled={busy} type="submit">
            {busy ? 'Sending…' : 'Send reset link'}
            <span aria-hidden="true">↗</span>
          </button>
        </form>
      )}
      <a className="back-link" href="/api/auth/login">
        ← Back to sign in
      </a>
    </>
  );
}

export function ResetPassword({ token, clear }: { token: string | undefined; clear: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !token) return;
    if (password !== confirm) {
      setMessage('The passwords don’t match. Please try again.');
      return;
    }
    setBusy(true);
    setMessage('');
    const credential = password;
    setPassword('');
    setConfirm('');
    try {
      const result = await identity.resetPassword({ newPassword: credential, token });
      if (result.error) setMessage(authMessage(result.error.code, result.error.status));
      else {
        clear();
        setDone(true);
      }
    } catch {
      setMessage('Password reset is temporarily unavailable. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <span className="eyebrow">ACCOUNT RECOVERY</span>
      <h1>
        {done ? 'Password updated' : token ? 'Choose a new password' : 'Request a fresh link'}
      </h1>
      <p className="intro">
        {done
          ? 'You’re ready to sign in with your new password.'
          : token
            ? 'Use at least 15 characters. A memorable phrase works well.'
            : 'This reset link is missing, expired or already used. Request a new one to continue.'}
      </p>
      {!done && token && (
        <form onSubmit={submit} aria-busy={busy}>
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={15}
            maxLength={128}
            required
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
          <label htmlFor="confirm-password">Confirm new password</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            minLength={15}
            maxLength={128}
            required
            value={confirm}
            disabled={busy}
            onChange={(event) => setConfirm(event.target.value)}
          />
          {message && <Notice message={message} />}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Updating…' : 'Update password'}
            <span aria-hidden="true">↗</span>
          </button>
        </form>
      )}
      {done ? (
        <a className="primary button-link" href="/api/auth/login">
          Back to sign in <span aria-hidden="true">↗</span>
        </a>
      ) : (
        <a className="back-link" href="/forgot-password">
          Request a new reset link
        </a>
      )}
    </>
  );
}
