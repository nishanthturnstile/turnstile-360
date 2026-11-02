import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';

export function LoadingStatus({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner aria-hidden="true" />
      {children}
    </p>
  );
}

export type LoadingShape = 'form' | 'list' | 'cards';

/** Skeletons describe the pending content, with one announcement for the whole panel. */
export function ContentLoading({
  label,
  shape = 'cards',
}: {
  label: string;
  shape?: LoadingShape;
}) {
  return (
    <div data-slot="content-loading" className="flex w-full min-w-0 flex-col gap-6">
      <LoadingStatus>{label}</LoadingStatus>
      <Card aria-hidden="true">
        <CardHeader className="flex flex-col gap-3">
          <Skeleton className="h-10 w-3/4 max-w-80" />
          <Skeleton className="h-4 w-full max-w-lg" />
        </CardHeader>
        <CardContent>
          {shape === 'form' ? (
            <div className="flex flex-col gap-6">
              {['first', 'second'].map((field) => (
                <div key={field} className="flex flex-col gap-3">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ))}
              <Skeleton className="h-9 w-36" />
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {(shape === 'list'
                ? ['first', 'second', 'third', 'fourth']
                : ['first', 'second']
              ).map((row) => (
                <div key={row} className="flex flex-col gap-3">
                  <Skeleton className="h-5 w-1/2" />
                  <Skeleton className="h-4 w-4/5" />
                  {shape === 'cards' && <Skeleton className="h-16 w-full" />}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Hidden content stays mounted so transient drafts and request fences survive a read. */
export function PendingContent({
  pending,
  label,
  shape = 'cards',
  children,
}: {
  pending: boolean;
  label: string;
  shape?: LoadingShape;
  children: ReactNode;
}) {
  return (
    <>
      {pending && <ContentLoading label={label} shape={shape} />}
      <div data-slot="pending-content" className="pending-content" hidden={pending}>
        {children}
      </div>
    </>
  );
}
