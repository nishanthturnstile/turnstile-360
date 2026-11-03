import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWheelZoomStepper,
  fitChart,
  revealChartRect,
  stepChartZoom,
  zoomChart,
} from '../src/features/configuration/structure-camera.ts';

test('discrete zoom uses ten percentage points from arbitrary Fit levels and clamps at limits', () => {
  assert.equal(stepChartZoom(0.74, 1), 0.84);
  assert.equal(stepChartZoom(0.84, -1), 0.74);
  assert.equal(stepChartZoom(1, 1), 1.1);
  assert.equal(stepChartZoom(1.96, 1), 2);
  assert.equal(stepChartZoom(0.066, -1), 0.001);
});

test('wheel notches cannot amplify their magnitude into a multi-step zoom', () => {
  const step = createWheelZoomStepper();
  assert.equal(step(-120, 0), 1);
  assert.equal(step(-1000, 20), 1);
  assert.equal(step(1000, 40), -1);
  assert.equal(step(0, 50), 0);
});

test('smooth wheel input accumulates into steps and discards stale, reversed or released input', () => {
  const step = createWheelZoomStepper();
  for (const time of [0, 10, 20]) assert.equal(step(-10, time), 0);
  assert.equal(step(-10, 30), 1);
  assert.equal(step(-30, 40), 0);
  assert.equal(step(10, 50), 0);
  assert.equal(step(30, 60), -1);
  assert.equal(step(-30, 70), 0);
  assert.equal(step(-10, 240), 0);
  assert.equal(step(0, 250), 0);
  assert.equal(step(-30, 260), 0);
  assert.equal(step(-10, 270), 1);
});

test('pointer-anchored zoom preserves the world point, including clamped extremes', () => {
  const camera = { x: -360, y: 85, zoom: 0.7 };
  const pointer = { x: 219, y: 311 };
  for (const scale of [0.0001, 0.3, 1.5, 4]) {
    const next = zoomChart(camera, scale, pointer);
    assert.ok(next.zoom >= 0.001 && next.zoom <= 2);
    assert.ok(
      Math.abs((pointer.x - camera.x) / camera.zoom - (pointer.x - next.x) / next.zoom) < 1e-7,
    );
    assert.ok(
      Math.abs((pointer.y - camera.y) / camera.zoom - (pointer.y - next.y) / next.zoom) < 1e-7,
    );
  }
});

test('Fit recovers an entire maximum-width chart even below ordinary readable zoom', () => {
  const chart = { width: 128000, height: 1408 };
  const area = { width: 270, height: 400 };
  const camera = fitChart(chart, area);
  assert.ok(camera.zoom < 0.01);
  assert.ok(camera.x >= 16 && camera.y >= 16);
  assert.ok(camera.x + chart.width * camera.zoom <= area.width - 16);
  assert.ok(camera.y + chart.height * camera.zoom <= area.height - 16);
});

test('keyboard reveal leaves visible cards alone and brings hidden cards back without zooming', () => {
  const area = { width: 640, height: 420 };
  const camera = { x: 0, y: 0, zoom: 1 };
  const visible = { x: 32, y: 32, width: 224, height: 112 };
  assert.deepEqual(revealChartRect(camera, visible, area), camera);
  const hidden = { x: 1400, y: 900, width: 224, height: 112 };
  const next = revealChartRect(camera, hidden, area);
  assert.equal(next.zoom, camera.zoom);
  assert.ok(next.x + hidden.x >= 12 && next.x + hidden.x + hidden.width <= area.width - 12);
  assert.ok(next.y + hidden.y >= 12 && next.y + hidden.y + hidden.height <= area.height - 12);
});
