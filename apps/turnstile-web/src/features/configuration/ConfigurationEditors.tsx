import {
  CONFIGURATION_LIMITS,
  type ConfigurationErrorDto,
  type ConfigurationSnapshotDto,
  configurationValidationError,
  normalizeConfigurationName,
  organizationPatchSchema,
  SUPPORTED_TIME_ZONES,
  type UnitCreate,
  unitCreateSchema,
} from '@thaarei/turnstile-contracts';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ButtonLink } from '@/components/button-link';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { ProductError } from '../auth/product';
import { createUnit, saveOrganization } from './api';
import { resumePath, setupPaths } from './routes';
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
import { UnitEditor } from './UnitEditor';

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
  const mounted = useMounted();
  const [name, setName] = useState(snapshot.organization.name ?? '');
  const [zone, setZone] = useState(snapshot.organization.timeZone ?? '');
  useUnsavedEntries(
    (mode !== 'workspace' && name !== (snapshot.organization.name ?? '')) ||
      (mode !== 'organization' && zone !== (snapshot.organization.timeZone ?? '')),
  );
  const [revision, setRevision] = useState(snapshot.revision);
  const [busy, setBusy] = useState(false);
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
    const zoneField = mode !== 'organization' && (!exit || zone !== '') ? { timeZone: zone } : {};
    if (exit && !('name' in nameField) && !('timeZone' in zoneField)) {
      window.location.assign(setupPaths[3]);
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
    setMessage('');
    setErrors(undefined);
    try {
      const value = await saveOrganization(parsed.data, session.csrfToken);
      if (!mounted.current) return;
      onSnapshot(value);
      setRevision(value.revision);
      setSessionChanged(false);
      if (mode === 'onboarding') window.location.assign(exit ? setupPaths[3] : setupPaths[1]);
      else {
        setName(value.organization.name ?? '');
        setZone(value.organization.timeZone ?? '');
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
      if (mounted.current) setBusy(false);
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
            ? 'Start with a name and a confirmed time zone. You can add sites and departments later.'
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
                value={zone}
                onChange={(event) => {
                  setZone(event.target.value);
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
                    {value.replaceAll('_', ' ')}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription id="organization-zone-help">
                Choose the time zone your organization uses. This choice is confirmed when you save.
              </FieldDescription>
              <FieldError id="organization-zone-error">{zoneError}</FieldError>
            </Field>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={busy || reconcile}>
              {busy ? 'Saving…' : mode === 'onboarding' ? 'Save and continue' : 'Save changes'}
            </Button>
            {mode === 'onboarding' && (
              <Button variant="outline" type="submit" value="exit" disabled={busy || reconcile}>
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
export function Structure({
  snapshot,
  session,
  reload,
  onSnapshot,
  onCheck,
  manage = false,
}: EditorProps & { manage?: boolean }) {
  const mounted = useMounted();
  const [name, setName] = useState('');
  useUnsavedEntries(name !== '');
  const [type, setType] = useState<'site' | 'department'>('site');
  const [parent, setParent] = useState(snapshot.organization.rootId ?? '');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ body: UnitCreate; key: string }>();
  const [reconcile, setReconcile] = useState(false);
  const [inspected, setInspected] = useState(false);
  const [success, setSuccess] = useState(false);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<ConfigurationErrorDto>();
  const [editing, setEditing] = useState<{ id: string; action: 'rename' | 'delete' }>();
  const listRef = useRef<HTMLUListElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const parentRef = useRef<HTMLSelectElement>(null);
  const focusPending = useRef(false);
  useEffect(() => {
    if (busy || !focusPending.current) return;
    focusPending.current = false;
    if (fieldError(errors, 'name')) nameRef.current?.focus();
    else if (fieldError(errors, 'parentId')) parentRef.current?.focus();
  }, [errors, busy]);
  async function create(retry = false) {
    if (busy || editing || (!retry && reconcile)) return;
    const parsed = unitCreateSchema.safeParse({
      expectedRevision: snapshot.revision,
      name,
      type,
      parentId: effectiveParent,
    });
    if (!retry && !parsed.success) {
      focusPending.current = true;
      setErrors(configurationValidationError(parsed.error));
      return;
    }
    const request = retry
      ? pending
      : parsed.success
        ? { body: parsed.data, key: crypto.randomUUID() }
        : undefined;
    if (!request) return;
    setInspected(false);
    setBusy(true);
    setErrors(undefined);
    setMessage('');
    setSuccess(false);
    try {
      const value = await createUnit(request.body, request.key, session.csrfToken);
      if (!mounted.current) return;
      onSnapshot(value.configuration);
      setPending(undefined);
      setReconcile(false);
      setInspected(false);
      setName('');
      setSuccess(true);
      setMessage('Request confirmed. The latest saved structure is shown.');
      nameRef.current?.focus();
    } catch (error) {
      if (!mounted.current) return;
      focusPending.current = true;
      setMessage(notice(error));
      setErrors(errorDetail(error));
      const uncertain = !(error instanceof ProductError) || error.status >= 500;
      setPending(uncertain ? request : undefined);
      setReconcile(
        uncertain ||
          (error instanceof ProductError &&
            error.code === 'CONFIGURATION_CONFLICT' &&
            !(
              error.detail?.code === 'CONFIGURATION_CONFLICT' &&
              error.detail.reason === 'duplicate_name'
            )),
      );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function latest() {
    setBusy(true);
    try {
      await reload();
      if (!mounted.current) return;
      setInspected(true);
      if (!pending) setReconcile(false);
      setSuccess(true);
      setMessage(
        'Latest saved structure loaded. Review it before retrying or starting a new entry.',
      );
    } catch (error) {
      if (!mounted.current) return;
      setMessage(notice(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const parents = snapshot.units.filter(
    (unit) =>
      unit.ancestorIds.length < CONFIGURATION_LIMITS.depth - 1 &&
      (type !== 'site' || unit.type === 'organization'),
  );
  const effectiveParent = parents.some((unit) => unit.id === parent)
    ? parent
    : (parents.find((unit) => unit.type === 'organization')?.id ?? '');
  const unitContext = (unit: ConfigurationSnapshotDto['units'][number]) =>
    unit.type === 'organization'
      ? 'Organization root'
      : `${unit.type === 'site' ? 'Site' : 'Department'} · ${unit.ancestorIds.map((id) => snapshot.units.find((item) => item.id === id)?.name).join(' / ')}`;
  const nameError = fieldError(errors, 'name'),
    parentError = fieldError(errors, 'parentId');
  return (
    <>
      <div>
        <h1 className="page-title">
          {manage ? 'Organization structure' : 'Add structure, if you need it'}
        </h1>
        <p className="intro">
          {manage
            ? 'Manage sites and departments under your organization. Change the organization root’s name in Organization settings.'
            : 'Your organization already has a root. Sites and departments are optional; skipping this step keeps everything you’ve saved.'}
        </p>
      </div>
      {!editing && message && <Notice message={message} success={success} />}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Saved structure</h2>
          </CardTitle>
          <CardDescription>
            {snapshot.units.length} of {CONFIGURATION_LIMITS.units} units, including your
            organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul
            ref={listRef}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll this bounded list.
            tabIndex={0}
            className="flex max-h-80 flex-col gap-3 overflow-auto"
            aria-label="Saved units"
          >
            {snapshot.units.map((unit) => (
              <li key={unit.id} className="flex flex-col gap-1">
                <span className="break-words">{unit.name}</span>
                <span className="text-sm text-muted-foreground">{unitContext(unit)}</span>
                {manage && unit.type !== 'organization' && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || !!pending || reconcile || !!editing}
                      aria-label={`Rename ${unit.name} (${unitContext(unit)})`}
                      onClick={() => setEditing({ id: unit.id, action: 'rename' })}
                    >
                      Rename
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        busy ||
                        !!pending ||
                        reconcile ||
                        !!editing ||
                        snapshot.units.some((child) => child.parentId === unit.id)
                      }
                      aria-label={`Remove ${unit.name} (${unitContext(unit)})`}
                      onClick={() => setEditing({ id: unit.id, action: 'delete' })}
                    >
                      Remove
                    </Button>
                    {snapshot.units.some((child) => child.parentId === unit.id) && (
                      <span className="text-sm text-muted-foreground">
                        Remove child units first.
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      {editing && (
        <UnitEditor
          key={`${editing.id}:${editing.action}`}
          {...{ snapshot, session, reload, onCheck }}
          id={editing.id}
          action={editing.action}
          onSnapshot={onSnapshot}
          onClose={() => {
            setEditing(undefined);
            listRef.current?.focus();
          }}
          onSaved={(value) => {
            onSnapshot(value);
            setEditing(undefined);
            setSuccess(true);
            setMessage(editing.action === 'rename' ? 'Unit name saved.' : 'Unit removed.');
            listRef.current?.focus();
          }}
        />
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
        aria-busy={busy}
        noValidate
      >
        <FieldGroup>
          <Field data-disabled={busy || !!pending}>
            <FieldLabel htmlFor="unit-type">Unit type</FieldLabel>
            <NativeSelect
              className="w-full"
              id="unit-type"
              value={type}
              disabled={busy || !!pending || !!editing}
              onChange={(event) => {
                setType(event.target.value as 'site' | 'department');
                setParent(snapshot.organization.rootId ?? '');
                setErrors((value) => clearFieldError(value, 'parentId'));
              }}
            >
              <NativeSelectOption value="site">Site</NativeSelectOption>
              <NativeSelectOption value="department">Department</NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field data-invalid={!!parentError} data-disabled={busy || !!pending}>
            <FieldLabel htmlFor="unit-parent">Parent</FieldLabel>
            <NativeSelect
              ref={parentRef}
              className="w-full"
              id="unit-parent"
              value={effectiveParent}
              disabled={busy || !!pending || !!editing}
              onChange={(event) => {
                setParent(event.target.value);
                setErrors((value) => clearFieldError(value, 'parentId'));
              }}
              aria-invalid={!!parentError}
              aria-describedby={parentError ? 'unit-parent-error' : undefined}
            >
              {parents.map((unit) => (
                <NativeSelectOption key={unit.id} value={unit.id}>
                  {[
                    ...unit.ancestorIds.map(
                      (id) => snapshot.units.find((item) => item.id === id)?.name,
                    ),
                    unit.name,
                  ].join(' / ')}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldError id="unit-parent-error">{parentError}</FieldError>
          </Field>
          <Field data-invalid={!!nameError} data-disabled={busy || !!pending}>
            <FieldLabel htmlFor="unit-name">Unit name</FieldLabel>
            <Input
              ref={nameRef}
              id="unit-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setErrors((value) => clearFieldError(value, 'name'));
              }}
              disabled={busy || !!pending || !!editing}
              required
              aria-invalid={!!nameError}
              aria-describedby={nameError ? 'unit-name-help unit-name-error' : 'unit-name-help'}
            />
            <FieldDescription id="unit-name-help">
              Up to 120 characters. Names must be unique under the same parent.
            </FieldDescription>
            <FieldError id="unit-name-error">{nameError}</FieldError>
          </Field>
          <Button
            className="self-start"
            type="submit"
            disabled={
              busy ||
              !!pending ||
              reconcile ||
              !!editing ||
              snapshot.units.length >= CONFIGURATION_LIMITS.units
            }
          >
            {busy ? 'Saving…' : 'Add unit'}
          </Button>
        </FieldGroup>
      </form>
      {!editing && (reconcile || message) && (
        <div className="flex flex-wrap gap-3">
          {pending && (
            <Button disabled={busy} onClick={() => void create(true)}>
              Retry same request
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={() => void latest()}>
            Load latest saved data
          </Button>
          {pending && inspected && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setPending(undefined);
                setReconcile(false);
                setInspected(false);
                setMessage('Start a new entry only after checking the saved units above.');
              }}
            >
              Start a new entry
            </Button>
          )}
          <Button variant="outline" onClick={onCheck}>
            Refresh session
          </Button>
        </div>
      )}
      {!manage && (
        <div className="flex flex-wrap gap-3">
          <ButtonLink href={resumePath(snapshot)}>
            {snapshot.setup.nextStep === 'organization'
              ? 'Continue to organization'
              : 'Continue to review'}
          </ButtonLink>
          <ButtonLink variant="ghost" href={setupPaths[3]}>
            Save and exit
          </ButtonLink>
        </div>
      )}
    </>
  );
}
