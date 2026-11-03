import {
  CONFIGURATION_LIMITS,
  type ConfigurationErrorDto,
  configurationValidationError,
  normalizeConfigurationName,
  type UnitCreate,
  unitCreateSchema,
} from '@thaarei/turnstile-contracts';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ButtonLink } from '@/components/button-link';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { ProductError } from '../auth/product';
import { createUnit } from './api';
import { setupPaths } from './routes';
import { type StructureAction, StructureTree } from './StructureTree';
import {
  clearFieldError,
  type EditorProps,
  errorDetail,
  fieldError,
  notice,
  useMounted,
  useUnsavedEntries,
} from './shared';
import { type StructureUnit, unitPath } from './structure-model';
import { UnitEditor } from './UnitEditor';
import { UnitMoveEditor } from './UnitMoveEditor';

export function StructureEditor({
  snapshot,
  session,
  reload,
  onSnapshot,
  onCheck,
  manage = false,
}: EditorProps & { manage?: boolean }) {
  const mounted = useMounted();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(!manage);
  const [toolsOpen, setToolsOpen] = useState(!manage);
  const markSaved = useUnsavedEntries(name !== '');
  const [type, setType] = useState<'site' | 'department'>('site');
  const [parent, setParent] = useState(snapshot.organization.rootId ?? '');
  const [busy, setBusy] = useState(false);
  const [writeAction, setWriteAction] = useState<'create' | 'exit' | 'retry'>('create');
  const [reading, setReading] = useState(false);
  const [pending, setPending] = useState<{ body: UnitCreate; key: string; exit: boolean }>();
  const [reconcile, setReconcile] = useState(false);
  const [inspected, setInspected] = useState(false);
  const [success, setSuccess] = useState(false);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<ConfigurationErrorDto>();
  const [editing, setEditing] = useState<{
    id: string;
    action: StructureAction;
    destination?: string;
  }>();
  const listRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string>();
  const [retainedUnit, setRetainedUnit] = useState<StructureUnit>();
  const nameRef = useRef<HTMLInputElement>(null);
  const focusPending = useRef(false);
  useEffect(() => {
    if (busy || !focusPending.current) return;
    focusPending.current = false;
    if (fieldError(errors, 'name')) nameRef.current?.focus();
    else if (fieldError(errors, 'parentId')) nameRef.current?.focus();
  }, [errors, busy]);
  const navigate = useNavigate();
  async function create(retry = false, exit = false) {
    if (busy || editing || (!retry && reconcile)) return;
    if (exit && normalizeConfigurationName(name) === '') {
      markSaved();
      void navigate(setupPaths[3]);
      return;
    }
    const parsed = unitCreateSchema.safeParse({
      expectedRevision: snapshot.revision,
      name,
      type,
      parentId: effectiveParent,
    });
    if (!retry && !parsed.success) {
      setToolsOpen(true);
      focusPending.current = true;
      setErrors(configurationValidationError(parsed.error));
      return;
    }
    const request = retry
      ? pending
      : parsed.success
        ? { body: parsed.data, key: crypto.randomUUID(), exit }
        : undefined;
    if (!request) return;
    setInspected(false);
    setWriteAction(retry ? 'retry' : request.exit ? 'exit' : 'create');
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
      setSelected(value.unitId);
      markSaved();
      setSuccess(true);
      setMessage('Request confirmed. The latest saved structure is shown.');
      nameRef.current?.focus();
      if (request.exit) void navigate(setupPaths[3]);
    } catch (error) {
      if (!mounted.current) return;
      setToolsOpen(true);
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
    setReading(true);
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
      setSuccess(false);
      setToolsOpen(true);
      setMessage(notice(error));
    } finally {
      if (mounted.current) {
        setBusy(false);
        setReading(false);
      }
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
  const nameError = fieldError(errors, 'name'),
    parentError = fieldError(errors, 'parentId');
  const createPanel =
    creating && !editing ? (
      <Card size="sm" variant="embedded">
        <CardHeader>
          <CardTitle>
            <h2>New unit</h2>
          </CardTitle>
          <CardDescription>
            Add one unit at a time. Keep adding here to build out your structure.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {message && (!success || !!pending || reconcile) && (
            <Notice message={message} success={success} />
          )}
          <form
            id="unit-create-form"
            onSubmit={(event) => {
              event.preventDefault();
              void create(
                false,
                (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'exit',
              );
            }}
            aria-busy={busy}
            noValidate
          >
            <FieldGroup className="gap-4">
              <Field data-disabled={busy || !!pending || !!editing}>
                <FieldLabel htmlFor="unit-type">Unit type</FieldLabel>
                <NativeSelect
                  className="w-full"
                  id="unit-type"
                  value={type}
                  disabled={busy || !!pending || !!editing}
                  onChange={(event) => {
                    setType(event.target.value as 'site' | 'department');
                    setErrors((value) => clearFieldError(value, 'parentId'));
                  }}
                >
                  <NativeSelectOption
                    value="site"
                    disabled={effectiveParent !== snapshot.organization.rootId}
                  >
                    {manage ? 'Site' : 'Site / Plant'}
                  </NativeSelectOption>
                  <NativeSelectOption value="department">Department</NativeSelectOption>
                </NativeSelect>
              </Field>
              <FieldDescription>
                {type === 'site'
                  ? 'An office, plant or branch.'
                  : 'A functional group, such as Operations or Finance.'}
              </FieldDescription>
              {manage ? (
                <Field data-disabled={busy || !!pending} data-invalid={!!parentError}>
                  <FieldLabel htmlFor="unit-parent">Parent unit</FieldLabel>
                  <NativeSelect
                    id="unit-parent"
                    className="w-full"
                    value={pending?.body.parentId ?? effectiveParent}
                    disabled={busy || !!pending}
                    aria-invalid={!!parentError}
                    aria-describedby={parentError ? 'unit-parent-error' : undefined}
                    onChange={(event) => {
                      setParent(event.target.value);
                      setErrors((value) => clearFieldError(value, 'parentId'));
                    }}
                  >
                    {parents.map((unit) => (
                      <NativeSelectOption key={unit.id} value={unit.id}>
                        {unitPath(snapshot.units, unit.id)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <FieldError id="unit-parent-error">{parentError}</FieldError>
                </Field>
              ) : (
                <p className="break-words text-sm">
                  Adding under {unitPath(snapshot.units, pending?.body.parentId ?? effectiveParent)}
                  {parentError && <span role="alert">{parentError}</span>}
                </p>
              )}
              <Field data-invalid={!!nameError} data-disabled={busy || !!pending || !!editing}>
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
                  placeholder={type === 'site' ? 'e.g. North plant' : 'e.g. Operations'}
                  required
                  aria-invalid={!!nameError}
                  aria-describedby={nameError ? 'unit-name-help unit-name-error' : 'unit-name-help'}
                />
                <FieldDescription id="unit-name-help">
                  Unique within this parent. Up to 120 characters.
                </FieldDescription>
                <FieldError id="unit-name-error">{nameError}</FieldError>
              </Field>
              <div className="flex flex-wrap items-center gap-2">
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
                  {busy && !reading && writeAction === 'create' && (
                    <Spinner aria-hidden="true" data-icon="inline-start" />
                  )}
                  {busy && !reading && writeAction === 'create' ? 'Saving…' : 'Add unit'}
                </Button>
                {manage && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy || !!pending || reconcile}
                    onClick={() => {
                      setName('');
                      setErrors(undefined);
                      setMessage('');
                      setCreating(false);
                      markSaved();
                      listRef.current?.focus();
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </FieldGroup>
          </form>
          {!editing && (reconcile || !!pending || (!success && !!message)) && (
            <div className="flex flex-wrap gap-3">
              {pending && (
                <Button disabled={busy} onClick={() => void create(true)}>
                  {busy && !reading && writeAction === 'retry' && (
                    <Spinner aria-hidden="true" data-icon="inline-start" />
                  )}
                  Retry same request
                </Button>
              )}
              <Button variant="outline" disabled={busy} onClick={() => void latest()}>
                {reading && <Spinner aria-hidden="true" data-icon="inline-start" />}
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
        </CardContent>
      </Card>
    ) : undefined;
  return (
    <div className={cn('structure-page', manage && 'structure-page-managed')}>
      <header className={manage ? 'structure-page-heading' : undefined}>
        <h1 className="page-title">{manage ? 'Organization structure' : 'First unit'}</h1>
        <p className={manage ? 'structure-page-description' : 'intro'}>
          {manage
            ? 'Your locations and departments, connected. Select a card or open Structure tools to make changes.'
            : 'Add a Site / Plant or Department under your organization. One saved unit is required to finish setup; you can build the rest later.'}
        </p>
      </header>
      {!editing && success && message && !pending && !reconcile && (
        <p role="status" className="sr-only">
          {message}
        </p>
      )}
      <div ref={listRef} tabIndex={-1} className="structure-chart-region">
        <StructureTree
          units={snapshot.units}
          protectFirstUnit={
            snapshot.setup.state === 'completed' && snapshot.setup.requirementVersion === 2
          }
          disabled={busy || !!pending || reconcile || !!editing || name !== ''}
          selectedId={selected}
          retainedUnit={editing ? retainedUnit : undefined}
          createPanel={createPanel}
          toolsOpen={toolsOpen}
          onToolsOpenChange={setToolsOpen}
          hasDraft={name !== ''}
          onSelect={(id) => {
            setSelected(id);
            if (!name && !pending && !reconcile) setCreating(false);
          }}
          organizationHref={manage ? '/settings/organization' : setupPaths[0]}
          onAdd={(id) => {
            setToolsOpen(true);
            setCreating(true);
            setParent(id);
            if (snapshot.units.find((unit) => unit.id === id)?.type !== 'organization')
              setType('department');
            setSelected(id);
            requestAnimationFrame(() => nameRef.current?.focus());
          }}
          onAction={(action, id) => {
            setToolsOpen(true);
            setRetainedUnit(snapshot.units.find((unit) => unit.id === id));
            setSelected(id);
            setCreating(false);
            setEditing({ action, id });
          }}
          onDrop={(id, destination) => {
            setToolsOpen(true);
            setRetainedUnit(snapshot.units.find((unit) => unit.id === id));
            setSelected(id);
            setCreating(false);
            setEditing({ action: 'move', id, destination });
          }}
          renderEditor={(id) =>
            editing?.id !== id ? null : editing.action === 'move' ? (
              <UnitMoveEditor
                key={`${id}:move`}
                {...{ snapshot, session, reload, onSnapshot, onCheck }}
                id={id}
                onAttention={() => setToolsOpen(true)}
                embedded
                destination={editing.destination}
                onClose={() => {
                  setEditing(undefined);
                  listRef.current?.focus();
                }}
                onSaved={() => {
                  setEditing(undefined);
                  setSuccess(true);
                  setMessage('Unit moved. Saved structure updated.');
                  listRef.current?.focus();
                }}
              />
            ) : (
              <UnitEditor
                key={`${id}:${editing.action}`}
                {...{ snapshot, session, reload, onCheck, onSnapshot }}
                id={id}
                onAttention={() => setToolsOpen(true)}
                embedded
                action={editing.action}
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
            )
          }
        />
      </div>
      {!manage && (
        <div className="flex flex-wrap gap-3">
          {snapshot.setup.nextStep === 'review' ? (
            <ButtonLink href={setupPaths[2]}>Continue to review</ButtonLink>
          ) : (
            <Button disabled>Continue to review</Button>
          )}
          <ButtonLink variant="outline" href={setupPaths[0]}>
            Back
          </ButtonLink>
          <Button
            variant="ghost"
            type="button"
            onClick={() => void create(false, true)}
            disabled={busy || !!pending || reconcile || !!editing}
          >
            {busy && !reading && writeAction === 'exit' && (
              <Spinner aria-hidden="true" data-icon="inline-start" />
            )}
            {busy && !reading && writeAction === 'exit' ? 'Saving…' : 'Save and exit'}
          </Button>
        </div>
      )}
    </div>
  );
}
