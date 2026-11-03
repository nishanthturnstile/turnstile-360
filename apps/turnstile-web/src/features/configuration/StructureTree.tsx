import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Building03Icon,
  Delete02Icon,
  DragDropVerticalIcon,
  HierarchyIcon,
  OfficeIcon,
  PencilEdit02Icon,
  Search01Icon,
  Settings02Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { CONFIGURATION_LIMITS } from '@thaarei/turnstile-contracts';
import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ButtonLink } from '@/components/button-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';
import { StructureViewport } from './StructureViewport';
import { CHART_CARD, layoutStructure } from './structure-layout';
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
  createPanel,
  toolsOpen,
  onToolsOpenChange,
  hasDraft = false,
  initialView = 'cards',
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
  createPanel?: ReactNode;
  toolsOpen: boolean;
  onToolsOpenChange: (open: boolean) => void;
  hasDraft?: boolean;
  initialView?: 'cards' | 'outline';
}) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState(initialView);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<{ id: string; target?: string | undefined }>();
  const [announcement, setAnnouncement] = useState('');
  const gesture = useRef<
    { id: string; pointer: number; x: number; y: number; active: boolean } | undefined
  >(undefined);
  const suppressClick = useRef(false);
  const root = units.find((unit) => unit.type === 'organization');
  const selected = units.find((unit) => unit.id === selectedId) ?? root;
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
    const selected = units.find((unit) => unit.id === selectedId) ?? root;
    if (!selected) return;
    setCollapsed(
      (current) =>
        new Set(
          [...current].filter((id) => !selected.ancestorIds.some((ancestor) => ancestor === id)),
        ),
    );
  }, [units, selectedId, root]);
  function start(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (gesture.current || disabled || search || event.button !== 0) return;
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
  // Retain a removed editor's context until the owner explicitly resolves its readback.
  if (retainedUnit && !units.some((unit) => unit.id === retainedUnit.id)) rows.push(retainedUnit);
  const layout = layoutStructure(rows);
  const siteCount = units.filter((unit) => unit.type === 'site').length;
  const departmentCount = units.filter((unit) => unit.type === 'department').length;
  const activeEditor = retainedUnit && renderEditor?.(retainedUnit.id);
  const current = selected ?? retainedUnit;
  const direct = units.filter((unit) => unit.parentId === current?.id);
  const descendants = units.filter((unit) =>
    unit.ancestorIds.some((ancestor) => ancestor === current?.id),
  );
  const removeReason = current && removalRestriction(units, current.id, protectFirstUnit);
  function select(id: string) {
    onToolsOpenChange(true);
    onSelect(id);
  }
  function node(unit: StructureUnit): ReactNode {
    const missing = !units.some((item) => item.id === unit.id);
    const children = units.filter((item) => item.parentId === unit.id);
    const selectedBranch =
      (selected?.ancestorIds.some((ancestor) => ancestor === unit.id) ?? false) ||
      (edited?.ancestorIds.some((ancestor) => ancestor === unit.id) ?? false);
    const expanded = !!search || selectedBranch || !collapsed.has(unit.id);
    const context = unitPath(units, unit.id);
    const position = layout.positions.get(unit.id);
    const disclosure = children.length > 0 && (
      <Button
        variant="ghost"
        size={view === 'outline' ? 'icon-sm' : 'icon-xs'}
        className={view === 'outline' ? 'structure-outline-disclosure' : undefined}
        disabled={disabled || !!search || selectedBranch}
        title={
          selectedBranch ? 'The selected unit is inside this branch.' : 'Show or hide units below'
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
        <HugeiconsIcon icon={expanded ? ArrowDown01Icon : ArrowRight01Icon} aria-hidden="true" />
      </Button>
    );
    return (
      <li
        key={unit.id}
        className="structure-branch"
        style={
          view === 'cards'
            ? {
                left: position?.x,
                top: position?.y,
                width: CHART_CARD.width,
                height: CHART_CARD.height,
              }
            : ({ '--structure-depth': unit.ancestorIds.length } as CSSProperties)
        }
      >
        <div
          data-unit-row={unit.id}
          data-selected={current?.id === unit.id || undefined}
          data-missing={missing || undefined}
          data-drop={drag ? (validateMove(drag.id, unit.id) ? 'invalid' : 'valid') : undefined}
          data-over={drag?.target === unit.id || undefined}
          className="structure-node"
        >
          <Button
            variant={view === 'outline' ? 'row' : 'surface'}
            size={view === 'outline' ? 'row' : 'surface'}
            className={view === 'outline' ? 'structure-outline-select' : undefined}
            disabled={disabled}
            aria-pressed={current?.id === unit.id}
            aria-label={`Details for ${context}`}
            title={context}
            onClick={() => select(unit.id)}
          >
            {view === 'outline' ? (
              <>
                <span className="structure-outline-identity">
                  <span className="structure-outline-icon">
                    <HugeiconsIcon icon={unitIcon(unit.type)} aria-hidden="true" />
                  </span>
                  <span className="structure-outline-copy">
                    <span className="structure-outline-name truncate">{unit.name}</span>
                    <span className="structure-outline-mobile-kind">
                      {missing ? 'No longer in saved structure' : unitLabel(unit.type)}
                    </span>
                  </span>
                </span>
                <span className="structure-outline-kind">
                  {missing ? 'Removed' : unitLabel(unit.type)}
                </span>
                <span
                  className="structure-outline-count"
                  title={
                    missing
                      ? 'No longer in saved structure'
                      : `${children.length} direct ${children.length === 1 ? 'unit' : 'units'} below`
                  }
                >
                  {missing ? '—' : children.length}
                </span>
              </>
            ) : (
              <span className="structure-unit-copy">
                <span className="structure-unit-kind">
                  <HugeiconsIcon icon={unitIcon(unit.type)} aria-hidden="true" />
                  {unitLabel(unit.type)}
                </span>
                <span className="structure-unit-name">{unit.name}</span>
                <span className="structure-unit-meta">
                  {missing
                    ? 'No longer in saved structure'
                    : children.length > 0
                      ? `${children.length} ${children.length === 1 ? 'unit' : 'units'} below`
                      : 'No units below'}
                </span>
              </span>
            )}
          </Button>
          {view === 'outline' && (
            <>
              <span className="structure-outline-guides" aria-hidden="true">
                {unit.ancestorIds.map((ancestor, depth) => {
                  const branch = unit.ancestorIds[depth + 1] ?? unit.id;
                  const siblings = rows.filter((item) => item.parentId === ancestor);
                  const continues = siblings.at(-1)?.id !== branch;
                  const elbow = depth === unit.ancestorIds.length - 1;
                  return continues || elbow ? (
                    <span
                      key={ancestor}
                      className="structure-outline-guide"
                      data-elbow={elbow || undefined}
                      data-last={!continues || undefined}
                      style={{ '--structure-guide-depth': depth } as CSSProperties}
                    />
                  ) : null;
                })}
              </span>
              {disclosure}
            </>
          )}
          <div className="structure-node-tools">
            <Button
              variant="ghost"
              size={view === 'outline' ? 'icon-sm' : 'icon-xs'}
              disabled={
                disabled ||
                units.length >= CONFIGURATION_LIMITS.units ||
                unit.ancestorIds.length >= CONFIGURATION_LIMITS.depth - 1
              }
              aria-label={`${unit.type === 'organization' && units.length === 1 ? 'Add first unit below' : 'Add below'} ${context}`}
              title="Add a unit below"
              onClick={() => {
                onToolsOpenChange(true);
                onAdd(unit.id);
              }}
            >
              <HugeiconsIcon icon={Add01Icon} aria-hidden="true" />
            </Button>
            {unit.type !== 'organization' && (
              <Button
                variant="ghost"
                size={view === 'outline' ? 'icon-sm' : 'icon-xs'}
                className="structure-drag-handle"
                disabled={disabled || !!search || !movable.has(unit.id)}
                aria-label={`Drag or move ${context}`}
                title="Drag to a new parent, or click to choose one"
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
            )}
            {view === 'cards' && disclosure}
          </div>
        </div>
      </li>
    );
  }
  return (
    <div className="structure-editor" data-tools-open={toolsOpen || undefined}>
      <div className="structure-workbench">
        <section className="structure-map" aria-label="Organization structure map">
          <StructureViewport
            outline={view === 'outline'}
            layout={{ ...layout, height: units.length === 1 && !search ? 440 : layout.height }}
            rootId={root?.id}
            selectedId={selectedId ?? root?.id}
            toolsOpen={toolsOpen}
            movingUnit={!!drag}
            empty={rows.length === 0}
            search={search}
          >
            {rows.length ? (
              <div
                className="structure-chart-bounds"
                style={
                  view === 'cards'
                    ? {
                        width: layout.width,
                        height: units.length === 1 && !search ? 440 : layout.height,
                      }
                    : ({
                        '--structure-max-depth': Math.max(
                          ...rows.map((unit) => unit.ancestorIds.length),
                        ),
                      } as CSSProperties)
                }
              >
                <div
                  className="structure-chart-layout"
                  style={
                    view === 'cards' ? { width: layout.width, height: layout.height } : undefined
                  }
                >
                  {view === 'cards' && (
                    <svg
                      className="structure-connections"
                      width={layout.width}
                      height={layout.height}
                      aria-hidden="true"
                    >
                      {rows.map((unit) => {
                        const child = layout.positions.get(unit.id);
                        const parent = unit.parentId && layout.positions.get(unit.parentId);
                        if (!child || !parent) return null;
                        const x = parent.x + CHART_CARD.width / 2;
                        const y = parent.y + CHART_CARD.height;
                        const end = child.x + CHART_CARD.width / 2;
                        return (
                          <path
                            key={unit.id}
                            data-active={
                              current?.id === unit.id ||
                              current?.ancestorIds.some((ancestor) => ancestor === unit.id) ||
                              undefined
                            }
                            d={`M ${x} ${y} V ${y + 32} H ${end} V ${child.y}`}
                          />
                        );
                      })}
                    </svg>
                  )}
                  <div className={view === 'outline' ? 'structure-outline-list' : undefined}>
                    {view === 'outline' && (
                      <div className="structure-outline-heading" aria-hidden="true">
                        <span>Unit name</span>
                        <span className="structure-outline-kind">Type</span>
                        <span className="structure-outline-count">Units below</span>
                        <span className="sr-only">Actions</span>
                      </div>
                    )}
                    <ul aria-label="Saved units" className="structure-tree">
                      {rows.map(node)}
                    </ul>
                  </div>
                </div>
                {units.length === 1 && !search && (
                  <Empty className="structure-first-unit">
                    <EmptyHeader>
                      <EmptyTitle>Give your organization a shape</EmptyTitle>
                      <EmptyDescription>
                        Add a site for a physical location, or start with a department such as
                        Operations.
                      </EmptyDescription>
                    </EmptyHeader>
                    <Button
                      variant="outline"
                      disabled={disabled}
                      onClick={() => {
                        if (root) {
                          onToolsOpenChange(true);
                          onAdd(root.id);
                        }
                      }}
                    >
                      <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" aria-hidden="true" />
                      Add first unit
                    </Button>
                  </Empty>
                )}
              </div>
            ) : (
              <Empty className="w-auto">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <HugeiconsIcon icon={Search01Icon} aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>No matching units</EmptyTitle>
                  <EmptyDescription>
                    Try another name or clear your search to see the full organization.
                  </EmptyDescription>
                </EmptyHeader>
                <Button variant="outline" onClick={() => setQuery('')}>
                  Clear search
                </Button>
              </Empty>
            )}
          </StructureViewport>
          <p id="structure-canvas-help" className="structure-chart-caption">
            {siteCount} {siteCount === 1 ? 'site / plant' : 'sites / plants'} · {departmentCount}{' '}
            {departmentCount === 1 ? 'department' : 'departments'}
            <span className="sr-only">
              . Select a unit for actions, or use its plus button to add below it.
            </span>
          </p>
        </section>
        <Collapsible
          open={toolsOpen}
          onOpenChange={onToolsOpenChange}
          className="structure-operations"
          render={<aside aria-label="Unit details and actions" />}
        >
          <CollapsibleTrigger
            render={<Button variant="ghost" size="lg" className="structure-tools-trigger" />}
            aria-label={toolsOpen ? 'Collapse structure tools' : 'Expand structure tools'}
          >
            <HugeiconsIcon icon={Settings02Icon} data-icon="inline-start" aria-hidden="true" />
            <span>Structure tools</span>
            {hasDraft && <Badge variant="secondary">Draft</Badge>}
            {!hasDraft && !toolsOpen && search && <Badge variant="secondary">Filtered</Badge>}
            {!hasDraft && (createPanel || activeEditor) && (
              <span className="structure-tools-context">
                {activeEditor ? 'Editing' : 'New unit'}
              </span>
            )}
            <HugeiconsIcon
              icon={toolsOpen ? ArrowUp01Icon : ArrowDown01Icon}
              data-icon="inline-end"
              aria-hidden="true"
            />
          </CollapsibleTrigger>
          <CollapsibleContent keepMounted className="structure-operations-panel">
            <div className="structure-operations-content">
              <FieldGroup className="structure-tools-fields gap-3">
                <Field>
                  <FieldLabel htmlFor="structure-search" className="sr-only">
                    Search structure
                  </FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="structure-search"
                      type="search"
                      disabled={disabled}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Find a site or department…"
                    />
                    <InputGroupAddon>
                      <HugeiconsIcon icon={Search01Icon} aria-hidden="true" />
                    </InputGroupAddon>
                  </InputGroup>
                </Field>
                <Field>
                  <FieldLabel htmlFor="structure-view" className="sr-only">
                    Structure view
                  </FieldLabel>
                  <NativeSelect
                    id="structure-view"
                    className="w-full"
                    value={view}
                    disabled={disabled}
                    onChange={(event) =>
                      setView(event.target.value === 'outline' ? 'outline' : 'cards')
                    }
                  >
                    <NativeSelectOption value="cards">Organization chart</NativeSelectOption>
                    <NativeSelectOption value="outline">Compact outline</NativeSelectOption>
                  </NativeSelect>
                </Field>
              </FieldGroup>
              {search && (
                <p className="structure-search-help" role="status">
                  Matching units include their parent paths. Clear search to drag.
                </p>
              )}
              <Separator />
              {activeEditor ||
                createPanel ||
                (current ? (
                  <Card size="sm" variant="embedded">
                    <CardHeader>
                      <Badge variant="secondary" className="justify-self-start">
                        {unitLabel(current.type)}
                      </Badge>
                      <CardTitle>
                        <h2 className="structure-detail-title">{current.name}</h2>
                      </CardTitle>
                      <CardDescription>{unitDescription(current.type)}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-5">
                      {current.type !== 'organization' && (
                        <p className="structure-detail-path">{unitPath(units, current.id)}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {direct.length} direct units · {descendants.length} total below
                      </p>
                      <Button
                        className="w-full"
                        disabled={
                          disabled ||
                          units.length >= CONFIGURATION_LIMITS.units ||
                          current.ancestorIds.length >= CONFIGURATION_LIMITS.depth - 1
                        }
                        onClick={() => onAdd(current.id)}
                      >
                        <HugeiconsIcon
                          icon={Add01Icon}
                          data-icon="inline-start"
                          aria-hidden="true"
                        />
                        Add a unit
                      </Button>
                      <Separator />
                      {current.type === 'organization' ? (
                        <ButtonLink variant="ghost" href={organizationHref}>
                          Edit organization details
                          <HugeiconsIcon
                            icon={ArrowRight01Icon}
                            data-icon="inline-end"
                            aria-hidden="true"
                          />
                        </ButtonLink>
                      ) : (
                        <div className="flex flex-col items-start gap-2">
                          <Button
                            variant="ghost"
                            disabled={disabled}
                            aria-label={`Rename ${current.name} (${unitLabel(current.type)} · ${unitPath(units, current.id)})`}
                            onClick={() => onAction('rename', current.id)}
                          >
                            <HugeiconsIcon
                              icon={PencilEdit02Icon}
                              data-icon="inline-start"
                              aria-hidden="true"
                            />
                            Rename unit
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={disabled || !movable.has(current.id)}
                            aria-label={`Move to… ${unitPath(units, current.id)}`}
                            onClick={() => onAction('move', current.id)}
                          >
                            <HugeiconsIcon
                              icon={HierarchyIcon}
                              data-icon="inline-start"
                              aria-hidden="true"
                            />
                            Move to…
                          </Button>
                          <Button
                            variant="destructive"
                            disabled={disabled || !!removeReason}
                            aria-label={`Remove ${current.name} (${unitLabel(current.type)} · ${unitPath(units, current.id)})`}
                            onClick={() => onAction('delete', current.id)}
                          >
                            <HugeiconsIcon
                              icon={Delete02Icon}
                              data-icon="inline-start"
                              aria-hidden="true"
                            />
                            Remove unit
                          </Button>
                          {removeReason && (
                            <p className="text-xs text-muted-foreground">{removeReason}</p>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ) : (
                  <p>Select a card to see its details.</p>
                ))}
              <Separator />
              <details className="structure-help">
                <summary>About sites and departments</summary>
                <StructureGuide />
              </details>
            </div>
          </CollapsibleContent>
        </Collapsible>
        {(drag || announcement) && (
          <div className="structure-gesture-feedback" role="status">
            {drag ? (
              <>
                <span>Release on a highlighted parent to preview. Escape cancels.</span>
                <Button variant="outline" size="sm" onClick={cancelDrag}>
                  Cancel gesture
                </Button>
              </>
            ) : (
              announcement
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function unitLabel(type: StructureUnit['type']) {
  return type === 'organization' ? 'Organization' : type === 'site' ? 'Site / Plant' : 'Department';
}
function unitIcon(type: StructureUnit['type']) {
  return type === 'organization' ? Building03Icon : type === 'site' ? OfficeIcon : UserGroupIcon;
}
function unitDescription(type: StructureUnit['type']) {
  return type === 'organization'
    ? 'The starting point for every site and department in your workspace.'
    : type === 'site'
      ? 'A physical location, such as an office, plant or branch. Sites sit directly under your organization.'
      : 'A functional group, such as Operations or Finance. Departments can sit under your organization, a site or another department.';
}
function StructureGuide() {
  return (
    <section className="structure-guide" aria-label="How organization structure works">
      <div>
        <h3>Sites / Plants</h3>
        <p>Where work happens. Add offices, branches or plants directly below the organization.</p>
      </div>
      <div>
        <h3>Departments</h3>
        <p>
          How work is grouped. Add functions below the organization, a site or another department.
        </p>
      </div>
    </section>
  );
}
