import type { UserSessionDto } from '@thaarei/turnstile-contracts';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ButtonLink } from '@/components/button-link';
import { PendingContent } from '@/components/content-loading';
import { Notice } from '@/components/notice';
import { ScrollRegion } from '@/components/scroll-region';
import { SetupProgress } from '@/components/setup-progress';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { ProductError } from '../auth/product';
import { completeSetup } from '../configuration/api';
import { OrganizationForm, SavedProfile, Structure } from '../configuration/ConfigurationEditors';
import { resumePath, setupPaths, setupRedirect } from '../configuration/routes';
import { type EditorProps, needsSession, notice, useMounted } from '../configuration/shared';
import { useConfiguration } from '../configuration/useConfiguration';

export function OnboardingJourney({
  session,
  path,
  onCheck,
  pending = false,
  checking = false,
}: {
  session: UserSessionDto;
  path: string;
  onCheck: () => void;
  pending?: boolean;
  checking?: boolean;
}) {
  const navigate = useNavigate();
  const { snapshot, setSnapshot, failure, loading, reload, refresh } = useConfiguration(path);
  const redirect = snapshot && !loading && !failure ? setupRedirect(snapshot, path) : undefined;
  useEffect(() => {
    if (!redirect) return;
    if (redirect === '/') onCheck();
    void navigate(redirect, { replace: true });
  }, [redirect, navigate, onCheck]);
  const reading = loading || !!redirect;
  const unavailable = (
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
  const props =
    snapshot && !reading && !failure
      ? { snapshot, session, reload, onSnapshot: setSnapshot, onCheck }
      : undefined;
  return (
    <div className="setup-journey">
      <SetupProgress
        currentPath={path}
        steps={[
          { label: 'Organization', href: setupPaths[0] },
          { label: 'First unit', href: setupPaths[1] },
          { label: 'Review', href: setupPaths[2] },
        ]}
      />
      <ScrollRegion label="Setup content" className="entry-page">
        <div className="entry-content flex flex-col gap-6">
          <PendingContent
            pending={pending || reading}
            label="Loading setup…"
            shape={path === setupPaths[0] || path === setupPaths[1] ? 'form' : 'cards'}
          >
            {!props ? (
              unavailable
            ) : path === setupPaths[0] ? (
              <OrganizationForm {...props} />
            ) : path === setupPaths[1] ? (
              <Structure {...props} />
            ) : path === setupPaths[2] ? (
              <Review {...props} ready={!pending && !checking} />
            ) : (
              <>
                <h1 className="page-title">Setup saved for later</h1>
                <p className="intro">
                  Your saved progress is shared with your organization. Resume whenever you’re
                  ready.
                </p>
                <SavedProfile snapshot={props.snapshot} />
                <ButtonLink href={resumePath(props.snapshot)}>Resume setup</ButtonLink>
              </>
            )}
          </PendingContent>
        </div>
      </ScrollRegion>
    </div>
  );
}
function Review({
  snapshot,
  session,
  reload,
  onSnapshot,
  onCheck,
  ready,
}: EditorProps & { ready: boolean }) {
  const mounted = useMounted();
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState('');
  const [reconcile, setReconcile] = useState(false);
  async function activate() {
    if (busy || reconcile || !ready || snapshot.setup.nextStep !== 'review') return;
    setBusy(true);
    setMessage('');
    try {
      const value = await completeSetup(snapshot.revision, session.csrfToken);
      if (!mounted.current) return;
      onSnapshot(value);
    } catch (error) {
      if (!mounted.current) return;
      setMessage(notice(error));
      setReconcile(
        !(error instanceof ProductError) ||
          error.code === 'CONFIGURATION_CONFLICT' ||
          error.status >= 500,
      );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function latest() {
    setBusy(true);
    setReading(true);
    try {
      const value = await reload();
      if (!mounted.current) return;
      setReconcile(false);
      setMessage(
        value.setup.state === 'completed'
          ? 'Setup confirmed. Opening your workspace…'
          : 'Latest saved data loaded. Review it before finishing setup.',
      );
    } catch (error) {
      if (!mounted.current) return;
      setMessage(notice(error));
    } finally {
      if (mounted.current) {
        setBusy(false);
        setReading(false);
      }
    }
  }
  const directUnits = snapshot.units.filter(
    (unit) => unit.parentId === snapshot.organization.rootId,
  );
  return (
    <>
      <div>
        <span className="eyebrow">REVIEW YOUR SETUP</span>
        <h1 className="page-title">Ready to open your workspace?</h1>
        <p className="intro">
          Check your saved organization, time zone and first unit. You can continue making changes
          in Settings after setup.
        </p>
      </div>
      {message && <Notice message={message} />}
      <SavedProfile snapshot={snapshot} />
      <ButtonLink className="self-start" variant="outline" href={setupPaths[0]}>
        Edit organization
      </ButtonLink>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>First unit</h2>
          </CardTitle>
          <CardDescription>Saved directly under {snapshot.organization.name}.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll this bounded list.
            tabIndex={0}
            className="flex max-h-60 flex-col gap-3 overflow-auto"
            aria-label="Saved first units"
          >
            {directUnits.map((unit) => (
              <li key={unit.id} className="break-words">
                <strong>{unit.name}</strong>
                <p className="text-sm text-muted-foreground">
                  {unit.type === 'site' ? 'Site / Plant' : 'Department'}
                </p>
              </li>
            ))}
          </ul>
          {directUnits.length === 0 && <p>No first unit saved.</p>}
        </CardContent>
        <CardFooter>
          <ButtonLink variant="outline" href={setupPaths[1]}>
            Edit first unit
          </ButtonLink>
        </CardFooter>
      </Card>
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={
            busy ||
            reconcile ||
            !ready ||
            snapshot.setup.nextStep !== 'review' ||
            snapshot.setup.requirements.some((item) => !item.satisfied)
          }
          onClick={() => void activate()}
        >
          {busy && !reading && <Spinner aria-hidden="true" data-icon="inline-start" />}
          {busy && !reading ? 'Finishing…' : 'Finish setup'}
        </Button>
        <ButtonLink variant="outline" href={setupPaths[1]}>
          Back
        </ButtonLink>
        <ButtonLink variant="ghost" href={setupPaths[3]}>
          Save and exit
        </ButtonLink>
      </div>
      {message && (
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" disabled={busy} onClick={() => void latest()}>
            {reading && <Spinner aria-hidden="true" data-icon="inline-start" />}
            Check saved setup
          </Button>
          <Button variant="outline" disabled={busy} onClick={onCheck}>
            Refresh session
          </Button>
        </div>
      )}
    </>
  );
}
