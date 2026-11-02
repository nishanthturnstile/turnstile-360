import type { ReactNode } from 'react';
import { PendingContent } from '@/components/content-loading';
import { ScrollRegion } from '@/components/scroll-region';
import { type WorkspaceDestination, WorkspaceNavigation } from '@/components/workspace-navigation';
import { cn } from '@/lib/utils';

/** Persistent chrome surrounds the page; Settings owns its nested navigation/content panes. */
export function WorkspaceLayout({
  header,
  destinations,
  settings,
  pending,
  children,
}: {
  header: ReactNode;
  destinations: WorkspaceDestination[];
  settings: boolean;
  pending: boolean;
  children: ReactNode;
}) {
  return (
    <div className="workspace">
      {header}
      <main className="workspace-main">
        <WorkspaceNavigation destinations={destinations} />
        <ScrollRegion
          label="Workspace content"
          resetOnNavigate={!settings}
          className={cn('workspace-page', settings && 'workspace-page-settings')}
        >
          <PendingContent pending={pending && !settings} label="Loading page…">
            {children}
          </PendingContent>
        </ScrollRegion>
      </main>
      <footer className="app-footer">
        Turnstile 360 <span aria-hidden="true">·</span> Thaarei
      </footer>
    </div>
  );
}
