import { ArrowRight01Icon, File01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';

export function DocumentHeading({
  icon,
  title,
  description,
  actions,
}: {
  icon: React.ComponentProps<typeof HugeiconsIcon>['icon'];
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="documents-heading">
      <span className="documents-heading-icon" aria-hidden="true">
        <HugeiconsIcon icon={icon} size={26} strokeWidth={1.65} />
      </span>
      <div className="min-w-0 flex-1">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="documents-heading-actions">{actions}</div>}
    </header>
  );
}

export function DocumentIdentity({
  name,
  children,
}: {
  name?: string | undefined;
  children: ReactNode;
}) {
  return (
    <span className="documents-file-identity">
      <span className="documents-file-icon" aria-hidden="true">
        <HugeiconsIcon icon={File01Icon} size={19} />
      </span>
      <span className="min-w-0">
        <span className="documents-file-name">{children}</span>
        {name && <span className="documents-file-caption">{name}</span>}
      </span>
    </span>
  );
}

export function DocumentState({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'ready' | 'attention' | 'neutral';
}) {
  return (
    <Badge variant="outline" className="documents-state" data-tone={tone}>
      <span aria-hidden="true" />
      {children}
    </Badge>
  );
}

export function DocumentArrow() {
  return <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" aria-hidden="true" />;
}

export function DocumentSavedEntry({
  title,
  state,
  savedAt,
}: {
  title: string;
  state: string;
  savedAt: string;
}) {
  const label =
    state === 'UNRESOLVED_REQUIRES_REVIEW'
      ? 'Needs review'
      : state.toLowerCase().replaceAll('_', ' ');
  const tone =
    state === 'RESOLVED'
      ? 'ready'
      : state === 'UNRESOLVED_REQUIRES_REVIEW'
        ? 'attention'
        : 'neutral';
  return (
    <span className="documents-saved-entry">
      <DocumentIdentity name={new Date(savedAt).toLocaleString()}>{title}</DocumentIdentity>
      <DocumentState tone={tone}>{label}</DocumentState>
    </span>
  );
}
