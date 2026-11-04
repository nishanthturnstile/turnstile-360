import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { UserSessionDto, WorkspaceStatusDto } from '@thaarei/turnstile-contracts';
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ButtonLink } from '@/components/button-link';
import { ContentLoading, LoadingStatus } from '@/components/content-loading';
import { EntryContent, EntryLayout } from '@/components/entry-layout';
import { AppLink } from '@/components/navigation';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { WorkspaceLayout } from '@/components/workspace-layout';
import { workspaceDestinations } from '@/components/workspace-navigation';
import { cn } from '@/lib/utils';
import { ForgotPassword, ResetPassword, SignIn } from './features/auth/AuthForms';
import { beginSignIn, captureResetToken, identity } from './features/auth/client';
import { InvitationEntry } from './features/auth/InvitationEntry';
import { endSession, loadCapabilities, loadSession, ProductError } from './features/auth/product';
import { loadWorkspaceStatus } from './features/configuration/api';
import { settingsPaths, setupPaths } from './features/configuration/routes';
import { OnboardingJourney } from './features/onboarding/OnboardingJourney';
import { People, peoplePaths } from './features/people/People';
import { LegacyUnitPrompt } from './features/settings/LegacyUnitPrompt';
import { Settings } from './features/settings/Settings';

const DesignSystem = import.meta.env.DEV
  ? lazy(() => import('./design-system/DesignSystem'))
  : undefined;

