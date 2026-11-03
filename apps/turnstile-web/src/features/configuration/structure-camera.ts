export type ChartCamera = { x: number; y: number; zoom: number };
export type ChartArea = { width: number; height: number };
export type ChartRect = { x: number; y: number; width: number; height: number };
export const CHART_ZOOM = { min: 0.001, max: 2, step: 0.1 } as const;

export function stepChartZoom(zoom: number, direction: -1 | 1) {
  return Math.max(
    CHART_ZOOM.min,
    Math.min(CHART_ZOOM.max, Number((zoom + direction * CHART_ZOOM.step).toFixed(6))),
  );
}

/** One step per wheel notch; accumulate small trackpad deltas instead of amplifying each event. */
export function createWheelZoomStepper() {
  let accumulated = 0;
  let lastTime = Number.NEGATIVE_INFINITY;
  return (delta: number, time: number): -1 | 0 | 1 => {
    if (!delta || time - lastTime > 160 || Math.sign(delta) !== Math.sign(accumulated))
      accumulated = 0;
    lastTime = time;
    accumulated += delta;
    if (Math.abs(accumulated) < 40) return 0;
    accumulated = 0;
    return delta < 0 ? 1 : -1;
  };
}

/** Keep the same world point beneath the pointer while changing scale. */
export function zoomChart(camera: ChartCamera, zoom: number, anchor: { x: number; y: number }) {
  const next = Math.max(CHART_ZOOM.min, Math.min(CHART_ZOOM.max, zoom));
  const ratio = next / camera.zoom;
  return {
    x: anchor.x - (anchor.x - camera.x) * ratio,
    y: anchor.y - (anchor.y - camera.y) * ratio,
    zoom: next,
  };
}

export function fitChart(chart: ChartArea, area: ChartArea): ChartCamera {
  const zoom = Math.max(
    CHART_ZOOM.min,
    Math.min(1, (area.width - 32) / chart.width, (area.height - 32) / chart.height),
  );
  return {
    x: (area.width - chart.width * zoom) / 2,
    y: (area.height - chart.height * zoom) / 2,
    zoom,
  };
}

/** Reveal keyboard focus/selection without changing scale or canonical card positions. */
export function revealChartRect(
  camera: ChartCamera,
  rect: ChartRect,
  area: ChartArea,
): ChartCamera {
  const left = camera.x + rect.x * camera.zoom;
  const top = camera.y + rect.y * camera.zoom;
  const width = rect.width * camera.zoom;
  const height = rect.height * camera.zoom;
  const offset = (start: number, size: number, available: number) =>
    size > available - 24
      ? (available - size) / 2 - start
      : start < 12
        ? 12 - start
        : start + size > available - 12
          ? available - 12 - start - size
          : 0;
  return {
    ...camera,
    x: camera.x + offset(left, width, area.width),
    y: camera.y + offset(top, height, area.height),
  };
}
