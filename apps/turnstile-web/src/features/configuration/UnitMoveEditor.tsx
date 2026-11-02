import { unitMoveSchema } from '@thaarei/turnstile-contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { CardContent } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { moveUnit } from './api';
import { type EditorProps, notice, useMounted, useUnsavedEntries } from './shared';
import { createMoveValidator, unitPath } from './structure-model';

export function UnitMoveEditor({
  snapshot,
  session,
  reload,
  onSnapshot,
  onCheck,
  id,
  destination = '',
  onClose,
  onSaved,
}: EditorProps & {
  id: string;
  destination?: string | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const mounted = useMounted();
  const unit = snapshot.units.find((item) => item.id === id);
  const [parentId, setParentId] = useState(destination);
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(snapshot.revision);
  const [busy, setBusy] = useState<'move' | 'read'>();
  const [readRequired, setReadRequired] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const markSaved = useUnsavedEntries(!!parentId && parentId !== unit?.parentId);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const protect = snapshot.setup.state === 'completed' && snapshot.setup.requirementVersion === 2;
  const validateMove = useMemo(
    () => createMoveValidator(snapshot.units, protect),
    [snapshot.units, protect],
  );
  const restriction = parentId
    ? validateMove(id, parentId)
    : 'Choose a destination to preview the move.';
  async function save() {
    if (busy || readRequired || restriction || confirmed) return;
    const parsed = unitMoveSchema.safeParse({ expectedRevision: revision, parentId });
    if (!parsed.success) return;
    setBusy('move');
    setMessage('');
    try {
      const value = await moveUnit(id, parsed.data, session.csrfToken);
      if (!mounted.current) return;
      markSaved();
      onSnapshot(value);
      onSaved();
    } catch (error) {
      if (!mounted.current) return;
      setReadRequired(true);
      setMessage(
        `${notice(error)} Saved structure is shown; the intended destination is kept. Read it back before an explicit retry.`,
      );
    } finally {
      if (mounted.current) setBusy(undefined);
    }
  }
  async function latest() {
    if (busy) return;
    setBusy('read');
    try {
      const value = await reload();
      if (!mounted.current) return;
      setRevision(value.revision);
      setReadRequired(false);
      const saved = value.units.find((item) => item.id === id)?.parentId === parentId;
      setConfirmed(saved);
      if (saved) markSaved();
      setMessage(
        saved
          ? 'Saved destination confirmed. No move was replayed.'
          : 'Latest saved structure loaded. Compare the paths before explicitly confirming again.',
      );
    } catch (error) {
      if (mounted.current) setMessage(notice(error));
    } finally {
      if (mounted.current) setBusy(undefined);
    }
  }
  return (
    <CardContent className="flex flex-col gap-5" data-slot="move-editor">
      <h2 className="section-title" tabIndex={-1} ref={heading}>
        Move unit
      </h2>
      <p>
        Move the whole subtree. Names, types and descendants stay attached; no sibling ordering
        changes.
      </p>
      {message && <Notice message={message} success={confirmed} />}
      <FieldGroup>
        <Field data-disabled={!!busy}>
          <FieldLabel htmlFor="move-search">Find destination</FieldLabel>
          <Input
            id="move-search"
            value={query}
            disabled={!!busy}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Field>
        <Field data-disabled={!!busy || confirmed}>
          <FieldLabel htmlFor="move-parent">Destination</FieldLabel>
          <NativeSelect
            className="w-full"
            id="move-parent"
            value={parentId}
            disabled={!!busy || confirmed}
            aria-describedby="move-parent-help"
            onChange={(event) => {
              setParentId(event.target.value);
              setConfirmed(false);
            }}
          >
            <NativeSelectOption value="">Choose a saved parent</NativeSelectOption>
            {parentId && !snapshot.units.some((item) => item.id === parentId) && (
              <NativeSelectOption value={parentId} disabled>
                Destination no longer available
              </NativeSelectOption>
            )}
            {snapshot.units
              .filter(
                (item) =>
                  item.id === parentId ||
                  unitPath(snapshot.units, item.id)
                    .toLocaleLowerCase()
                    .includes(query.trim().toLocaleLowerCase()),
              )
              .map((item) => {
                const reason = validateMove(id, item.id);
                return (
                  <NativeSelectOption key={item.id} value={item.id} disabled={!!reason}>
                    {unitPath(snapshot.units, item.id)}
                    {reason ? ` — ${reason}` : ''}
                  </NativeSelectOption>
                );
              })}
          </NativeSelect>
          <FieldDescription id="move-parent-help">
            {restriction ?? 'This destination is valid. Review both paths, then confirm.'}
          </FieldDescription>
        </Field>
      </FieldGroup>
      <dl className="flex flex-col gap-3">
        <div>
          <dt>Saved path</dt>
          <dd className="break-words">{unitPath(snapshot.units, id)}</dd>
        </div>
        <div>
          <dt>Proposed path</dt>
          <dd className="break-words">
            {parentId && unit
              ? `${unitPath(snapshot.units, parentId)} / ${unit.name}`
              : 'Choose a destination'}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={!!busy || readRequired || !!restriction || confirmed}
          onClick={() => void save()}
        >
          {busy === 'move' && <Spinner data-icon="inline-start" aria-hidden="true" />}
          {busy === 'move' ? 'Moving…' : 'Confirm move'}
        </Button>
        <Button variant="outline" disabled={!!busy} onClick={onClose}>
          {confirmed ? 'Done' : 'Cancel'}
        </Button>
        {message && (
          <>
            <Button variant="outline" disabled={!!busy} onClick={() => void latest()}>
              {busy === 'read' && <Spinner data-icon="inline-start" aria-hidden="true" />}Read saved
              structure
            </Button>
            <Button variant="outline" disabled={!!busy} onClick={onCheck}>
              Refresh session
            </Button>
          </>
        )}
      </div>
    </CardContent>
  );
}
