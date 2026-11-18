'use client';
import { type ReactNode, useEffect, useRef } from 'react';
export function ReviewHeading({ children }: { children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <h3 ref={heading} tabIndex={-1}>
      {children}
    </h3>
  );
}
