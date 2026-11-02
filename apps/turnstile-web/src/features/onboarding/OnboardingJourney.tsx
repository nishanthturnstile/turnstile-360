import type { UserSessionDto } from '@thaarei/turnstile-contracts';
import { useEffect, useState } from 'react';
import { ButtonLink } from '@/components/button-link';
import { Notice } from '@/components/notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ProductError } from '../auth/product';
import { completeSetup } from '../configuration/api';
import { OrganizationForm, SavedProfile, Structure } from '../configuration/ConfigurationEditors';
import { resumePath, setupPaths } from '../configuration/routes';
import { type EditorProps, needsSession, notice, useMounted } from '../configuration/shared';
import { useConfiguration } from '../configuration/useConfiguration';

export function OnboardingJourney({
  session,
  path,
  onCheck,
}: {
  session: UserSessionDto;
  path: string;
  onCheck: () => void;
}) {
  const { snapshot, setSnapshot, failure, loading, reload, refresh } = useConfiguration();
  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.setup.state === 'completed') {
      window.location.replace('/');
      return;
    }
    if (
      !setupPaths.some((value) => value === path) ||
      (path === '/onboarding/review' && snapshot.setup.nextStep === 'organization') ||
      (path === '/onboarding/structure' && !snapshot.organization.rootId)
    )
      window.location.replace(resumePath(snapshot));
  }, [snapshot, path]);
  if (
    loading ||
    (snapshot &&
      (snapshot.setup.state === 'completed' ||
        !setupPaths.includes(path as (typeof setupPaths)[number]) ||
        (path === '/onboarding/review' && snapshot.setup.nextStep === 'organization') ||
        (path === '/onboarding/structure' && !snapshot.organization.rootId)))
  )
    return <p role="status">Loading setup…</p>;
  if (!snapshot)
    return (
      <div className="flex flex-col gap-5">
        <h1 className="page-title">We couldn’t load setup</h1>
        <Notice
          message={
            needsSession(failure)
              ? notice(failure)
              : 'Saved setup is unavailable. Try again or check your session.'
          }
        />
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => void refresh()}>Try again</Button>
          <Button variant="outline" onClick={onCheck}>
            Check session
          </Button>
        </div>
      </div>
    );
  const props = { snapshot, session, reload, onSnapshot: setSnapshot, onCheck };
  return (
    <div className="flex flex-col gap-6">
      <div>
        <span className="eyebrow">WORKSPACE SETUP</span>
        <p className="account-label">
          Signed in as <strong>{session.user.email}</strong>
        </p>
      </div>
      <nav aria-label="Setup steps" className="flex flex-wrap gap-2">
        {[
          ['Organization', setupPaths[0]],
          ['Structure (optional)', setupPaths[1]],
          ['Review', setupPaths[2]],
        ].map(([label, href]) => (
          <ButtonLink
            key={href}
            href={href ?? '/'}
            variant={path === href ? 'secondary' : 'ghost'}
            aria-current={path === href ? 'step' : undefined}
          >
            {label}
          </ButtonLink>
        ))}
      </nav>
      {path === setupPaths[0] ? (
        <OrganizationForm {...props} />
      ) : path === setupPaths[1] ? (
        <Structure {...props} />
      ) : path === setupPaths[2] ? (
        <Review {...props} />
      ) : (
        <>
          <h1 className="page-title">Setup saved for later</h1>
          <p className="intro">
            Your saved progress is shared with your organization. Resume whenever you’re ready.
          </p>
          <SavedProfile snapshot={snapshot} />
          <ButtonLink href={resumePath(snapshot)}>Resume setup</ButtonLink>
        </>
      )}
    </div>
  );
}
function Review({ snapshot, session, reload, onSnapshot, onCheck }: EditorProps) {
  const mounted = useMounted();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [reconcile, setReconcile] = useState(false);
  async function activate() {
    if (busy || reconcile) return;
    setBusy(true);
    setMessage('');
    try {
      const value = await completeSetup(snapshot.revision, session.csrfToken);
      if (!mounted.current) return;
      onSnapshot(value);
      if (value.setup.state === 'completed') window.location.replace('/');
    } catch (error) {
      if (!mounted.current) return;
      setMessage(notice(error));
      setReconcile(error instanceof ProductError && error.code === 'CONFIGURATION_CONFLICT');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function latest() {
    setBusy(true);
    try {
      const value = await reload();
      if (!mounted.current) return;
      setReconcile(false);
      setMessage(
        value.setup.state === 'completed'
          ? 'Activation confirmed. Opening your workspace…'
          : 'Latest saved data loaded. Review it before activating.',
      );
    } catch (error) {
      if (!mounted.current) return;
      setMessage(notice(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const labels = {
    organization_name: 'Organization name saved',
    time_zone: 'Time zone confirmed',
    organization_root: 'Organization root created',
    configuration_manager: 'Your configuration access verified',
  };
  return (
    <>
      <div>
        <h1 className="page-title">Ready to open your workspace?</h1>
        <p className="intro">
          Review the saved details below. An organization with no sites or departments is ready to
          activate.
        </p>
      </div>
      {message && <Notice message={message} />}
      <SavedProfile snapshot={snapshot} />
      <div className="flex flex-wrap gap-3">
        <ButtonLink variant="outline" href={setupPaths[0]}>
          Edit organization
        </ButtonLink>
        <ButtonLink variant="outline" href={setupPaths[1]}>
          Edit structure
        </ButtonLink>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Setup checklist</h2>
          </CardTitle>
          <CardDescription>
            {snapshot.units.length - 1} optional sites or departments saved. Document features have
            their own availability and permissions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll this bounded list.
            tabIndex={0}
            className="mb-6 flex max-h-60 flex-col gap-2 overflow-auto"
            aria-label="Saved scope"
          >
            {snapshot.units.map((unit) => (
              <li key={unit.id} className="break-words">
                {unit.type === 'organization'
                  ? 'Organization'
                  : unit.type === 'site'
                    ? 'Site'
                    : 'Department'}
                : {unit.name}
              </li>
            ))}
          </ul>
          <ul className="flex flex-col gap-3">
            {snapshot.setup.requirements.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{labels[item.id]}</span>
                <Badge variant="secondary">{item.satisfied ? 'Ready' : 'Needed'}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
        <CardFooter>
          <Button
            disabled={
              busy || reconcile || snapshot.setup.requirements.some((item) => !item.satisfied)
            }
            onClick={() => void activate()}
          >
            {busy ? 'Activating…' : 'Activate workspace'}
          </Button>
        </CardFooter>
      </Card>
      {message && (
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" disabled={busy} onClick={() => void latest()}>
            Check saved setup
          </Button>
          <Button variant="outline" disabled={busy} onClick={onCheck}>
            Refresh session
          </Button>
        </div>
      )}
      <ButtonLink variant="ghost" href={setupPaths[3]}>
        Save and exit
      </ButtonLink>
    </>
  );
}
