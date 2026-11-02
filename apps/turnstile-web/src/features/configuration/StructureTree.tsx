import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  DragDropVerticalIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { CONFIGURATION_LIMITS } from '@thaarei/turnstile-contracts';
import { type PointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
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
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import {
  createMoveValidator,
  removalRestriction,
  type StructureUnit,
  unitPath,
} from './structure-model';

export type StructureAction = 'rename' | 'delete' | 'move';
/** Presentation and gesture state only: every mutation is confirmed by its owning editor. */
export function StructureTree({
  units,
  protectFirstUnit = false,
  disabled = false,
  selectedId,
  retainedUnit,
  onSelect,
  onAdd,
  onAction,
  onDrop,
  renderEditor,
  organizationHref,
}: {
  units: readonly StructureUnit[];
  protectFirstUnit?: boolean;
  disabled?: boolean;
  selectedId?: string | undefined;
  retainedUnit?: StructureUnit | undefined;
  onSelect: (id: string) => void;
  onAdd: (id: string) => void;
  onAction: (action: StructureAction, id: string) => void;
  onDrop: (id: string, parentId: string) => void;
  renderEditor?: (id: string) => ReactNode;
  organizationHref: string;
}) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState('cards');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<{ id: string; target?: string | undefined }>();
  const [announcement, setAnnouncement] = useState('');
  const gesture = useRef<
    { id: string; pointer: number; x: number; y: number; active: boolean } | undefined
  >(undefined);
  const suppressClick = useRef(false);
  const root = units.find((unit) => unit.type === 'organization');
  const selected = units.find((unit) => unit.id === selectedId);
  const edited = retainedUnit && units.find((unit) => unit.id === retainedUnit.id);
  const validateMove = useMemo(
    () => createMoveValidator(units, protectFirstUnit),
    [units, protectFirstUnit],
  );
  const movable = useMemo(
    () =>
      new Set(
        units
          .filter(
            (unit) =>
              unit.type === 'department' &&
              units.some((target) => !validateMove(unit.id, target.id)),
          )
          .map((unit) => unit.id),
      ),
    [units, validateMove],
  );
  const search = query.trim().toLocaleLowerCase();
  const visible = new Set<string>();
  for (const unit of units) {
    if (!search || unit.name.toLocaleLowerCase().includes(search) || unit.id === edited?.id) {
      visible.add(unit.id);
      for (const ancestor of unit.ancestorIds) visible.add(ancestor);
    }
  }
  function cancelDrag() {
    gesture.current = undefined;
    setDrag(undefined);
  }
  useEffect(() => {
    if (!drag) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        gesture.current = undefined;
        setDrag(undefined);
        setAnnouncement('Move gesture cancelled. Saved structure is unchanged.');
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [drag]);
  // A changing canonical revision or disabled editor cancels any in-flight gesture.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset gesture state when any canonical/editor boundary changes.
  useEffect(() => {
    gesture.current = undefined;
    setDrag(undefined);
    setAnnouncement('');
  }, [units, disabled, search]);
  useEffect(() => {
    const selected = units.find((unit) => unit.id === selectedId);
    if (!selected) return;
    setCollapsed(
      (current) =>
        new Set(
          [...current].filter((id) => !selected.ancestorIds.some((ancestor) => ancestor === id)),
        ),
    );
  }, [units, selectedId]);
  function start(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (disabled || search || event.button !== 0) return;
    suppressClick.current = false;
    gesture.current = {
      id,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function over(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6)
      return;
    current.active = true;
    suppressClick.current = true;
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-unit-row]')?.dataset.unitRow;
    setDrag({ id: current.id, target });
  }
  function drop(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-unit-row]')?.dataset.unitRow;
    cancelDrag();
    if (!current.active) return;
    if (target && !validateMove(current.id, target)) {
      onDrop(current.id, target);
    } else
      setAnnouncement(
        target
          ? (validateMove(current.id, target) ?? '')
          : 'Move cancelled. Drop on a valid unit or use Move to….',
      );
  }
  function node(unit: StructureUnit): ReactNode {
    const missing = !units.some((item) => item.id === unit.id);
    const children = units.filter((item) => item.parentId === unit.id);
    const selectedBranch =
      (selected?.ancestorIds.some((ancestor) => ancestor === unit.id) ?? false) ||
      (edited?.ancestorIds.some((ancestor) => ancestor === unit.id) ?? false);
    const expanded = !!search || selectedBranch || !collapsed.has(unit.id);
    const context = unitPath(units, unit.id);
    const unitContext = `${unit.type === 'site' ? 'Site / Plant' : 'Department'} · ${context}`;
    const removeReason = removalRestriction(units, unit.id, protectFirstUnit);
    const canMove = movable.has(unit.id);
    const dropState = drag ? (validateMove(drag.id, unit.id) ? 'invalid' : 'valid') : undefined;
    return (
      <li
        key={unit.id}
        className={cn('structure-branch', unit.ancestorIds.length > 0 && 'structure-child')}
        style={{ marginInlineStart: `${unit.ancestorIds.length * 0.625}rem` }}
      >
        <div
          data-unit-row={unit.id}
          data-missing={missing || undefined}
          data-selected={selectedId === unit.id || undefined}
          data-drop={dropState}
          data-over={drag?.target === unit.id || undefined}
          className="structure-node"
        >
          <Card size="sm">
            <CardHeader>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {children.length > 0 && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled || !!search || selectedBranch}
                    title={
                      selectedBranch
                        ? 'Close selected details before collapsing this path.'
                        : undefined
                    }
                    aria-label={`${expanded ? 'Collapse' : 'Expand'} ${context}`}
                    aria-expanded={expanded}
                    onClick={() =>
                      setCollapsed((value) => {
                        const next = new Set(value);
                        if (next.has(unit.id)) next.delete(unit.id);
                        else next.add(unit.id);
                        return next;
                      })
                    }
                  >
                    <HugeiconsIcon
                      icon={expanded ? ArrowDown01Icon : ArrowRight01Icon}
                      aria-hidden="true"
                    />
                  </Button>
                )}
                <CardTitle className="min-w-0 flex-1 break-words">
                  {unit.name}
                  {missing && ' — no longer in saved structure'}
                </CardTitle>
                <Badge variant="outline">
                  {unit.type === 'organization'
                    ? 'Organization'
                    : unit.type === 'site'
                      ? 'Site / Plant'
                      : 'Department'}
                </Badge>
              </div>
              <CardDescription className="break-words">{context}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={selectedId === unit.id}
                aria-label={`Details for ${context}`}
                onClick={() => onSelect(unit.id)}
              >
                Details
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  disabled ||
                  units.length >= CONFIGURATION_LIMITS.units ||
                  unit.ancestorIds.length >= CONFIGURATION_LIMITS.depth - 1
                }
                aria-label={`${unit.type === 'organization' && units.length === 1 ? 'Add first unit below' : 'Add below'} ${context}`}
                onClick={() => onAdd(unit.id)}
              >
                {unit.type === 'organization' && units.length === 1
                  ? 'Add first unit'
                  : 'Add below'}
              </Button>
              {unit.type === 'organization' ? (
                <ButtonLink variant="ghost" size="sm" href={organizationHref}>
                  Edit organization
                </ButtonLink>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    aria-label={`Rename ${unit.name} (${unitContext})`}
                    onClick={() => onAction('rename', unit.id)}
                  >
                    Rename
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled || !canMove}
                    aria-label={`Move to… ${context}`}
                    onClick={() => onAction('move', unit.id)}
                  >
                    Move to…
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled || !!removeReason}
                    title={removeReason}
                    aria-label={`Remove ${unit.name} (${unitContext})`}
                    onClick={() => onAction('delete', unit.id)}
                  >
                    Remove
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="structure-drag-handle"
                    disabled={disabled || !!search || !canMove}
                    aria-label={`Drag or move ${context}`}
                    onPointerDown={(event) => start(event, unit.id)}
                    onPointerMove={over}
                    onPointerUp={drop}
                    onPointerCancel={cancelDrag}
                    onLostPointerCapture={cancelDrag}
                    onClick={(event) => {
                      if (suppressClick.current && event.detail !== 0) {
                        suppressClick.current = false;
                        return;
                      }
                      onAction('move', unit.id);
                    }}
                  >
                    <HugeiconsIcon icon={DragDropVerticalIcon} aria-hidden="true" />
                  </Button>
                  {removeReason && (
                    <p className="w-full text-sm text-muted-foreground">{removeReason}</p>
                  )}
                </>
              )}
            </CardContent>
            {renderEditor?.(unit.id)}
          </Card>
        </div>
      </li>
    );
  }
  const rows: StructureUnit[] = [];
  function visit(unit: StructureUnit) {
    if (!visible.has(unit.id)) return;
    rows.push(unit);
    if (
      search ||
      !collapsed.has(unit.id) ||
      selected?.ancestorIds.some((id) => id === unit.id) ||
      edited?.ancestorIds.some((id) => id === unit.id)
    ) {
      for (const child of units.filter((item) => item.parentId === unit.id)) visit(child);
    }
  }
  if (root) visit(root);
  // Keep a removed editor's keyed row until explicit cancellation/readback resolves it.
  // This is labelled transient context; it never enters canonical units or a write body.
  if (retainedUnit && !units.some((unit) => unit.id === retainedUnit.id)) rows.push(retainedUnit);
  return (
    <div
      className={cn(
        'structure-editor flex flex-col gap-5',
        view === 'outline' && 'structure-outline',
      )}
    >
      <FieldGroup className="sm:flex-row">
        <Field>
          <FieldLabel htmlFor="structure-search">Search structure</FieldLabel>
          <Input
            id="structure-search"
            type="search"
            disabled={disabled}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a site or department"
          />
        </Field>
        <Field className="sm:max-w-40">
          <FieldLabel htmlFor="structure-view">Structure view</FieldLabel>
          <NativeSelect
            id="structure-view"
            className="w-full"
            value={view}
            disabled={disabled}
            onChange={(event) => setView(event.target.value)}
          >
            <NativeSelectOption value="cards">Connected cards</NativeSelectOption>
            <NativeSelectOption value="outline">Compact outline</NativeSelectOption>
          </NativeSelect>
        </Field>
      </FieldGroup>
      {search && (
        <p className="text-sm text-muted-foreground">
          Matching units include their ancestors. Clear search to drag; Move to… remains available.
        </p>
      )}
      {announcement && <Notice success message={announcement} />}
      <ul
        aria-label="Saved units"
        className="structure-tree"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users scroll this bounded list with native arrow/Page keys.
        tabIndex={0}
      >
        {rows.length > 0 ? rows.map(node) : <li>No matching units. Try a different search.</li>}
      </ul>
      {drag && (
        <div role="status" className="flex flex-wrap items-center gap-3">
          <span>Choose a highlighted parent. Release to preview; Escape cancels.</span>
          <Button variant="outline" size="sm" onClick={cancelDrag}>
            Cancel gesture
          </Button>
        </div>
      )}
      {units.length === 1 && (
        <p className="text-sm text-muted-foreground">
          No sites or departments saved yet. Add your first unit below the organization.
        </p>
      )}
      {selected && (
        <Card size="sm">
          <CardHeader>
            <CardTitle>
              <h2>Selected unit</h2>
            </CardTitle>
            <CardDescription className="break-words">
              {unitPath(units, selected.id)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt>Name</dt>
                <dd className="break-words">{selected.name}</dd>
              </div>
              <div>
                <dt>Direct children</dt>
                <dd>{units.filter((unit) => unit.parentId === selected.id).length}</dd>
              </div>
            </dl>
          </CardContent>
          <CardFooter>
            <Button variant="ghost" onClick={() => onSelect('')}>
              Close details
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
