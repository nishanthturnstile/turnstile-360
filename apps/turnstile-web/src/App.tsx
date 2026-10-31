import type { UserSessionDto } from '@thaarei/turnstile-contracts';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ForgotPassword, Notice, ResetPassword, SignIn } from './features/auth/AuthForms';
import { beginSignIn, captureResetToken, identity } from './features/auth/client';
import { endSession, loadCapabilities, loadSession, ProductError } from './features/auth/product';

let resetToken = captureResetToken();
function Brand() {
  return (
    <a href="/" className="brand" aria-label="Turnstile 360 home">
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path
          d="M7 7h18M16 7v18M7 25l9-9 9 9"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>
        turnstile<span className="brand-number">360</span>
      </span>
    </a>
  );
}
function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-layout">
      <aside className="brand-panel">
        <Brand />
        <div className="brand-story">
          <span className="eyebrow">TURNSTILE 360</span>
          <p>
            A familiar place.
            <br />A fresh start.
          </p>
          <span>Your workspace, ready when you are.</span>
        </div>
        <span className="panel-footer">Thoughtfully built by Thaarei</span>
        <div className="orbit" aria-hidden="true" />
      </aside>
      <div className="form-panel">
        <div className="mobile-brand">
          <Brand />
        </div>
        <main className="auth-content">{children}</main>
        <footer>
          Turnstile 360 <span aria-hidden="true">·</span> Thaarei
        </footer>
      </div>
    </div>
  );
}
function AccountState({
  kind,
  retry,
}: {
  kind: 'expired' | 'denied' | 'unavailable' | 'signed-out';
  retry?: () => void;
}) {
  const [message, setMessage] = useState('');
  const content = {
    expired: ['Your session has ended', 'Sign in again to return to your workspace.'],
    denied: [
      'Access isn’t available yet',
      'Your account doesn’t have access to this workspace. Contact your administrator for help.',
    ],
    unavailable: [
      'We can’t connect right now',
      'We couldn’t check your session. Please try again in a moment.',
    ],
    'signed-out': ['You’re signed out', 'Your workspace session has ended. See you next time.'],
  }[kind];
  async function switchAccount() {
    try {
      const result = await identity.signOut();
      if (result.error) setMessage('We couldn’t sign out of this account. Please try again.');
      else beginSignIn();
    } catch {
      setMessage('Sign-out is temporarily unavailable. Please try again.');
    }
  }
  return (
    <>
      <span className="eyebrow">YOUR ACCOUNT</span>
      <h1>{content[0]}</h1>
      <p className="intro">{content[1]}</p>
      {message && <Notice message={message} />}
      <button
        className="primary"
        type="button"
        onClick={kind === 'unavailable' ? (retry ?? beginSignIn) : beginSignIn}
      >
        {kind === 'unavailable' ? 'Try again' : 'Sign in'}
        <span aria-hidden="true">↗</span>
      </button>
      {kind === 'denied' && (
        <button className="text-button" type="button" onClick={() => void switchAccount()}>
          Sign in with a different account
        </button>
      )}
    </>
  );
}
function Workspace() {
  const generation = useRef(0);
  const [session, setSession] = useState<UserSessionDto>();
  const [state, setState] = useState<
    'loading' | 'ready' | 'expired' | 'denied' | 'unavailable' | 'signed-out'
  >('loading');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [connection, setConnection] = useState('');
  const [logout, setLogout] = useState<{ csrf: string; retryUntil: number }>();
  const check = useCallback(async () => {
    const current = generation.current;
    try {
      const value = await loadSession();
      if (current !== generation.current) return;
      setSession(value);
      setState('ready');
    } catch (error) {
      if (current !== generation.current) return;
      if (error instanceof ProductError && error.status === 401) {
        setSession(undefined);
        setState('expired');
      } else if (error instanceof ProductError && error.status === 403) {
        setSession(undefined);
        setState('denied');
      } else setState('unavailable');
    }
  }, []);
  useEffect(() => {
    void check();
  }, [check]);
  useEffect(() => {
    if (state !== 'ready') return;
    const focus = () => {
      if (!document.hidden) void check();
    };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    const timer = window.setInterval(focus, 60000);
    return () => {
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
      window.clearInterval(timer);
    };
  }, [state, check]);
  async function signOut() {
    const csrf = logout?.csrf ?? session?.csrfToken;
    if (!csrf || busy) return;
    generation.current++;
    setBusy(true);
    setMessage('');
    const retryUntil = logout?.retryUntil ?? Date.now() + 300000;
    setSession(undefined);
    setLogout({ csrf, retryUntil });
    try {
      const result = await endSession(csrf);
      setState('signed-out');
      if (result.authority === 'complete') setLogout(undefined);
      else {
        setLogout({ csrf, retryUntil: Date.parse(result.retryUntil ?? '') || retryUntil });
        setMessage(
          'You’re signed out of this workspace. Account sign-out is still pending. Please retry.',
        );
      }
    } catch (error) {
      setState('signed-out');
      if (error instanceof ProductError && error.code === 'CSRF_REJECTED') {
        try {
          const current = await loadSession();
          setLogout({ csrf: current.csrfToken, retryUntil });
        } catch {
          /* Preserve the bounded retry; never claim local completion. */
        }
      }
      setMessage('Sign-out hasn’t been confirmed. Retry to finish safely.');
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    setBusy(true);
    setConnection('');
    try {
      await loadCapabilities();
      setConnection('Connected. Document features will appear here when available.');
    } catch (error) {
      if (error instanceof ProductError && error.status === 401) {
        setSession(undefined);
        setState('expired');
      } else if (error instanceof ProductError && error.code === 'AUTH_UNAVAILABLE')
        setState('unavailable');
      else if (error instanceof ProductError && error.code === 'DMS_ACCESS_DENIED')
        setConnection(
          'The document connection isn’t enabled for this workspace. Contact your administrator.',
        );
      else if (error instanceof ProductError && error.status === 403) {
        setConnection('You don’t have permission to check this connection.');
        void check();
      } else
        setConnection(
          'The document service is temporarily unavailable. Your sign-in is still active. Try again later.',
        );
    } finally {
      setBusy(false);
    }
  }
  if (state === 'loading')
    return (
      <AuthLayout>
        <span className="eyebrow">YOUR WORKSPACE</span>
        <h1>One moment</h1>
        <p className="intro" role="status">
          Checking your session…
        </p>
      </AuthLayout>
    );
  if (logout)
    return (
      <AuthLayout>
        <span className="eyebrow">YOUR ACCOUNT</span>
        <h1>Finishing sign-out</h1>
        <p className="intro" role="status">
          {message || 'Ending your workspace and account sessions…'}
        </p>
        {Date.now() < logout.retryUntil ? (
          <button className="primary" type="button" disabled={busy} onClick={() => void signOut()}>
            {busy ? 'Signing out…' : 'Retry sign-out'}
          </button>
        ) : (
          <>
            <p className="notice">
              The retry window has ended. Account sign-out could not be confirmed.
            </p>
            <a className="back-link" href="/api/auth/login">
              Return to sign in
            </a>
          </>
        )}
      </AuthLayout>
    );
  if (state !== 'ready' || !session)
    return (
      <AuthLayout>
        <AccountState kind={state === 'ready' ? 'expired' : state} retry={() => void check()} />
      </AuthLayout>
    );
  return (
    <div className="workspace">
      <header>
        <Brand />
        <button className="secondary" type="button" disabled={busy} onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <main className="workspace-content">
        <span className="eyebrow">YOUR WORKSPACE</span>
        <h1>Welcome, {session.user.name}.</h1>
        <p className="intro">You’re signed in to Turnstile 360.</p>
        <section className="entry-card">
          <div className="entry-icon" aria-hidden="true">
            ↗
          </div>
          <div>
            <h2>A place to begin</h2>
            <p>
              Your workspace is ready. Features will appear here as they become available to your
              organization.
            </p>
            <span className="account-label">
              Signed in as <strong>{session.user.email}</strong>
            </span>
          </div>
        </section>
        {session.permissions.includes('turnstile:dms:capabilities:read') && (
          <section className="connection-card">
            <div>
              <h2>Document connection</h2>
              <p>Check that your workspace can reach its document service.</p>
            </div>
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => void connect()}
            >
              {busy ? 'Checking…' : 'Check connection'}
            </button>
            {connection && (
              <p className="connection-status" role="status">
                {connection}
              </p>
            )}
          </section>
        )}
      </main>
      <footer>
        Turnstile 360 <span aria-hidden="true">·</span> Thaarei
      </footer>
    </div>
  );
}
export default function App() {
  const path = window.location.pathname;
  const [token, setToken] = useState(resetToken);
  if (path === '/sign-in')
    return (
      <AuthLayout>
        <SignIn />
      </AuthLayout>
    );
  if (path === '/forgot-password')
    return (
      <AuthLayout>
        <ForgotPassword />
      </AuthLayout>
    );
  if (path === '/reset-password')
    return (
      <AuthLayout>
        <ResetPassword
          token={token}
          clear={() => {
            resetToken = undefined;
            setToken(undefined);
          }}
        />
      </AuthLayout>
    );
  if (path === '/unauthorized')
    return (
      <AuthLayout>
        <AccountState kind="denied" />
      </AuthLayout>
    );
  if (path === '/session-expired')
    return (
      <AuthLayout>
        <AccountState kind="expired" />
      </AuthLayout>
    );
  if (path === '/auth-unavailable')
    return (
      <AuthLayout>
        <AccountState kind="unavailable" />
      </AuthLayout>
    );
  return <Workspace />;
}
