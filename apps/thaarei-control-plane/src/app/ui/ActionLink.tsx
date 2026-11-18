'use client';
import type { ReactNode } from 'react';

export function ActionLink({
  href,
  children,
  className = 'button',
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      className={className}
      href={href}
      onClick={() => {
        if (!href.startsWith('#')) return;
        const target = document.getElementById(href.slice(1));
        if (!target) return;
        if (target instanceof HTMLDetailsElement) target.open = true;
        let parent = target.parentElement;
        while (parent) {
          if (parent instanceof HTMLDetailsElement) parent.open = true;
          parent = parent.parentElement;
        }
        requestAnimationFrame(() => {
          const focus = target.querySelector<HTMLElement>('summary, input, button, a') ?? target;
          if (focus === target && !target.hasAttribute('tabindex')) target.tabIndex = -1;
          focus.focus({ preventScroll: true });
          target.scrollIntoView({ block: 'start' });
        });
      }}
    >
      {children}
    </a>
  );
}
