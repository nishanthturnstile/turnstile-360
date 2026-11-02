import {
  type ConfigurationErrorDto,
  type ConfigurationSnapshotDto,
  configurationValidationError,
  unitRenameSchema,
} from '@thaarei/turnstile-contracts';
import { useEffect, useRef, useState } from 'react';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ProductError } from '../auth/product';
import { deleteUnit, renameUnit } from './api';
import {
  clearFieldError,
  type EditorProps,
  errorDetail,
  fieldError,
  notice,
  useMounted,
  useUnsavedEntries,
} from './shared';
import { removalRestriction } from './structure-model';

export function UnitEditor({
  snapshot,
  session,
  reload,
  onCheck,
  id,
  action,
  onClose,
  onSaved,
}: EditorProps & {
  id: string;
  action: 'rename' | 'delete';
  onClose: () => void;
  onSaved: (value: ConfigurationSnapshotDto) => void;
}) {
  const mounted = useMounted();
  const unit = snapshot.units.find((item) => item.id === id);
  const [name, setName] = useState(unit?.name ?? '');
  const [revision, setRevision] = useState(snapshot.revision);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [reconcile, setReconcile] = useState(false);
  const [message, setMessage] = useState('');
  const [statusNotice, setStatusNotice] = useState(false);
  const [errors, setErrors] = useState<ConfigurationErrorDto>();
  const nameRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useUnsavedEntries(action === 'rename' && name !== unit?.name);
  useEffect(() => {
    if (action === 'rename') nameRef.current?.focus();
    else headingRef.current?.focus();
  }, [action]);
  useEffect(() => {
    if (!busy && fieldError(errors, 'name')) nameRef.current?.focus();
  }, [errors, busy]);
  const removalReason = removalRestriction(
    snapshot.units,
    id,
    snapshot.setup.state === 'completed' && snapshot.setup.requirementVersion === 2,
  );
  const removable = !removalReason;
  async function save() {
    if (
      busy ||
      reconcile ||
      !unit ||
      unit.type === 'organization' ||
      (action === 'delete' && !removable)
    )
      return;
    setStatusNotice(false);
    const parsed = unitRenameSchema.safeParse({ expectedRevision: revision, name });
    if (action === 'rename' && !parsed.success) {
      setErrors(configurationValidationError(parsed.error));
      setMessage('Check the highlighted name.');
      return;
    }
    setBusy(true);
    setMessage('');
    setErrors(undefined);
    try {
      const value =
        action === 'rename' && parsed.success
          ? await renameUnit(id, parsed.data, session.csrfToken)
          : await deleteUnit(id, revision, session.csrfToken);
      if (mounted.current) onSaved(value);
    } catch (error) {
      if (!mounted.current) return;
      setMessage(notice(error));
      setErrors(errorDetail(error));
      setReconcile(
        !(error instanceof ProductError) ||
          error.status >= 500 ||
          error.code === 'CONFIGURATION_NOT_FOUND' ||
          (error.detail?.code === 'CONFIGURATION_CONFLICT' &&
            error.detail.reason !== 'duplicate_name'),
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
      setErrors(undefined);
      const exists = value.units.some((item) => item.id === id);
      setReconcile(!exists);
      setStatusNotice(true);
      setMessage(
        exists
          ? 'Latest saved data loaded. Compare it with your entry before trying again.'
          : 'This unit no longer exists. Cancel to return to the saved structure.',
      );
    } catch (error) {
      if (mounted.current) setMessage(notice(error));
    } finally {
      if (mounted.current) {
        setBusy(false);
        setReading(false);
      }
    }
  }
  const nameError = fieldError(errors, 'name');
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 ref={headingRef} tabIndex={-1}>
            {action === 'rename' ? 'Rename unit' : 'Remove unit?'}
          </h2>
        </CardTitle>
        <CardDescription>
          {action === 'rename'
            ? 'Only the name changes. Unit type and parent stay the same.'
            : snapshot.setup.state === 'completed'
              ? 'Remove only an unused leaf unit. Your organization will stay activated.'
              : 'Remove only an unused leaf unit. Save a first unit before finishing setup.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="break-words">Saved name: {unit?.name ?? 'No longer in saved structure'}</p>
        {unit && (
          <p className="break-words text-sm text-muted-foreground">
            {unit.ancestorIds
              .map((ancestor) => snapshot.units.find((item) => item.id === ancestor)?.name)
              .join(' / ')}
          </p>
        )}
        {message && <Notice message={message} success={statusNotice} />}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          aria-busy={busy}
          noValidate
        >
          <FieldGroup>
            {action === 'rename' && (
              <Field data-invalid={!!nameError} data-disabled={busy}>
                <FieldLabel htmlFor="rename-unit-name">New unit name</FieldLabel>
                <Input
                  ref={nameRef}
                  id="rename-unit-name"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setErrors((value) => clearFieldError(value, 'name'));
                  }}
                  disabled={busy}
                  required
                  aria-invalid={!!nameError}
                  aria-describedby={
                    nameError ? 'rename-unit-help rename-unit-error' : 'rename-unit-help'
                  }
                />
                <FieldDescription id="rename-unit-help">
                  Up to 120 characters. Names must be unique under the same parent.
                </FieldDescription>
                <FieldError id="rename-unit-error">{nameError}</FieldError>
              </Field>
            )}
            {action === 'delete' && !removable && <p role="status">{removalReason}</p>}
            <div className="flex flex-wrap gap-3">
              <Button
                type="submit"
                variant={action === 'delete' ? 'destructive' : 'default'}
                disabled={busy || reconcile || !unit || (action === 'delete' && !removable)}
              >
                {busy && !reading && <Spinner aria-hidden="true" data-icon="inline-start" />}
                {busy && !reading
                  ? 'Saving…'
                  : action === 'rename'
                    ? 'Save unit name'
                    : 'Remove unit'}
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
            </div>
          </FieldGroup>
        </form>
        {message && (
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" disabled={busy} onClick={() => void latest()}>
              {reading && <Spinner aria-hidden="true" data-icon="inline-start" />}
              Load latest saved data
            </Button>
            <Button variant="outline" disabled={busy} onClick={onCheck}>
              Refresh session
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
