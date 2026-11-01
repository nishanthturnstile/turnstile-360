import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { type FormEvent, useEffect, useState } from 'react';
import { ButtonLink } from '@/components/button-link';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import { authMessage, beginSignIn, identity } from './client';

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
      <h1 className="page-title">Welcome back</h1>
      <p className="intro">Sign in to continue to Turnstile 360.</p>
      {signed ? (
        <form onSubmit={submit} aria-busy={busy}>
          <FieldGroup>
            <Field data-disabled={busy}>
              <FieldLabel htmlFor="email">Email address</FieldLabel>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                disabled={busy}
              />
            </Field>
            <Field data-disabled={busy}>
              <div className="flex items-baseline justify-between gap-3">
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <a className="text-link text-xs" href="/forgot-password">
                  Forgot password?
                </a>
              </div>
              <InputGroup data-disabled={busy}>
                <InputGroupInput
                  id="password"
                  type={visible ? 'text' : 'password'}
                  autoComplete="current-password"
                  maxLength={128}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  disabled={busy}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    onClick={() => setVisible(!visible)}
                    aria-pressed={visible}
                    aria-label={visible ? 'Hide password' : 'Show password'}
                    disabled={busy}
                  >
                    {visible ? 'Hide' : 'Show'}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </Field>
            {message && <Notice message={message} />}
            {unverified && (
              <Button type="button" variant="link" disabled={busy} onClick={() => void resend()}>
                Resend verification email
              </Button>
            )}
            <Button size="lg" className="w-full" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
              <HugeiconsIcon icon={ArrowUpRight01Icon} data-icon="inline-end" aria-hidden="true" />
            </Button>
          </FieldGroup>
        </form>
      ) : (
        <p role="status">Preparing secure sign-in…</p>
      )}
      <p className="footnote">
        Access is provided by your organization.
        <br />
        Contact your administrator if you need an account.
      </p>
      <Button variant="link" className="-ml-3" type="button" disabled={busy} onClick={beginSignIn}>
        Start sign-in again
      </Button>
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
      <h1 className="page-title">{sent ? 'Check your inbox' : 'Forgot your password?'}</h1>
      <p className="intro">
        {sent
          ? 'If an account matches that email, we’ll send a password reset link. It expires in 30 minutes.'
          : 'Enter your email and we’ll help you get back in.'}
      </p>
      {!sent && (
        <form onSubmit={submit} aria-busy={busy}>
          <FieldGroup>
            <Field data-disabled={busy}>
              <FieldLabel htmlFor="recovery-email">Email address</FieldLabel>
              <Input
                id="recovery-email"
                type="email"
                autoComplete="email"
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                disabled={busy}
              />
            </Field>
            {message && <Notice message={message} />}
            <Button size="lg" className="w-full" disabled={busy} type="submit">
              {busy ? 'Sending…' : 'Send reset link'}
              <HugeiconsIcon icon={ArrowUpRight01Icon} data-icon="inline-end" aria-hidden="true" />
            </Button>
          </FieldGroup>
        </form>
      )}
      <ButtonLink variant="link" className="-ml-3 mt-4" href="/api/auth/login">
        ← Back to sign in
      </ButtonLink>
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
      <h1 className="page-title">
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
          <FieldGroup>
            <Field data-disabled={busy}>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <Input
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
            </Field>
            <Field data-disabled={busy}>
              <FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel>
              <Input
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
            </Field>
            {message && <Notice message={message} />}
            <Button size="lg" className="w-full" type="submit" disabled={busy}>
              {busy ? 'Updating…' : 'Update password'}
              <HugeiconsIcon icon={ArrowUpRight01Icon} data-icon="inline-end" aria-hidden="true" />
            </Button>
          </FieldGroup>
        </form>
      )}
      {done ? (
        <ButtonLink size="lg" className="w-full" href="/api/auth/login">
          Back to sign in
          <HugeiconsIcon icon={ArrowUpRight01Icon} data-icon="inline-end" aria-hidden="true" />
        </ButtonLink>
      ) : (
        <ButtonLink variant="link" className="-ml-3 mt-4" href="/forgot-password">
          Request a new reset link
        </ButtonLink>
      )}
    </>
  );
}
