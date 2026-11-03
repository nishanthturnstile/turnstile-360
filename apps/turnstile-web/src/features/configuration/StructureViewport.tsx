import { Add01Icon, HandIcon, MinusSignIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Fragment,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  CHART_ZOOM,
  type ChartCamera,
  createWheelZoomStepper,
  fitChart,
  revealChartRect,
  stepChartZoom,
  zoomChart,
} from './structure-camera';
import { CHART_CARD, type layoutStructure } from './structure-layout';

type Point = { x: number; y: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Transient camera only. Navigation never changes units or submits a command. */
export function StructureViewport({
  outline,
  layout,
  rootId,
  selectedId,
  toolsOpen,
  movingUnit,
  empty,
  search,
  children,
}: {
  outline: boolean;
  layout: ReturnType<typeof layoutStructure>;
  rootId: string | undefined;
  selectedId: string | undefined;
  toolsOpen: boolean;
  movingUnit: boolean;
  empty: boolean;
  search: string;
  children: ReactNode;
}) {
  const paneRef = useRef<HTMLElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const camera = useRef<ChartCamera>({ x: 0, y: 32, zoom: 1 });
  const initialized = useRef(false);
  const latest = useRef({ layout, movingUnit, empty });
  latest.current = { layout, movingUnit, empty };
  const pan = useRef<{ id: number; start: Point; camera: ChartCamera } | undefined>(undefined);
  const touches = useRef(new Map<number, Point>());
  const pinch = useRef<{ center: Point; distance: number; camera: ChartCamera } | undefined>(
    undefined,
  );
  const unitTouch = useRef<number | undefined>(undefined);
  const suppressClick = useRef(false);
  const space = useRef(false);
  const hovered = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [hand, setHand] = useState(false);
  const [zoom, setZoom] = useState(1);

  function area() {
    const pane = paneRef.current;
    const bounds = pane?.querySelector<HTMLElement>('.structure-chart-bounds');
    const panel = pane
      ?.closest('.structure-workbench')
      ?.querySelector<HTMLElement>('.structure-operations');
    const reserved = bounds
      ? Number.parseFloat(getComputedStyle(bounds).paddingInlineEnd) || 0
      : pane && panel && getComputedStyle(pane).getPropertyValue('--structure-tools-space')
        ? panel.getBoundingClientRect().width +
          2 * Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
        : 0;
    return {
      width: Math.max(160, (pane?.clientWidth ?? 320) - reserved),
      height: Math.max(80, (pane?.clientHeight ?? 480) - 80),
    };
  }
  function apply(next: ChartCamera) {
    camera.current = next;
    if (layerRef.current)
      layerRef.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.zoom})`;
    if (paneRef.current) {
      paneRef.current.style.backgroundPosition = `${next.x}px ${next.y}px`;
      const grid = Math.max(12, 18 * next.zoom);
      paneRef.current.style.backgroundSize = `${grid}px ${grid}px`;
    }
    setZoom((current) => (current === next.zoom ? current : next.zoom));
  }
  function zoomTo(next: number, anchor?: Point) {
    const available = area();
    apply(
      zoomChart(
        camera.current,
        next,
        anchor ?? { x: available.width / 2, y: available.height / 2 },
      ),
    );
  }
  function fit() {
    apply(fitChart(latest.current.layout, area()));
  }
  function cancelNavigation() {
    const pane = paneRef.current;
    const captured = [...touches.current.keys(), ...(pan.current ? [pan.current.id] : [])];
    pan.current = undefined;
    pinch.current = undefined;
    touches.current.clear();
    unitTouch.current = undefined;
    if (pane) {
      delete pane.dataset.panning;
      for (const id of captured) if (pane.hasPointerCapture(id)) pane.releasePointerCapture(id);
    }
  }
  // Camera updates write only the layer transform; the bounded unit tree does not rerender per pan.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Event handlers use refs; mode changes own their lifecycle.
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane || outline) return;
    if (!initialized.current) {
      const available = area();
      const root = rootId ? layout.positions.get(rootId) : undefined;
      const initialZoom = Math.max(0.65, fitChart(layout, available).zoom);
      apply({
        x: available.width / 2 - ((root?.x ?? 0) + CHART_CARD.width / 2) * initialZoom,
        y: 32,
        zoom: initialZoom,
      });
      initialized.current = true;
    } else apply(camera.current);
    const observer = new ResizeObserver(() => {
      const active = pane.querySelector<HTMLElement>('[data-unit-row]:has(:focus-visible)');
      if (active) reveal(active);
    });
    observer.observe(pane);
    return () => {
      observer.disconnect();
      cancelNavigation();
    };
  }, [outline, empty]);

  const selected =
    (selectedId ? layout.positions.get(selectedId) : undefined) ??
    (rootId ? layout.positions.get(rootId) : undefined);
  const selectedX = selected ? selected.x : undefined;
  const selectedY = selected ? selected.y : undefined;
  // Selection/layout changes may reveal a card; zoom/pan never recenter it behind the user's pointer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Depend on canonical selection coordinates, not fresh layout objects or camera updates.
  useLayoutEffect(() => {
    if (!outline && selectedX !== undefined && selectedY !== undefined)
      apply(revealChartRect(camera.current, { x: selectedX, y: selectedY, ...CHART_CARD }, area()));
  }, [outline, selectedId, selectedX, selectedY, toolsOpen]);

  // Filtering can remove the selected card and dramatically narrow the layout.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Fit once per query, not during user pan/zoom or editor reconciliation.
  useLayoutEffect(() => {
    if (!outline && search && !empty) fit();
  }, [outline, search]);

  // A non-passive, canvas-local listener prevents browser page zoom only over this chart.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Native listeners read current camera/layout/gesture refs.
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane || outline) return;
    const wheelStep = createWheelZoomStepper();
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (pan.current || pinch.current || latest.current.movingUnit || latest.current.empty) return;
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pane.clientHeight : 1;
      if (event.ctrlKey || event.metaKey) {
        const direction = wheelStep(event.deltaY * factor, event.timeStamp);
        if (!direction) return;
        const rect = pane.getBoundingClientRect();
        zoomTo(stepChartZoom(camera.current.zoom, direction), {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      } else {
        wheelStep(0, event.timeStamp);
        apply({
          ...camera.current,
          x: camera.current.x - (event.shiftKey ? event.deltaY : event.deltaX) * factor,
          y: camera.current.y - (event.shiftKey ? 0 : event.deltaY) * factor,
        });
      }
    };
    const release = () => {
      space.current = false;
      setSpaceHeld(false);
      cancelNavigation();
    };
    const down = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        release();
        setHand(false);
      }
      if (
        event.code === 'Space' &&
        (event.target === pane || (event.target === document.body && hovered.current))
      ) {
        event.preventDefault();
        space.current = true;
        setSpaceHeld(true);
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === 'Control' || event.key === 'Meta') wheelStep(0, event.timeStamp);
      if (event.code === 'Space') {
        space.current = false;
        setSpaceHeld(false);
      }
    };
    pane.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    return () => {
      pane.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
      space.current = false;
    };
  }, [outline]);

  function point(event: PointerEvent<HTMLElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function pointerDown(event: PointerEvent<HTMLElement>) {
    if (outline) return;
    if (!pan.current && touches.current.size === 0 && unitTouch.current === undefined)
      suppressClick.current = false;
    if (empty || movingUnit || (event.button !== 0 && event.button !== 1)) return;
    const target = event.target as Element;
    const unit = target.closest('[data-unit-row]');
    const interactive = target.closest('button,a,input,select,textarea,summary');
    if (!unit && interactive) return;
    if (event.pointerType === 'touch') {
      if (unitTouch.current !== undefined) return;
      if (touches.current.size >= 2) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!hand && !space.current && target.closest('.structure-drag-handle')) {
        unitTouch.current = event.pointerId;
        return;
      }
      touches.current.set(event.pointerId, point(event));
      if (touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        if (!a || !b) return;
        pinch.current = {
          center: midpoint(a, b),
          distance: Math.max(1, distance(a, b)),
          camera: camera.current,
        };
        pan.current = undefined;
        suppressClick.current = true;
        for (const id of touches.current.keys()) event.currentTarget.setPointerCapture(id);
      }
    }
    if (!pinch.current) {
      if (pan.current || (unit && !hand && !space.current && event.button !== 1)) return;
      pan.current = { id: event.pointerId, start: point(event), camera: camera.current };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.focus({ preventScroll: true });
    }
    event.currentTarget.dataset.panning = 'true';
    event.preventDefault();
    event.stopPropagation();
  }
  function pointerMove(event: PointerEvent<HTMLElement>) {
    const position = point(event);
    if (touches.current.has(event.pointerId)) touches.current.set(event.pointerId, position);
    if (pinch.current) {
      const [a, b] = [...touches.current.values()];
      if (!a || !b) return;
      const center = midpoint(a, b);
      const initial = pinch.current;
      const next = zoomChart(
        initial.camera,
        (initial.camera.zoom * distance(a, b)) / initial.distance,
        initial.center,
      );
      apply({
        ...next,
        x: next.x + center.x - initial.center.x,
        y: next.y + center.y - initial.center.y,
      });
    } else if (pan.current?.id === event.pointerId) {
      const initial = pan.current;
      if (distance(position, initial.start) > 4) suppressClick.current = true;
      apply({
        ...initial.camera,
        x: initial.camera.x + position.x - initial.start.x,
        y: initial.camera.y + position.y - initial.start.y,
      });
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }
  function pointerEnd(event: PointerEvent<HTMLElement>) {
    touches.current.delete(event.pointerId);
    if (pan.current?.id === event.pointerId || pinch.current) {
      event.stopPropagation();
      if (!pinch.current || touches.current.size === 0) cancelNavigation();
    }
    if (unitTouch.current === event.pointerId) unitTouch.current = undefined;
  }
  function reveal(element: HTMLElement) {
    const id = element.closest<HTMLElement>('[data-unit-row]')?.dataset.unitRow;
    const position = id && latest.current.layout.positions.get(id);
    if (position) apply(revealChartRect(camera.current, { ...position, ...CHART_CARD }, area()));
  }

  return (
    <>
      <section
        ref={paneRef}
        className={cn('structure-canvas', outline ? 'structure-outline' : 'structure-whiteboard')}
        data-hand={(!outline && (hand || spaceHeld)) || undefined}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Focused chart supports arrow pan/zoom; outline retains native keyboard scrolling.
        tabIndex={0}
        aria-label={outline ? 'Organization outline' : 'Organization chart'}
        aria-describedby={
          outline ? 'structure-canvas-help' : 'structure-canvas-help structure-navigation-help'
        }
        onPointerDownCapture={pointerDown}
        onPointerEnter={() => {
          hovered.current = true;
        }}
        onPointerLeave={() => {
          hovered.current = false;
        }}
        onPointerMoveCapture={outline ? undefined : pointerMove}
        onPointerUpCapture={pointerEnd}
        onPointerCancelCapture={(event) => {
          if (
            pan.current?.id === event.pointerId ||
            touches.current.has(event.pointerId) ||
            unitTouch.current === event.pointerId
          )
            cancelNavigation();
        }}
        onLostPointerCapture={(event) => {
          if (pan.current?.id === event.pointerId || touches.current.has(event.pointerId))
            cancelNavigation();
        }}
        onClickCapture={(event) => {
          if (
            !outline &&
            event.detail !== 0 &&
            (suppressClick.current ||
              (hand && (event.target as Element).closest('[data-unit-row]')))
          ) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onFocusCapture={(event) => {
          if (
            !outline &&
            event.target !== event.currentTarget &&
            event.target.matches(':focus-visible')
          )
            reveal(event.target);
        }}
        onKeyDown={(event) => {
          if (outline || empty || event.target !== event.currentTarget || movingUnit) return;
          const step = event.shiftKey ? 160 : 60;
          const offsets: Record<string, Point> = {
            ArrowLeft: { x: step, y: 0 },
            ArrowRight: { x: -step, y: 0 },
            ArrowUp: { x: 0, y: step },
            ArrowDown: { x: 0, y: -step },
          };
          const delta = offsets[event.key];
          if (delta)
            apply({
              ...camera.current,
              x: camera.current.x + delta.x,
              y: camera.current.y + delta.y,
            });
          else if (event.key === '+' || event.key === '=')
            zoomTo(stepChartZoom(camera.current.zoom, 1));
          else if (event.key === '-') zoomTo(stepChartZoom(camera.current.zoom, -1));
          else if (event.key === '0') zoomTo(1);
          else if (event.key === 'Home') fit();
          else return;
          event.preventDefault();
        }}
      >
        {outline || empty ? (
          <Fragment key="native-list">{children}</Fragment>
        ) : (
          <div
            key="chart-camera"
            className="structure-camera-layer"
            ref={layerRef}
            style={{ width: layout.width, height: layout.height }}
          >
            {children}
          </div>
        )}
      </section>
      {!outline && (
        <>
          <span id="structure-navigation-help" className="sr-only">
            Drag empty canvas to pan. Hand tool or Space plus drag pans from cards. Scroll to pan;
            Control or Command plus scroll to zoom at the pointer. Touch: drag canvas or pinch with
            two fingers. With the canvas focused, use arrow keys to pan, plus/minus to zoom, 0 for
            100%, or Home to fit. Unit moves use their dedicated handle and confirmation.
          </span>
          <TooltipProvider>
            <fieldset className="structure-navigation" aria-label="Chart navigation">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant={hand ? 'default' : 'ghost'}
                      size="icon-sm"
                      aria-label="Hand tool"
                      aria-pressed={hand}
                      disabled={movingUnit || empty}
                      onClick={() => {
                        cancelNavigation();
                        setHand((value) => !value);
                      }}
                    />
                  }
                >
                  <HugeiconsIcon icon={HandIcon} aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent>Hand tool · drag anywhere to pan</TooltipContent>
              </Tooltip>
              <Separator orientation="vertical" />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Zoom out"
                disabled={zoom <= CHART_ZOOM.min || movingUnit || empty}
                onClick={() => zoomTo(stepChartZoom(camera.current.zoom, -1))}
              >
                <HugeiconsIcon icon={MinusSignIcon} aria-hidden="true" />
              </Button>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Reset zoom to 100%"
                      disabled={movingUnit || empty}
                      onClick={() => zoomTo(1)}
                    />
                  }
                >
                  <output className="structure-zoom" aria-label="Zoom level">
                    {zoom < 0.1 ? (zoom * 100).toFixed(1) : Math.round(zoom * 100)}%
                  </output>
                </TooltipTrigger>
                <TooltipContent>Reset zoom to 100%</TooltipContent>
              </Tooltip>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Zoom in"
                disabled={zoom >= CHART_ZOOM.max || movingUnit || empty}
                onClick={() => zoomTo(stepChartZoom(camera.current.zoom, 1))}
              >
                <HugeiconsIcon icon={Add01Icon} aria-hidden="true" />
              </Button>
              <Separator orientation="vertical" />
              <Button variant="ghost" size="sm" disabled={movingUnit || empty} onClick={fit}>
                Fit chart
              </Button>
            </fieldset>
          </TooltipProvider>
          <span className="structure-navigation-hint" aria-hidden="true">
            Drag canvas to pan · Ctrl/⌘ + scroll to zoom
          </span>
        </>
      )}
    </>
  );
}
