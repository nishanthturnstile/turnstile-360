import {
  type ConfigurationErrorDto,
  type ConfigurationSnapshotDto,
  configurationValidationError,
  normalizeConfigurationName,
  organizationPatchSchema,
  SUPPORTED_TIME_ZONES,
} from '@thaarei/turnstile-contracts';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ButtonLink } from '@/components/button-link';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { ProductError } from '../auth/product';
import { saveOrganization } from './api';
import { setupPaths } from './routes';
import {
  clearFieldError,
  type EditorProps,
  errorDetail,
  fieldError,
  needsSession,
  notice,
  useMounted,
  useUnsavedEntries,
} from './shared';

export function SavedProfile({ snapshot }: { snapshot: ConfigurationSnapshotDto }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Saved organization</h2>
        </CardTitle>
        <CardDescription>
          These are the values saved for everyone in your organization.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt>Organization</dt>
            <dd className="break-words">{snapshot.organization.name ?? 'Not saved yet'}</dd>
          </div>
          <div>
            <dt>Time zone</dt>
            <dd className="break-words">{snapshot.organization.timeZone ?? 'Not confirmed yet'}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
export function OrganizationForm({
  snapshot,
  session,
  reload,
  onSnapshot,
  onCheck,
  mode = 'onboarding',
}: EditorProps & { mode?: 'onboarding' | 'organization' | 'workspace' }) {
  const navigate = useNavigate();
  const mounted = useMounted();
  const [name, setName] = useState(snapshot.organization.name ?? '');
  const [zone, setZone] = useState(
    snapshot.organization.timeZone ?? (mode === 'onboarding' ? 'Asia/Kolkata' : ''),
  );
  const [zoneEdited, setZoneEdited] = useState(false);
  const zoneValue = zoneEdited
    ? zone
    : (snapshot.organization.timeZone ?? (mode === 'onboarding' ? 'Asia/Kolkata' : ''));
  const markSaved = useUnsavedEntries(
    (mode !== 'workspace' && name !== (snapshot.organization.name ?? '')) ||
      (mode !== 'organization' &&
        (zoneEdited || !!snapshot.organization.timeZone) &&
        zoneValue !== (snapshot.organization.timeZone ?? '')),
  );
  const [revision, setRevision] = useState(snapshot.revision);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [message, setMessage] = useState('');
  const [statusNotice, setStatusNotice] = useState(false);
  const [errors, setErrors] = useState<ConfigurationErrorDto>();
  const [reconcile, setReconcile] = useState(false);
  const [sessionChanged, setSessionChanged] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLSelectElement>(null);
  const focusPending = useRef(false);
  useEffect(() => {
    if (busy || !focusPending.current) return;
    focusPending.current = false;
    if (fieldError(errors, 'name')) nameRef.current?.focus();
    else if (fieldError(errors, 'timeZone')) zoneRef.current?.focus();
  }, [errors, busy]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || reconcile) return;
    setStatusNotice(false);
    const exit = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'exit';
    // Exiting saves only non-empty values, so clearing a previously saved required
    // field pauses with the saved data instead of failing validation. Continue still
    // submits (and rejects) empty required fields.
    const nameField =
      mode !== 'workspace' && (!exit || normalizeConfigurationName(name) !== '') ? { name } : {};
    const zoneField =
      mode !== 'organization' &&
      (!exit || (zoneValue !== '' && (zoneEdited || !!snapshot.organization.timeZone)))
        ? { timeZone: zoneValue }
        : {};
    if (exit && !('name' in nameField) && !('timeZone' in zoneField)) {
      markSaved();
      void navigate(setupPaths[3]);
      return;
    }
    const parsed = organizationPatchSchema.safeParse({
      expectedRevision: revision,
      ...nameField,
      ...zoneField,
    });
    if (!parsed.success) {
      focusPending.current = true;
      setErrors(configurationValidationError(parsed.error));
      setMessage('Check the highlighted fields.');
      return;
    }
    setBusy(true);
    setExiting(exit);
    setMessage('');
    setErrors(undefined);
    try {
      const value = await saveOrganization(parsed.data, session.csrfToken);
      if (!mounted.current) return;
      onSnapshot(value);
      setRevision(value.revision);
      setSessionChanged(false);
      if (mode === 'onboarding') {
        markSaved();
        void navigate(exit ? setupPaths[3] : setupPaths[1]);
      } else {
        setName(value.organization.name ?? '');
        setZone(value.organization.timeZone ?? '');
        setZoneEdited(false);
        // The server bumps the revision only when a submitted value actually changed.
        const unchanged = value.revision === parsed.data.expectedRevision;
        setStatusNotice(true);
        setMessage(
          unchanged
            ? 'No changes to save.'
            : mode === 'organization'
              ? 'Organization name saved.'
              : 'Time zone saved.',
        );
      }
    } catch (error) {
      if (!mounted.current) return;
      focusPending.current = true;
      setMessage(notice(error));
      setErrors(errorDetail(error));
      setSessionChanged(
        needsSession(error) || (error instanceof ProductError && error.code === 'CSRF_REJECTED'),
      );
      setReconcile(
        error instanceof ProductError &&
          (error.code === 'CONFIGURATION_CONFLICT' || error.status >= 500),
      );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function latest() {
    setBusy(true);
    setReading(true);
    setStatusNotice(false);
    try {
      const value = await reload();
      if (!mounted.current) return;
      setRevision(value.revision);
      setReconcile(false);
      setStatusNotice(true);
      setMessage('Latest saved data loaded. Your entries are kept; compare them before saving.');
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
  const nameError = fieldError(errors, 'name'),
    zoneError = fieldError(errors, 'timeZone');
  return (
    <>
      <div>
        <h1 className="page-title">
          {mode === 'onboarding'
            ? 'Tell us about your organization'
            : mode === 'organization'
              ? 'Organization'
              : 'Workspace regional defaults'}
        </h1>
        <p className="intro">
          {mode === 'onboarding'
            ? 'Choose the name your team recognizes and confirm your organization’s time zone.'
            : mode === 'organization'
              ? 'Change the name your team sees throughout this workspace.'
              : 'Choose the time zone your organization uses. This applies across the workspace.'}
        </p>
      </div>
      {message && <Notice message={message} success={statusNotice} />}
      <form onSubmit={(event) => void save(event)} aria-busy={busy} noValidate>
        <FieldGroup>
          {mode !== 'workspace' && (
            <Field data-invalid={!!nameError} data-disabled={busy}>
              <FieldLabel htmlFor="organization-name">Organization name</FieldLabel>
              <Input
                ref={nameRef}
                id="organization-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setErrors((value) => clearFieldError(value, 'name'));
                }}
                autoComplete="organization"
                required
                disabled={busy}
                aria-invalid={!!nameError}
                aria-describedby={
                  nameError
                    ? 'organization-name-help organization-name-error'
                    : 'organization-name-help'
                }
              />
              <FieldDescription id="organization-name-help">
                Up to 160 characters. Use the name your team recognizes.
              </FieldDescription>
              <FieldError id="organization-name-error">{nameError}</FieldError>
            </Field>
          )}
          {mode !== 'organization' && (
            <Field data-invalid={!!zoneError} data-disabled={busy}>
              <FieldLabel htmlFor="organization-zone">Time zone</FieldLabel>
              <NativeSelect
                ref={zoneRef}
                className="w-full"
                id="organization-zone"
                value={zoneValue}
                onChange={(event) => {
                  setZone(event.target.value);
                  setZoneEdited(true);
                  setErrors((value) => clearFieldError(value, 'timeZone'));
                }}
                required
                disabled={busy}
                aria-invalid={!!zoneError}
                aria-describedby={
                  zoneError
                    ? 'organization-zone-help organization-zone-error'
                    : 'organization-zone-help'
                }
              >
                <NativeSelectOption value="">Choose a time zone</NativeSelectOption>
                {SUPPORTED_TIME_ZONES.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {value === 'Asia/Kolkata'
                      ? 'Indian Standard Time · Kolkata · UTC+05:30'
                      : value.replaceAll('_', ' ')}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription id="organization-zone-help">
                {mode === 'onboarding' && !snapshot.organization.timeZone && !zoneEdited
                  ? 'Suggested for India. Save and continue to confirm, or choose another time zone.'
                  : 'Choose the time zone your organization uses. This choice is confirmed when you save.'}
              </FieldDescription>
              <FieldError id="organization-zone-error">{zoneError}</FieldError>
            </Field>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={busy || reconcile}>
              {busy && !reading && !exiting && (
                <Spinner aria-hidden="true" data-icon="inline-start" />
              )}
              {busy && !reading && !exiting
                ? 'Saving…'
                : mode === 'onboarding'
                  ? 'Save and continue'
                  : 'Save changes'}
            </Button>
            {mode === 'onboarding' && (
              <Button variant="outline" type="submit" value="exit" disabled={busy || reconcile}>
                {busy && !reading && exiting && (
                  <Spinner aria-hidden="true" data-icon="inline-start" />
                )}
                Save and exit
              </Button>
            )}
            <ButtonLink variant="ghost" href={mode === 'onboarding' ? setupPaths[3] : '/settings'}>
              Cancel
            </ButtonLink>
          </div>
        </FieldGroup>
      </form>
      {(reconcile || message) && (
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" disabled={busy} onClick={() => void latest()}>
            {reading && <Spinner aria-hidden="true" data-icon="inline-start" />}
            Load latest saved data
          </Button>
          {sessionChanged && (
            <Button variant="outline" onClick={onCheck}>
              Refresh session
            </Button>
          )}
        </div>
      )}
      {message && <SavedProfile snapshot={snapshot} />}
    </>
  );
}
export { StructureEditor as Structure } from './StructureEditor';
