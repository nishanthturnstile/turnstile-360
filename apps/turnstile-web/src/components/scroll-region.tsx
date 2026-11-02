import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { cn } from '@/lib/utils';

/** Page scrolling belongs to this pane; surrounding navigation keeps its position. */
export function ScrollRegion({
  children,
  label,
  className,
  resetOnNavigate = true,
}: {
  children: ReactNode;
  label: string;
  className?: string;
  resetOnNavigate?: boolean;
}) {
  const { pathname } = useLocation();
  const region = useRef<HTMLElement>(null);
  const previousPath = useRef(pathname);
  useLayoutEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    if (!resetOnNavigate) return;
    region.current?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    region.current?.focus({ preventScroll: true });
  }, [pathname, resetOnNavigate]);
  return (
    <section
      ref={region}
      tabIndex={resetOnNavigate ? 0 : -1}
      aria-label={label}
      className={cn('scroll-region', className)}
    >
      {children}
    </section>
  );
}
