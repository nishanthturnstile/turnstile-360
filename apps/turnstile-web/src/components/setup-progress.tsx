import { ButtonLink } from '@/components/button-link';
import { Badge } from '@/components/ui/badge';

export function SetupProgress({
  steps,
  currentPath,
}: {
  steps: ReadonlyArray<{ label: string; href: string }>;
  currentPath: string;
}) {
  return (
    <nav aria-label="Setup steps" className="setup-progress">
      <ol className="grid grid-cols-3 gap-2">
        {steps.map(({ label, href }, index) => (
          <li key={href} className="min-w-0">
            <ButtonLink
              href={href}
              variant={currentPath === href ? 'secondary' : 'ghost'}
              className="h-auto w-full flex-wrap gap-2 px-1 py-3"
              aria-current={currentPath === href ? 'step' : undefined}
            >
              <Badge variant="outline" aria-hidden="true">
                {index + 1}
              </Badge>
              {label}
            </ButtonLink>
          </li>
        ))}
      </ol>
    </nav>
  );
}
