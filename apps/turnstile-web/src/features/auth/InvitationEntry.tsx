import {
  invitationAcceptanceResultSchema,
  invitationSetupHandoffSchema,
  type RestrictedInvitationContextDto,
  recipientAccountSetupContextSchema,
  recipientAccountSetupResultSchema,
  recipientFlowResultSchema,
  recipientNavigationSchema,
  restrictedInvitationContextSchema,
} from '@thaarei/turnstile-contracts';
import { type FormEvent, useEffect, useState } from 'react';
import { ButtonLink } from '@/components/button-link';
import { LoadingStatus } from '@/components/content-loading';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { permissionLabel } from '../people/labels';
import {
  captureInvitationCredential,
  createInvitationFlow,
  forgetInvitationCredential,
  type InvitationPurpose,
  InvitationRequestError,
  invitationCredential,
  invitationMessage,
} from './invitation-client';

export function InvitationEntry() {
  const [context, setContext] = useState<RestrictedInvitationContextDto>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [setup, setSetup] = useState<{ csrfToken: string }>();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [, setCredentialRevision] = useState(0);
  const [flow] = useState(createInvitationFlow);
  useEffect(() => {
    const arrived = () => {
      flow.replace();
      captureInvitationCredential();
      setContext(undefined);
      setSetup(undefined);
      setWaiting(false);
      setPassword('');
      setName('');
      setMessage('');
      setBusy(false);
      setCredentialRevision((n) => n + 1);
    };
    let active = true;
    const purpose = flow.capture();
    if (!invitationCredential()) {
      // Let StrictMode's synchronous cleanup invalidate the first mount before HTTP.
      void Promise.resolve()
        .then(() => purpose.request('/api/invitations/context', restrictedInvitationContextSchema))
        .then((value) => {
          if (active && purpose.current()) setContext(value);
        })
        .catch((error) => {
          if (active && purpose.current()) setMessage(invitationMessage(error));
        });
    }
    window.addEventListener('hashchange', arrived);
    return () => {
      active = false;
      flow.replace();
      window.removeEventListener('hashchange', arrived);
    };
  }, [flow]);
  async function refresh(purpose: InvitationPurpose) {
    const current = await purpose.request(
      '/api/invitations/context',
      restrictedInvitationContextSchema,
    );
    setContext(current);
    return current;
  }
  async function run(work: (purpose: InvitationPurpose) => Promise<void>) {
    await flow.run(work, {
      start() {
        setBusy(true);
        setMessage('');
      },
      async error(error, purpose) {
        setMessage(invitationMessage(error));
        if (error instanceof InvitationRequestError && error.status === 401) {
          setContext(undefined);
          setSetup(undefined);
        }
        if (error instanceof InvitationRequestError && error.status === 409)
          await refresh(purpose).catch(() => {});
      },
      settled() {
        setBusy(false);
      },
    });
  }
  async function exchange(purpose: InvitationPurpose) {
    const credential = invitationCredential();
    if (!credential) return;
    const value = await purpose.request(
      '/api/invitations/exchange',
      restrictedInvitationContextSchema,
      { body: { credential } },
    );
    forgetInvitationCredential(credential);
    setContext(value);
  }
  const action =
    context?.action ??
    (context && 'review' in context
      ? {
          invitationId: context.review.invitationId,
          expectedVersion: context.review.version,
          expectedGeneration: context.review.generation,
        }
      : undefined);
  async function signIn(purpose: InvitationPurpose) {
    if (!context || !action) {
      window.location.assign('/api/auth/login');
      return;
    }
    const result = await purpose.request('/api/invitations/start', recipientNavigationSchema, {
      csrf: context.csrfToken,
      body: action,
    });
    window.location.assign(result.destination);
  }
  async function startSetup(purpose: InvitationPurpose) {
    if (!context || !action) return;
    const handoff = await purpose.request('/api/invitations/setup', invitationSetupHandoffSchema, {
      csrf: context.csrfToken,
      body: action,
    });
    const value = await purpose.request(handoff.destination, recipientAccountSetupContextSchema, {
      body: { receipt: handoff.receipt },
    });
    if (value.phase === 'ready') setSetup(value);
    else {
      setWaiting(true);
      setMessage('Continue by signing in to your existing account.');
    }
  }
  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!setup || busy) return;
    const input = { name, password };
    setPassword('');
    await run(async (purpose) => {
      await purpose.request(
        '/identity/invitation-setup/complete',
        recipientAccountSetupResultSchema,
        {
          csrf: setup.csrfToken,
          body: input,
        },
      );
      setSetup(undefined);
      setWaiting(true);
      setMessage('Check your email and verify your address, then continue to sign in.');
    });
  }
  async function accept(purpose: InvitationPurpose) {
    if (context?.phase !== 'verified' || !action) return;
    const result = await purpose.request(
      '/api/invitations/accept',
      invitationAcceptanceResultSchema,
      {
        csrf: context.csrfToken,
        body: {
          ...action,
          permissionDigest: context.review.permissionDigest,
          scopeDigest: context.review.scopeDigest,
        },
      },
    );
    if (result.session === 'established') window.location.assign('/');
    else {
      await refresh(purpose);
      purpose.check();
      setMessage(
        result.session === 'denied'
          ? 'Your membership is currently unavailable. Contact your administrator.'
          : 'Your membership is saved. Continue to sign in.',
      );
    }
  }
  async function switchAccount(purpose: InvitationPurpose) {
    if (!context || !action) return;
    const value = await purpose.request(
      '/api/invitations/switch-account',
      recipientFlowResultSchema,
      { csrf: context.csrfToken, body: { ...action, endCurrentAuthoritySession: true } },
    );
    if (value.authority === 'pending')
      setMessage(
        'Local sign-out is complete. Try switching again to finish signing out of this identity.',
      );
    else {
      await refresh(purpose);
      purpose.check();
      setMessage('Sign in with the email address on this invitation.');
    }
  }
  async function decline(purpose: InvitationPurpose) {
    if (!context || !action) return;
    setContext(
      await purpose.request('/api/invitations/decline', restrictedInvitationContextSchema, {
        csrf: context.csrfToken,
        body: action,
      }),
    );
  }
  async function cancel(purpose: InvitationPurpose) {
    if (!context || !action) return;
    await purpose.request('/api/invitations/cancel', recipientFlowResultSchema, {
      csrf: context.csrfToken,
      body: action,
    });
    window.location.assign('/sign-in');
  }
  const hasCredential = !!invitationCredential();
  return (
    <>
      <span className="eyebrow">WORKSPACE INVITATION</span>
      <h1 className="page-title">
        {setup ? 'Create your account' : waiting ? 'Verify your email' : 'Join your workspace'}
      </h1>
      {message && <Notice message={message} />}
      {hasCredential ? (
        <>
          <p className="intro">
            Continue to review the workspace, roles and access offered in this invitation.
          </p>
          <Button disabled={busy} onClick={() => void run(exchange)}>
            {busy && <Spinner data-icon="inline-start" />}Review invitation
          </Button>
        </>
      ) : !context ? (
        <>
          {!message && <LoadingStatus>Loading invitation…</LoadingStatus>}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async (purpose) => {
                await refresh(purpose);
                purpose.check();
              })
            }
          >
            Try again
          </Button>
          <ButtonLink href="/api/auth/login">Continue to sign in</ButtonLink>
        </>
      ) : setup ? (
        <form onSubmit={complete} aria-busy={busy}>
          <p className="intro">
            Choose your name and a password with 15–128 characters. We’ll email you a verification
            link.
          </p>
          <FieldGroup>
            <Field data-disabled={busy}>
              <FieldLabel htmlFor="recipient-name">Your name</FieldLabel>
              <Input
                id="recipient-name"
                autoComplete="name"
                maxLength={200}
                required
                disabled={busy}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field data-disabled={busy}>
              <FieldLabel htmlFor="recipient-password">Choose a password</FieldLabel>
              <Input
                id="recipient-password"
                type="password"
                autoComplete="new-password"
                minLength={15}
                maxLength={128}
                required
                disabled={busy}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={busy}>
              {busy && <Spinner data-icon="inline-start" />}Create account and send verification
            </Button>
          </FieldGroup>
        </form>
      ) : context.phase === 'accepted' ? (
        <>
          <p className="intro">
            {context.canEnter
              ? 'Your membership is saved. Continue to your workspace.'
              : 'Your membership is currently unavailable. Contact your administrator.'}
          </p>
          {context.canEnter && (
            <ButtonLink href="/api/auth/login">Continue to workspace</ButtonLink>
          )}
        </>
      ) : context.phase === 'unavailable' ? (
        <>
          <p className="intro">
            {context.state === 'identity_mismatch'
              ? 'You signed in with a different email address. Switch accounts to use this invitation.'
              : context.state === 'needs_reapproval'
                ? 'This invitation needs a fresh review from your administrator.'
                : context.state === 'cancelled'
                  ? 'This invitation has been cancelled.'
                  : context.state === 'expired'
                    ? 'This invitation has expired. Ask your administrator for a new one.'
                    : 'You already have a workspace membership. Contact your administrator for access.'}
          </p>
          {context.state === 'identity_mismatch' && (
            <Button disabled={busy} onClick={() => void run(switchAccount)}>
              Sign out of this identity and switch accounts
            </Button>
          )}
        </>
      ) : (
        <>
          <p className="intro">
            You’re invited to {context.review.workspaceName} as {context.review.addressedEmail}.
          </p>
          <ul>
            {context.review.assignments.map((assignment) => (
              <li key={assignment.id}>
                <strong>{assignment.role.name}</strong>
                {' — '}
                {assignment.scope.kind === 'company'
                  ? 'Whole workspace'
                  : assignment.scope.unitIds
                      .map(
                        (id) =>
                          context.review.scopeContext
                            .filter((row) => row.unit.id === id)
                            .map((row) =>
                              [...row.ancestors.map((a) => a.name), row.unit.name].join(' / '),
                            )[0] ?? 'Approved unit',
                      )
                      .join(', ')}
                {assignment.scope.kind === 'units' && assignment.scope.includeChildren
                  ? ' and its subunits'
                  : ''}
                <p>{assignment.role.permissions.map(permissionLabel).join(', ')}</p>
              </li>
            ))}
          </ul>
          {context.phase === 'verified' ? (
            <Button disabled={busy} onClick={() => void run(accept)}>
              {busy && <Spinner data-icon="inline-start" />}Accept invitation
            </Button>
          ) : (
            <>
              {!waiting && (
                <Button disabled={busy} onClick={() => void run(startSetup)}>
                  Create an account
                </Button>
              )}
              <Button
                variant={waiting ? 'default' : 'outline'}
                disabled={busy}
                onClick={() => void run(signIn)}
              >
                {waiting ? 'I verified my email — continue' : 'Sign in with an existing account'}
              </Button>
              <ButtonLink variant="link" href="/forgot-password">
                Recover an existing account
              </ButtonLink>
            </>
          )}
          <Button variant="outline" disabled={busy} onClick={() => void run(decline)}>
            Decline invitation
          </Button>
        </>
      )}
      {context && (
        <Button variant="link" disabled={busy} onClick={() => void run(cancel)}>
          Cancel and leave this invitation
        </Button>
      )}
    </>
  );
}
