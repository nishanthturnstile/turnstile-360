'use client';
import type { Catalogue } from '@thaarei/module-catalog';
import { useId } from 'react';

export function ModuleDependencyGraph({
  catalogue,
  requested,
  resolved,
}: {
  catalogue: Catalogue;
  requested: string[];
  resolved: string[];
}) {
  const arrow = useId();
  const modules = [...catalogue.modules].sort((a, b) => a.id.localeCompare(b.id));
  const depth = new Map<string, number>();
  function level(id: string): number {
    const prior = depth.get(id);
    if (prior !== undefined) return prior;
    const value = Math.max(
      0,
      ...(modules.find((m) => m.id === id)?.requires.map((id) => level(id) + 1) ?? []),
    );
    depth.set(id, value);
    return value;
  }
  const counts = new Map<number, number>();
  const positions = new Map(
    modules.map((m) => {
      const column = level(m.id),
        row = counts.get(column) ?? 0;
      counts.set(column, row + 1);
      return [m.id, { x: 145 + column * 280, y: 55 + row * 105 }];
    }),
  );
  const width = Math.max(650, 290 + Math.max(...depth.values()) * 280);
  const height = Math.max(190, 65 + Math.max(...counts.values()) * 105);
  return (
    <>
      <p>
        Solid arrow: required module. Dashed arrow: optional integration. An optional link grants no
        access.
      </p>
      <section
        className="module-graph"
        aria-label="Scrollable dependency graph"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll a large dependency graph.
        tabIndex={0}
      >
        <svg
          role="img"
          aria-label="Module dependencies; equivalent details and selection controls follow below"
          viewBox={`0 0 ${width} ${height}`}
          style={{ minWidth: width }}
        >
          <title>Module dependency graph</title>
          <defs>
            <marker id={arrow} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="currentColor" />
            </marker>
          </defs>
          {modules.flatMap((m) =>
            [
              ...m.requires.map((id) => ({ id, optional: false })),
              ...m.optionalIntegrations.map((id) => ({ id, optional: true })),
            ].map(({ id, optional }) => {
              const from = positions.get(m.id),
                to = positions.get(id);
              if (!from || !to) return null;
              return (
                <path
                  key={`${m.id}-${id}`}
                  d={`M ${from.x - 115},${from.y} C ${from.x - 145},${from.y} ${to.x + 145},${to.y} ${to.x + 115},${to.y}`}
                  fill="none"
                  stroke="currentColor"
                  opacity={optional ? 0.35 : 0.65}
                  strokeDasharray={optional ? '5 5' : undefined}
                  markerEnd={`url(#${arrow})`}
                />
              );
            }),
          )}
          {modules.map((m) => {
            const p = positions.get(m.id);
            if (!p) return null;
            const included = resolved.includes(m.id);
            const label =
              m.category === 'core'
                ? 'Core · required'
                : requested.includes(m.id)
                  ? 'Selected'
                  : included
                    ? 'Required dependency'
                    : 'Not selected';
            return (
              <g key={m.id}>
                <rect
                  x={p.x - 115}
                  y={p.y - 30}
                  width={230}
                  height={64}
                  rx={8}
                  fill={included ? '#e9eff0' : '#fff'}
                  stroke={included ? '#215b64' : '#b5bfc4'}
                />
                <text x={p.x} y={p.y - 5} textAnchor="middle" fontSize={12}>
                  {m.label.length > 29 ? `${m.label.slice(0, 26)}…` : m.label}
                </text>
                <text x={p.x} y={p.y + 16} textAnchor="middle" fontSize={11}>
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
      </section>
    </>
  );
}
