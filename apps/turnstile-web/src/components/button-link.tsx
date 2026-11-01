import type { VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Navigation keeps native link semantics and shares the Button visual variants. */
export function ButtonLink({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: Omit<ComponentProps<'a'>, 'href'> & { href: string } & VariantProps<typeof buttonVariants>) {
  return (
    <a data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
  );
}