let resetToken = captureResetToken();
function Brand() {
  return (
    <AppLink href="/" className="brand" aria-label="Turnstile 360 home">
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
    </AppLink>
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
        <footer className="app-footer">
          Turnstile 360 <span aria-hidden="true">·</span> Thaarei
        </footer>
      </div>
    </div>
  );
}
function AccountState({
  kind,
  retry,
  pending = false,
}: {
  kind: 'expired' | 'denied' | 'unavailable' | 'signed-out';
  retry?: () => void;
  pending?: boolean;
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
      <h1 className="page-title">{content[0]}</h1>
      <p className="intro">{content[1]}</p>
      {message && <Notice className="mb-5" message={message} />}
      <Button
        size="lg"
        className="w-full"
        type="button"
        disabled={pending}
        onClick={kind === 'unavailable' ? (retry ?? beginSignIn) : beginSignIn}
      >
        {pending && <Spinner aria-hidden="true" data-icon="inline-start" />}
        {kind === 'unavailable' && retry ? 'Try again' : 'Sign in'}
        <HugeiconsIcon icon={ArrowUpRight01Icon} data-icon="inline-end" aria-hidden="true" />
      </Button>
      {kind === 'unavailable' && retry && (
        <ButtonLink variant="link" className="-ml-3 mt-4" href="/api/auth/login">
          Sign in
        </ButtonLink>
      )}
      {kind === 'denied' && (
        <Button
          variant="link"
          className="-ml-3 mt-4"
          type="button"
          onClick={() => void switchAccount()}
        >
          Sign in with a different account
        </Button>
      )}
    </>
  );
}
export function Workspace() {
  const navigate = useNavigate();
  const generation = useRef(0);
  const checks = useRef(0);
  const identityId = useRef<string | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  const [session, setSession] = useState<UserSessionDto>();
  const [workspace, setWorkspace] = useState<WorkspaceStatusDto>();
  const { pathname: routePath } = useLocation();
  const [path, setPath] = useState(routePath);
  const knownPath =
    path === '/' ||
    peoplePaths.includes(path) ||
    path === '/auth-unavailable' ||
    path === '/waiting-for-setup' ||
    setupPaths.some((value) => value === path) ||
    settingsPaths.some((value) => value === path);
  const [state, setState] = useState<
    'loading' | 'ready' | 'expired' | 'denied' | 'unavailable' | 'setup-unavailable' | 'signed-out'
  >('loading');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [busyAction, setBusyAction] = useState<'sign-out' | 'connection'>();
  const [connection, setConnection] = useState('');
  const [logout, setLogout] = useState<{ csrf: string; retryUntil: number }>();
  const freshCheck = useRef<Promise<boolean>>(undefined);
  const check = useCallback(
    (fresh = false): Promise<boolean> => {
      // Focus/navigation joins a pending post-mutation check instead of superseding it.
      if (!fresh && freshCheck.current) return freshCheck.current;
      const result = (async () => {
        const current = generation.current;
        const requestedPath = window.location.pathname;
        const checkId = ++checks.current;
        setChecking(true);
        try {
          const value = await loadSession({ fresh });
          if (current !== generation.current || checkId !== checks.current) return false;
          const subjectChanged = !!identityId.current && identityId.current !== value.user.id;
          if (subjectChanged) {
            setWorkspace(undefined);
            setState('loading');
          }
          identityId.current = value.user.id;
          if (!fresh || subjectChanged) setSession(value);
          const status = await loadWorkspaceStatus(value.user.id);
          if (current !== generation.current || checkId !== checks.current) return false;
          setSession(value);
          setWorkspace(status);
          // Navigation may have joined this fresh check while it was draining a prior read.
          setPath(fresh ? window.location.pathname : requestedPath);
          setState('ready');
          if (window.location.pathname === '/auth-unavailable')
            void navigate('/', { replace: true });
          return true;
        } catch (error) {
          if (current !== generation.current || checkId !== checks.current) return false;
          if (error instanceof ProductError && error.status === 401) {
            // Keep the last subject's mounted draft owners hidden during in-page recovery.
            setState('expired');
          } else if (error instanceof ProductError && error.status === 403) {
            setState('denied');
          } else if (error instanceof ProductError && error.code === 'CONFIGURATION_UNAVAILABLE')
            setState('setup-unavailable');
          else setState('unavailable');
          return false;
        } finally {
          if (current === generation.current && checkId === checks.current) setChecking(false);
        }
      })();
      if (fresh) {
        freshCheck.current = result;
        void result.finally(() => {
          if (freshCheck.current === result) freshCheck.current = undefined;
        });
      }
      return result;
    },
    [navigate],
  );
  useEffect(() => {
    if (state !== 'ready' || !workspace || !knownPath) return;
    if (
      workspace.status === 'complete' &&
      (setupPaths.some((value) => value === path) || path === '/waiting-for-setup')
    )
      void navigate('/', { replace: true });
    else if (
      workspace.status === 'incomplete' &&
      !workspace.canManageConfiguration &&
      path !== '/waiting-for-setup'
    )
      void navigate('/waiting-for-setup', { replace: true });
  }, [state, workspace, path, knownPath, navigate]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Revalidate access on client navigation without remounting the shell.
  useEffect(() => {
    void check();
  }, [check, routePath]);
  const refreshWorkspace = useCallback((fresh = false) => check(fresh === true), [check]);
  useEffect(() => {
    if (!['ready', 'unavailable', 'expired', 'denied'].includes(state)) return;
    const focus = () => {
      if (!document.hidden) void check();
    };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    // Retry one transient startup/reload failure, then leave further retries to
    // tab focus or the user. Do not poll an unavailable authority indefinitely.
    const timer =
      state === 'ready' && workspace?.status === 'complete'
        ? window.setInterval(focus, 60000)
        : state === 'unavailable'
          ? window.setTimeout(focus, 3000)
          : undefined;
    return () => {
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
      window.clearInterval(timer);
      window.clearTimeout(timer);
    };
  }, [state, check, workspace?.status]);
  async function signOut() {
    const csrf = logout?.csrf ?? session?.csrfToken;
    if (!csrf || busy) return;
    generation.current++;
    checks.current++;
    setWorkspace(undefined);
    setBusy(true);
    setBusyAction('sign-out');
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
      setBusyAction(undefined);
    }
  }
  async function connect() {
    const current = generation.current;
    setBusy(true);
    setBusyAction('connection');
    setConnection('');
    try {
      await loadCapabilities();
      if (current !== generation.current) return;
      setConnection('Connected. Document features will appear here when available.');
    } catch (error) {
      if (current !== generation.current) return;
      if (error instanceof ProductError && error.status === 401) {
        setSession(undefined);
        setState('expired');
      } else if (
        error instanceof ProductError &&
        (error.code === 'SETUP_REQUIRED' || error.code === 'CONFIGURATION_UNAVAILABLE')
      ) {
        setWorkspace(undefined);
        setState('loading');
        void check();
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
      if (current === generation.current) {
        setBusy(false);
        setBusyAction(undefined);
      }
    }
  }
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) {
        generation.current++;
        setBusy(false);
        setBusyAction(undefined);
        setWorkspace(undefined);
        setState('loading');
        void check();
      }
    };
    window.addEventListener('pageshow', restore);
    return () => {
      window.removeEventListener('pageshow', restore);
      generation.current++;
    };
  }, [check]);
  if (state === 'loading')
    return (
      <EntryLayout
        header={
          <header className="entry-header">
            <Brand />
          </header>
        }
      >
        <EntryContent>
          <ContentLoading label="Loading workspace…" />
        </EntryContent>
      </EntryLayout>
    );
  if (logout)
    return (
      <AuthLayout>
        <span className="eyebrow">YOUR ACCOUNT</span>
        <h1 className="page-title">Finishing sign-out</h1>
        <p className="intro" role="status">
          {message || 'Ending your workspace and account sessions…'}
        </p>
        {Date.now() < logout.retryUntil ? (
          <Button
            size="lg"
            className="w-full"
            type="button"
            disabled={busy}
            onClick={() => void signOut()}
          >
            {busy && busyAction === 'sign-out' && (
              <Spinner aria-hidden="true" data-icon="inline-start" />
            )}
            {busy ? 'Signing out…' : 'Retry sign-out'}
          </Button>
        ) : (
          <>
            <Notice message="The retry window has ended. Account sign-out could not be confirmed." />
            <ButtonLink variant="link" className="-ml-3 mt-4" href="/api/auth/login">
              Return to sign in
            </ButtonLink>
          </>
        )}
      </AuthLayout>
    );
  if (!session || state === 'signed-out')
    return (
      <AuthLayout>
        <AccountState
          kind={
            state === 'ready' ? 'expired' : state === 'setup-unavailable' ? 'unavailable' : state
          }
          retry={() => void check()}
          pending={checking}
        />
      </AuthLayout>
    );
  const header = (
    <header className={cn('entry-header', workspace?.status === 'complete' && 'workspace-header')}>
      <Brand />
      <div className="entry-account">
        {state === 'ready' && (
          <p className="account-label">
            Signed in as <strong>{session.user.email}</strong>
          </p>
        )}
        {checking && routePath === path && <LoadingStatus>Checking session…</LoadingStatus>}
        <Button variant="outline" type="button" disabled={busy} onClick={() => void signOut()}>
          {busy && busyAction === 'sign-out' && (
            <Spinner aria-hidden="true" data-icon="inline-start" />
          )}
          Sign out
        </Button>
      </div>
    </header>
  );
  const unavailable =
    state === 'expired' || state === 'denied' ? (
      <div className="flex flex-col gap-5">
        <AccountState kind={state} retry={() => void check()} pending={checking} />
        <p>Your unsaved entries are kept on this page while you check your session.</p>
        <Button className="self-start" disabled={checking} onClick={() => void check()}>
          Check session and access
        </Button>
      </div>
    ) : state === 'setup-unavailable' ? (
      <div className="flex flex-col gap-5">
        <h1 className="page-title">Setup is temporarily unavailable</h1>
        <p className="intro">
          We couldn’t check saved setup. Your entries are kept while you retry.
        </p>
        <Button className="self-start" disabled={checking} onClick={() => void check()}>
          {checking && <Spinner aria-hidden="true" data-icon="inline-start" />}
          {checking ? 'Checking…' : 'Try again'}
        </Button>
      </div>
    ) : state === 'unavailable' ? (
      <AccountState kind="unavailable" retry={() => void check()} pending={checking} />
    ) : null;
  const notFound = (
    <div className="flex flex-col gap-5">
      <h1 className="page-title">Page not found</h1>
      <p className="intro">This page isn’t available.</p>
      <ButtonLink className="self-start" href="/">
        Return to workspace
      </ButtonLink>
    </div>
  );
  if (workspace?.status !== 'complete')
    return (
      <EntryLayout header={header}>
        {unavailable && <EntryContent>{unavailable}</EntryContent>}
        <div className="entry-view" hidden={state !== 'ready'}>
          {!knownPath ? (
            <EntryContent>{notFound}</EntryContent>
          ) : !workspace ? (
            <EntryContent>
              <ContentLoading label="Loading workspace…" />
            </EntryContent>
          ) : workspace.canManageConfiguration ? (
            <OnboardingJourney
              key={session.user.id}
              session={session}
              path={path}
              onCheck={refreshWorkspace}
              pending={routePath !== path || state !== 'ready'}
              checking={checking}
            />
          ) : (
            <EntryContent>
              {path === '/waiting-for-setup' ? (
                <div className="flex flex-col gap-5">
                  <span className="eyebrow">WORKSPACE SETUP</span>
                  <h1 className="page-title">Waiting for setup</h1>
                  <p className="intro">
                    Your administrator is preparing this workspace. You can retry when setup is
                    ready, or sign out.
                  </p>
                  <Button
                    className="self-start"
                    disabled={busy || checking}
                    onClick={() => void check()}
                  >
                    {checking && <Spinner aria-hidden="true" data-icon="inline-start" />}
                    {checking ? 'Checking…' : 'Retry'}
                  </Button>
                </div>
              ) : (
                <ContentLoading label="Loading workspace…" />
              )}
            </EntryContent>
          )}
        </div>
      </EntryLayout>
    );
  return (
    <WorkspaceLayout
      pending={state === 'ready' && routePath !== path}
      header={header}
      destinations={
        state === 'ready'
          ? workspaceDestinations(path, workspace.canManageConfiguration, session)
          : []
      }
      settings={
        state === 'ready' &&
        workspace?.status === 'complete' &&
        workspace.canManageConfiguration &&
        settingsPaths.some((value) => value === path)
      }
    >
      {unavailable}
      <div className="workspace-view" hidden={state !== 'ready'} inert={state !== 'ready'}>
        {!knownPath ? (
          notFound
        ) : setupPaths.some((value) => value === path) || path === '/waiting-for-setup' ? (
          <ContentLoading label="Opening workspace…" />
        ) : peoplePaths.includes(path) ? (
          <People
            key={session.user.id}
            session={session}
            path={path}
            onCheck={refreshWorkspace}
            active={state === 'ready'}
          />
        ) : settingsPaths.some((value) => value === path) ? (
          workspace.canManageConfiguration ? (
            <Settings
              key={session.user.id}
              session={session}
              path={path}
              onCheck={refreshWorkspace}
              pending={state === 'ready' && routePath !== path}
              requestedPath={routePath}
            />
          ) : (
            <div className="flex flex-col gap-5">
              <h1 className="page-title">Settings access required</h1>
              <p className="intro">
                You need configuration permission to view or change organization settings.
              </p>
              <div className="flex flex-wrap gap-3">
                <ButtonLink href="/">Return to Home</ButtonLink>
                <Button variant="outline" onClick={() => void check()} disabled={checking}>
                  {checking && <Spinner aria-hidden="true" data-icon="inline-start" />}
                  Check access
                </Button>
              </div>
            </div>
          )
        ) : (
          <>
            <span className="eyebrow">YOUR WORKSPACE</span>
            <h1 className="page-title">Welcome, {session.user.name}.</h1>
            <p className="intro">You’re signed in to Turnstile 360.</p>
            <div className="flex flex-col gap-6">
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>
                    <h2>Your workspace is ready</h2>
                  </EmptyTitle>
                  <EmptyDescription>
                    Business features will appear here as they become available to your
                    organization.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
              {workspace.canManageConfiguration && (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        <h2>Manage your workspace</h2>
                      </CardTitle>
                      <CardDescription>
                        Update your organization, sites and departments, or time zone in Settings.
                      </CardDescription>
                    </CardHeader>
                    <CardFooter>
                      <ButtonLink href="/settings" variant="outline">
                        Open Settings
                      </ButtonLink>
                    </CardFooter>
                  </Card>
                  <LegacyUnitPrompt key={session.user.id} />
                </>
              )}
              {session.permissions.includes('turnstile:dms:capabilities:read') && (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <h2>Document connection</h2>
                    </CardTitle>
                    <CardDescription>
                      Check that your workspace can reach its document service.
                    </CardDescription>
                  </CardHeader>
                  {busyAction === 'connection' && (
                    <CardContent>
                      <LoadingStatus>Checking document connection…</LoadingStatus>
                    </CardContent>
                  )}
                  {connection && (
                    <CardContent>
                      <p className="text-sm" role="status">
                        {connection}
                      </p>
                    </CardContent>
                  )}
                  <CardFooter>
                    <Button
                      variant="outline"
                      type="button"
                      disabled={busy}
                      onClick={() => void connect()}
                    >
                      {busyAction === 'connection' && (
                        <Spinner aria-hidden="true" data-icon="inline-start" />
                      )}
                      {busy ? 'Checking…' : 'Check connection'}
                    </Button>
                  </CardFooter>
                </Card>
              )}
            </div>
          </>
        )}
      </div>
    </WorkspaceLayout>
  );
}
export default function App() {
  const { pathname: path } = useLocation();
  const [token, setToken] = useState(resetToken);
  if (DesignSystem && path === '/design-system') {
    return (
      <Suspense fallback={<ContentLoading label="Loading design system…" />}>
        <DesignSystem />
      </Suspense>
    );
  }
  if (path === '/invitations/join')
    return (
      <AuthLayout>
        <InvitationEntry />
      </AuthLayout>
    );
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
  return <Workspace />;
}
