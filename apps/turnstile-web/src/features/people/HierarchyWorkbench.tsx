import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  Building03Icon,
  Cancel01Icon,
  DragDropVerticalIcon,
  HierarchyIcon,
  OfficeIcon,
  Search01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ContentLoading } from '@/components/content-loading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { StructureViewport } from '../configuration/StructureViewport';
import { CHART_CARD, layoutStructure } from '../configuration/structure-layout';
import { unitPath } from '../configuration/structure-model';
import { Reload } from './AccessViews';
import { type HierarchyNode, visibleHierarchy } from './structure-hierarchy';

export function HierarchyWorkbench({
  nodes,
  total,
  selectedId,
  disabled = false,
  loading = false,
  onSelect,
  onAdd,
  canAdd,
  createAction,
  inspector,
  feedback,
  onRefresh,
  initialLoading = false,
  canMove = () => false,
  moveTargets,
  onMove,
}: {
  nodes: readonly HierarchyNode[];
  total: number;
  selectedId?: string | undefined;
  disabled?: boolean;
  loading?: boolean;
  onSelect: (id?: string) => void;
  onAdd: (id: string) => void;
  canAdd: (node: HierarchyNode) => boolean;
  createAction?: ReactNode;
  inspector?: ((focus: (id?: string) => void) => ReactNode) | undefined;
  feedback?: ReactNode;
  onRefresh: () => void;
  initialLoading?: boolean;
  canMove?: (node: HierarchyNode) => boolean;
  moveTargets?: (id: string) => ReadonlySet<string>;
  onMove?: (id: string, parent?: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState(() =>
    matchMedia('(max-width: 640px)').matches ? 'outline' : 'chart',
  );
  const [focusId, setFocusId] = useState<string>();
  const [collapsed, setCollapsed] = useState(
    () =>
      new Set(
        nodes
          .filter((n) => n.type === 'department' && nodes.some((c) => c.parentId === n.id))
          .map((n) => n.id),
      ),
  );
  const initialized = useRef(nodes.length > 0);
  const gesture = useRef<
    | {
        id: string;
        pointer: number;
        x: number;
        y: number;
        active: boolean;
        element: HTMLButtonElement;
        targets: ReadonlySet<string>;
        target: string | undefined;
      }
    | undefined
  >(undefined);
  const suppressMoveClick = useRef(false);
  const [drag, setDrag] = useState<{
    id: string;
    targets: ReadonlySet<string>;
    target: string | undefined;
  }>();
  const [announcement, setAnnouncement] = useState('');
  const cancelMove = useCallback(() => {
    const current = gesture.current;
    gesture.current = undefined;
    if (current?.element.hasPointerCapture(current.pointer))
      current.element.releasePointerCapture(current.pointer);
    setDrag(undefined);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: These canonical/editor boundaries cancel pointer ownership even when the cancel callback is stable.
  useEffect(() => {
    cancelMove();
  }, [nodes, disabled, query, cancelMove]);
  useEffect(() => {
    if (!drag) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelMove();
        setAnnouncement('Move cancelled. Saved structure is unchanged.');
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [drag, cancelMove]);
  function startMove(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (
      disabled ||
      query.trim() ||
      !moveTargets ||
      !onMove ||
      event.button !== 0 ||
      gesture.current
    )
      return;
    const targets = moveTargets(id);
    if (!targets.size) {
      setAnnouncement('No eligible destinations are available. Use Move to for details.');
      return;
    }
    suppressMoveClick.current = false;
    gesture.current = {
      id,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      active: false,
      element: event.currentTarget,
      targets,
      target: undefined,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function movePointer(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6)
      return;
    const started = !current.active;
    current.active = true;
    suppressMoveClick.current = true;
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-unit-row]')?.dataset.unitRow;
    if (started || target !== current.target) {
      current.target = target;
      setDrag({ id: current.id, targets: current.targets, target });
    }
  }
  function finishMove(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-unit-row]')?.dataset.unitRow;
    cancelMove();
    if (!current.active) return;
    if (target && current.targets.has(target)) onMove?.(current.id, target);
    else
      setAnnouncement(
        'Move cancelled. Drop on an eligible unit, or use Move to. Saved structure is unchanged.',
      );
  }
  useLayoutEffect(() => {
    if (initialized.current || !nodes.length) return;
    initialized.current = true;
    setCollapsed(
      new Set(
        nodes
          .filter((n) => n.type === 'department' && nodes.some((c) => c.parentId === n.id))
          .map((n) => n.id),
      ),
    );
  }, [nodes]);
  const currentFocus = nodes.some((n) => n.id === focusId) ? focusId : undefined;
  const rows = useMemo(
    () => visibleHierarchy(nodes, query, currentFocus, collapsed, selectedId),
    [nodes, query, currentFocus, collapsed, selectedId],
  );
  const layout = useMemo(() => layoutStructure(rows), [rows]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const children = useMemo(() => {
    const result = new Map<string, HierarchyNode[]>();
    for (const node of nodes)
      if (node.parentId) result.set(node.parentId, [...(result.get(node.parentId) ?? []), node]);
    return result;
  }, [nodes]);
  const selected = byId.get(selectedId ?? '');
  const focused = byId.get(currentFocus ?? '');
  const root = nodes.find((n) => n.type === 'organization');
  const roots = rows.filter((n) => !n.parentId || !rows.some((p) => p.id === n.parentId));
  const ordered: HierarchyNode[] = [];
  const visible = new Set(rows.map((n) => n.id));
  function visit(node: HierarchyNode) {
    ordered.push(node);
    for (const child of children.get(node.id) ?? []) if (visible.has(child.id)) visit(child);
  }
  for (const node of roots) visit(node);
  const matches = query.trim()
    ? nodes.filter(
        (n) =>
          !n.context &&
          (!currentFocus ||
            n.id === currentFocus ||
            n.ancestorIds.some((ancestor) => ancestor === currentFocus)) &&
          n.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      ).length
    : undefined;
  const allCollapsed = roots.length > 0 && roots.every((n) => collapsed.has(n.id));
  function focus(id?: string) {
    setFocusId(id === root?.id ? undefined : id);
    setQuery('');
    onSelect(undefined);
  }
  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  const focusPath = focused
    ? [...focused.ancestorIds, focused.id]
        .map((id) => byId.get(id))
        .filter((n): n is HierarchyNode => !!n)
    : root
      ? [root]
      : [];
  function node(row: HierarchyNode) {
    const count = children.get(row.id)?.length ?? 0;
    const onPath = selected?.ancestorIds.some((ancestor) => ancestor === row.id) ?? false;
    const expanded = !!query.trim() || onPath || !collapsed.has(row.id);
    const position = layout.positions.get(row.id);
    const depth = row.ancestorIds.length - (focused?.ancestorIds.length ?? 0);
    return (
      <li
        key={row.id}
        data-unit-row={row.id}
        data-context={row.context}
        data-selected={selectedId === row.id}
        data-drop={drag?.targets.has(row.id) ? 'valid' : undefined}
        data-over={drag?.target === row.id || undefined}
        className="hierarchy-node"
        style={
          view === 'chart'
            ? {
                position: 'absolute',
                left: position?.x,
                top: position?.y,
                width: CHART_CARD.width,
                height: CHART_CARD.height,
              }
            : ({ '--hierarchy-depth': Math.max(0, depth) } as CSSProperties)
        }
      >
        <div className="hierarchy-node-disclosure">
          {count > 0 && (
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={!!query.trim() || onPath}
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${unitPath(nodes, row.id)}`}
              aria-expanded={expanded}
              title={onPath ? 'The selected unit is inside this branch.' : undefined}
              onClick={() => toggle(row.id)}
            >
              <HugeiconsIcon icon={expanded ? ArrowDown01Icon : ArrowRight01Icon} />
            </Button>
          )}
        </div>
        <Button
          variant="row"
          size={view === 'chart' ? 'surface' : 'row'}
          className="hierarchy-node-select"
          aria-label={`View ${unitPath(nodes, row.id)}`}
          aria-pressed={selectedId === row.id}
          onClick={() => onSelect(row.id)}
        >
          <span className="hierarchy-node-copy">
            <span className="hierarchy-node-kind">
              <HugeiconsIcon
                icon={
                  row.type === 'organization'
                    ? Building03Icon
                    : row.type === 'site'
                      ? OfficeIcon
                      : HierarchyIcon
                }
              />
              {row.type === 'organization'
                ? 'Organization'
                : row.type === 'site'
                  ? 'Site / Plant'
                  : 'Department'}
            </span>
            <h2 title={row.name}>{row.name}</h2>
            <span className="hierarchy-node-meta">
              {row.context
                ? 'Ancestor context'
                : count
                  ? `${count} visible ${count === 1 ? 'unit' : 'units'} directly below`
                  : 'No visible units directly below'}
            </span>
          </span>
        </Button>
        {!row.context && canAdd(row) && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="hierarchy-node-add"
            disabled={disabled}
            aria-label={`Add department below ${unitPath(nodes, row.id)}`}
            onClick={() => onAdd(row.id)}
          >
            <HugeiconsIcon icon={Add01Icon} />
          </Button>
        )}
        {view === 'outline' && row.context && (
          <Badge
            variant="outline"
            title="Provided as ancestor path context; management access is separate."
          >
            Context
          </Badge>
        )}
        {!row.context && canMove(row) && onMove && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="hierarchy-node-move structure-drag-handle"
            disabled={disabled || !!query.trim()}
            aria-label={`Move ${unitPath(nodes, row.id)}`}
            title="Drag to an eligible parent, or click to choose a destination"
            onPointerDown={(event) => startMove(event, row.id)}
            onPointerMove={movePointer}
            onPointerUp={finishMove}
            onPointerCancel={cancelMove}
            onLostPointerCapture={cancelMove}
            onClick={(event) => {
              if (suppressMoveClick.current && event.detail !== 0) {
                event.preventDefault();
                suppressMoveClick.current = false;
                return;
              }
              onMove(row.id);
            }}
          >
            <HugeiconsIcon icon={DragDropVerticalIcon} />
          </Button>
        )}
      </li>
    );
  }
  return (
    <div className="hierarchy-workspace">
      <header className="hierarchy-heading">
        <div>
          <span className="eyebrow">WORKSPACE</span>
          <h1 className="page-title">Structure</h1>
          <p>Your sites and departments, connected.</p>
        </div>
        {createAction}
      </header>
      <div className="hierarchy-toolbar">
        <Field className="hierarchy-search">
          <FieldLabel className="sr-only" htmlFor="hierarchy-search">
            Find a site or department
          </FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <HugeiconsIcon icon={Search01Icon} />
            </InputGroupAddon>
            <InputGroupInput
              id="hierarchy-search"
              placeholder="Find a site or department…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                onSelect(undefined);
              }}
            />
            {query && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton aria-label="Clear structure search" onClick={() => setQuery('')}>
                  <HugeiconsIcon icon={Cancel01Icon} />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
        </Field>
        <ToggleGroup
          aria-label="Structure view"
          value={[view]}
          onValueChange={(values) => {
            const next = values[0];
            if (next) setView(next);
          }}
          variant="outline"
          spacing={0}
        >
          <ToggleGroupItem value="chart">Chart</ToggleGroupItem>
          <ToggleGroupItem value="outline">Outline</ToggleGroupItem>
        </ToggleGroup>
        <Button
          variant="ghost"
          disabled={!nodes.length || !!query.trim()}
          onClick={() => {
            onSelect(undefined);
            setCollapsed(
              allCollapsed
                ? new Set()
                : new Set(nodes.filter((n) => children.has(n.id)).map((n) => n.id)),
            );
          }}
        >
          {allCollapsed ? 'Expand all' : 'Collapse all'}
        </Button>
        <Reload label="Reload structure" loading={loading} onClick={onRefresh} />
      </div>
      <div className="hierarchy-context">
        <nav aria-label="Hierarchy path">
          {focusPath.length ? (
            focusPath.map((n, i) => (
              <span key={n.id}>
                {i > 0 && <HugeiconsIcon icon={ArrowRight01Icon} aria-hidden="true" />}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-current={i === focusPath.length - 1 ? 'location' : undefined}
                  onClick={() => focus(n.id)}
                >
                  {n.name}
                </Button>
              </span>
            ))
          ) : (
            <span>Organization hierarchy</span>
          )}
          {!root && currentFocus && (
            <Button variant="ghost" size="sm" onClick={() => focus()}>
              All available units
            </Button>
          )}
        </nav>
        <span>
          {matches !== undefined
            ? `${matches} matching ${matches === 1 ? 'unit' : 'units'}`
            : `${total} ${total === 1 ? 'unit' : 'units'}`}{' '}
          within your access
        </span>
      </div>
      {feedback}
      <div className="hierarchy-map structure-workbench" data-inspecting={!!inspector}>
        <StructureViewport
          outline={view === 'outline'}
          layout={layout}
          rootId={roots[0]?.id}
          selectedId={selectedId}
          toolsOpen={!!inspector}
          movingUnit={!!drag}
          empty={!rows.length}
          search={query || (currentFocus ? `branch:${currentFocus}` : '')}
          panelSelector=".hierarchy-inspector"
        >
          {rows.length ? (
            <div
              className="hierarchy-layout"
              style={
                view === 'chart'
                  ? { position: 'relative', width: layout.width, height: layout.height }
                  : undefined
              }
            >
              {view === 'chart' && (
                <svg
                  className="structure-connections"
                  width={layout.width}
                  height={layout.height}
                  aria-hidden="true"
                >
                  {rows.map((row) => {
                    const child = layout.positions.get(row.id),
                      parent = row.parentId && layout.positions.get(row.parentId);
                    if (!child || !parent) return null;
                    const x = parent.x + CHART_CARD.width / 2,
                      y = parent.y + CHART_CARD.height,
                      end = child.x + CHART_CARD.width / 2;
                    return (
                      <path
                        key={row.id}
                        data-active={
                          selectedId === row.id ||
                          selected?.ancestorIds.some((ancestor) => ancestor === row.id) ||
                          undefined
                        }
                        d={`M ${x} ${y} V ${y + 32} H ${end} V ${child.y}`}
                      />
                    );
                  })}
                </svg>
              )}
              <ul className="hierarchy-nodes" aria-label="Available organization units">
                {ordered.map(node)}
              </ul>
            </div>
          ) : initialLoading ? (
            <div className="hierarchy-loading">
              <ContentLoading label="Loading authorized hierarchy…" shape="list" />
            </div>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={HierarchyIcon} />
                </EmptyMedia>
                <EmptyTitle>{query ? 'No matching units' : 'No units available'}</EmptyTitle>
                <EmptyDescription>
                  {query
                    ? 'Try a different name or clear your search. Matching units retain their ancestor paths.'
                    : 'Sites and departments appear here when they are within your access. Authorized managers can add the first site.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </StructureViewport>
        {inspector?.(focus)}
        {drag && (
          <p className="hierarchy-drag-status" role="status">
            {drag.target && drag.targets.has(drag.target)
              ? `Release to review moving ${byId.get(drag.id)?.name} below ${byId.get(drag.target)?.name}.`
              : 'Drop on a highlighted parent to review the move. Escape cancels.'}
          </p>
        )}
      </div>
      <div className="hierarchy-legend">
        <span>Organization · Sites / Plants · Departments</span>
        <span>Dashed cards provide ancestor context. Counts include visible units only.</span>
        {focused && (
          <Button variant="ghost" size="sm" onClick={() => focus()}>
            Back to organization
          </Button>
        )}
      </div>
      <p id="structure-canvas-help" className="sr-only">
        Select a unit to view details. Expand branches or search for a name. Ancestor context does
        not grant management access.
      </p>
      <p className="sr-only" role="status">
        {announcement}
      </p>
      {selected && (
        <button type="button" className="sr-only" onClick={() => focus(selected.id)}>
          Focus selected branch
        </button>
      )}
    </div>
  );
}
