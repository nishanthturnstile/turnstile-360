import type { ReactNode } from 'react';
import { ScrollRegion } from '@/components/scroll-region';

/** Neutral entry and incomplete setup never mount the completed workspace chrome. */
export function EntryLayout({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div className="entry-layout">
      {header}
      <main className="entry-main">{children}</main>
      <footer className="app-footer">
        Turnstile 360 <span aria-hidden="true">·</span> Thaarei
      </footer>
    </div>
  );
}

export function EntryContent({ children }: { children: ReactNode }) {
  return (
    <ScrollRegion label="Workspace entry" className="entry-page">
      <div className="entry-content">{children}</div>
    </ScrollRegion>
  );
}
