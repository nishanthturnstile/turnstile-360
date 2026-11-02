import type { ConfigurationSnapshotDto, UserSessionDto } from '@thaarei/turnstile-contracts';
import { useEffect } from 'react';
import { ButtonLink } from '@/components/button-link';
import { Notice } from '@/components/notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { OrganizationForm, SavedProfile, Structure } from '../configuration/ConfigurationEditors';
import { resumePath, settingsPaths } from '../configuration/routes';
import { needsSession, notice } from '../configuration/shared';
import { useConfiguration } from '../configuration/useConfiguration';

export function Settings({
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
    if (snapshot && snapshot.setup.state !== 'completed')
      window.location.replace(resumePath(snapshot));
  }, [snapshot]);
  if (loading || (snapshot && snapshot.setup.state !== 'completed'))
    return <p role="status">Loading settings…</p>;
  if (!snapshot)
    return (
      <div className="flex flex-col gap-5">
        <h1 className="page-title">Settings are temporarily unavailable</h1>
        <Notice
          message={
            needsSession(failure)
              ? notice(failure)
              : 'We couldn’t load saved configuration. Try again or check your session.'
          }
        />
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => void refresh()}>Try again</Button>
          <Button variant="outline" onClick={onCheck}>
            Check session
          </Button>
          <ButtonLink variant="ghost" href="/">
            Return to Home
          </ButtonLink>
        </div>
      </div>
    );
  const props = { snapshot, session, reload, onSnapshot: setSnapshot, onCheck };
  return (
    <div className="flex flex-col gap-6">
      <span className="eyebrow">SETTINGS</span>
      <nav aria-label="Settings sections" className="flex flex-wrap gap-2">
        {['Setup overview', 'Organization', 'Structure', 'Workspace'].map((label, index) => (
          <ButtonLink
            key={label}
            href={settingsPaths[index] ?? '/settings'}
            variant={path === settingsPaths[index] ? 'secondary' : 'ghost'}
            aria-current={path === settingsPaths[index] ? 'page' : undefined}
          >
            {label}
          </ButtonLink>
        ))}
      </nav>
      {path === settingsPaths[1] ? (
        <OrganizationForm {...props} mode="organization" />
      ) : path === settingsPaths[2] ? (
        <Structure {...props} manage />
      ) : path === settingsPaths[3] ? (
        <OrganizationForm {...props} mode="workspace" />
      ) : (
        <Overview snapshot={snapshot} />
      )}
    </div>
  );
}

function Overview({ snapshot }: { snapshot: ConfigurationSnapshotDto }) {
  const completion = snapshot.setup.completion;
  return (
    <>
      <div>
        <h1 className="page-title">Setup overview</h1>
        <p className="intro">
          Your workspace is activated. You can update its organization and structure whenever
          needed.
        </p>
      </div>
      <SavedProfile snapshot={snapshot} />
      {completion && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Workspace activation</h2>
            </CardTitle>
            <CardDescription>Later configuration changes preserve this activation.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Badge variant="secondary">Activated</Badge>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt>Activated on</dt>
                <dd>
                  <time dateTime={completion.completedAt}>
                    {activationTime(completion.completedAt, snapshot.organization.timeZone)}
                  </time>
                </dd>
              </div>
              <div>
                <dt>Activated by (account ID)</dt>
                <dd className="break-words">{completion.completedBy}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Organization structure</h2>
          </CardTitle>
          <CardDescription>
            {snapshot.units.length - 1} optional sites or departments saved.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll this bounded list.
            tabIndex={0}
            className="flex max-h-60 flex-col gap-2 overflow-auto"
            aria-label="Configured units"
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
          {snapshot.units.length === 1 && (
            <p>Add sites or departments whenever you need them. Your workspace is ready to use.</p>
          )}
          <ButtonLink variant="outline" className="self-start" href={settingsPaths[2]}>
            Manage organization structure
          </ButtonLink>
        </CardContent>
      </Card>
    </>
  );
}

function activationTime(value: string, timeZone: string | null) {
  const date = new Date(value);
  try {
    return date.toLocaleString(undefined, { timeZone: timeZone ?? 'UTC', timeZoneName: 'short' });
  } catch {
    return date.toUTCString();
  }
}
