import type { ReactNode } from 'react';
import { ActionLink } from './ActionLink.tsx';
import { Icon } from './Icon.tsx';

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {action && <div className="heading-action">{action}</div>}
    </div>
  );
}
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}) {
  return (
    <span className={`badge badge-${tone}`}>
      <span className="badge-dot" />
      {children}
    </span>
  );
}
export function NextAction({
  title,
  children,
  href,
  label = 'Continue setup',
}: {
  title: string;
  children: ReactNode;
  href?: string | undefined;
  label?: string;
}) {
  return (
    <div className="next-action">
      <span className="next-action-icon">
        <Icon name="arrow" />
      </span>
      <div>
        <p className="eyebrow">NEXT STEP</p>
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
      {href && (
        <ActionLink href={href}>
          {label}
          <Icon name="arrow" />
        </ActionLink>
      )}
    </div>
  );
}
export type WorkflowStep = {
  title: string;
  description: string;
  state: 'complete' | 'current' | 'waiting';
  href?: string | undefined;
};
export function Workflow({
  steps,
  label = 'Setup progress',
}: {
  steps: WorkflowStep[];
  label?: string;
}) {
  return (
    <ol className="workflow" aria-label={label}>
      {steps.map((step, i) => (
        <li key={step.title} className={`workflow-${step.state}`}>
          <span className="workflow-number">
            {step.state === 'complete' ? <Icon name="check" /> : String(i + 1).padStart(2, '0')}
          </span>
          <div>
            {step.href ? (
              <ActionLink href={step.href} className="workflow-title">
                {step.title}
              </ActionLink>
            ) : (
              <strong className="workflow-title">{step.title}</strong>
            )}
            <p>{step.description}</p>
          </div>
          <span className="workflow-state">
            {step.state === 'complete'
              ? 'Complete'
              : step.state === 'current'
                ? 'Next step'
                : 'Waiting'}
          </span>
        </li>
      ))}
    </ol>
  );
}
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name="server" />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
