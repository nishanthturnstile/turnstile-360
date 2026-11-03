import { cn } from 'cn';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse motion-reduce:animate-none rounded-xl bg-muted', className)}
      {...props}
    />
  );
}

export { Skeleton };
