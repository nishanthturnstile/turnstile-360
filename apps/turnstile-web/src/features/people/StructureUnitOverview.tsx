import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { ButtonLink } from '@/components/button-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { unitPath } from '../configuration/structure-model';
import type { StructureIntent } from './StructureUnitTask';
import { knownDeleteRestriction } from './structure-affordances';
import type { HierarchyNode } from './structure-hierarchy';
import { TaskSheet, useTaskDismiss } from './TaskSheet';

type OverviewProps = {
  node: HierarchyNode;
  nodes: readonly HierarchyNode[];
  editable: boolean;
  addable: boolean;
  disabled: boolean;
  onAction: (action: StructureIntent) => void;
  onSelect: (id?: string) => void;
  onFocus: () => void;
  onClose: () => void;
  organizationLink?: boolean;
  accessLink?: ReactNode;
};
export function StructureUnitOverview(props: OverviewProps) {
  const host = useRef<HTMLDivElement>(null);
  const [small, setSmall] = useState(() => matchMedia('(max-width: 760px)').matches);
  useLayoutEffect(() => {
    const map = host.current?.closest<HTMLElement>('.hierarchy-map');
    if (!map) return;
    const update = () =>
      setSmall(map.clientWidth < 640 || matchMedia('(max-width: 760px)').matches);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(map);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="hierarchy-overview-host" ref={host}>
      {small ? (
        <TaskSheet label="Unit details">
          <OverviewBody {...props} />
        </TaskSheet>
      ) : (
        <section className="hierarchy-inspector" aria-label="Unit details">
          <OverviewBody {...props} focus />
        </section>
      )}
    </div>
  );
}
function OverviewBody({
  node,
  nodes,
  editable,
  addable,
  disabled,
  onAction,
  onSelect,
  onFocus,
  onClose,
  organizationLink,
  accessLink,
  focus,
}: OverviewProps & { focus?: boolean }) {
  useTaskDismiss(onClose);
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (focus) panel.current?.focus({ preventScroll: true });
  }, [focus]);
  const children = nodes.filter((n) => n.parentId === node.id);
  const descendants = nodes.filter(
    (n) => !n.context && n.ancestorIds.some((ancestor) => ancestor === node.id),
  );
  const deleteReason = knownDeleteRestriction(nodes, node.id);
  return (
    <Card variant="panel" className="access-panel" ref={panel} tabIndex={-1}>
      <CardHeader className="access-panel-header">
        <div className="access-panel-kicker">Unit overview</div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="access-panel-close"
          aria-label="Close unit details"
          onClick={onClose}
        >
          <HugeiconsIcon icon={Cancel01Icon} />
        </Button>
        <CardTitle>
          <h2>{node.name}</h2>
        </CardTitle>
        <CardDescription>{unitPath(nodes, node.id)}</CardDescription>
      </CardHeader>
      <CardContent className="access-panel-body flex flex-col gap-5">
        <Badge variant="outline">
          {node.context ? 'Ancestor context' : editable ? 'Manageable unit' : 'Read-only unit'}
        </Badge>
        <dl className="hierarchy-unit-facts">
          <div>
            <dt>Type</dt>
            <dd>
              {node.type === 'organization'
                ? 'Organization'
                : node.type === 'site'
                  ? 'Site / Plant'
                  : 'Department'}
            </dd>
          </div>
          <div>
            <dt>Units directly below</dt>
            <dd>{children.filter((n) => !n.context).length} visible</dd>
          </div>
          <div>
            <dt>Units in this branch</dt>
            <dd>{descendants.length} visible</dd>
          </div>
        </dl>
        {node.context && (
          <p className="panel-help">
            This ancestor explains the path. It does not grant access to manage the unit or reveal
            other branches.
          </p>
        )}
        {!node.context && editable && (
          <section className="flex flex-col gap-3" aria-label="Unit actions">
            <h3 className="section-title">Manage this unit</h3>
            <div className="hierarchy-overview-actions">
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => onAction('rename')}
              >
                Rename unit
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || !addable}
                onClick={() => onAction('create')}
              >
                Add department
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || node.type === 'site'}
                onClick={() => onAction('move')}
              >
                Move to…
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || !!deleteReason}
                onClick={() => onAction('delete')}
              >
                Delete unit
              </Button>
            </div>
            {!addable && (
              <p className="panel-help">
                Adding a child needs managed descendant coverage and available capacity within the
                depth limit.
              </p>
            )}
            {node.type === 'site' && (
              <p className="panel-help">
                Sites remain directly below the organization. Departments can move to another
                eligible parent.
              </p>
            )}
            {deleteReason && <p className="panel-help">{deleteReason}</p>}
          </section>
        )}
        {organizationLink && (
          <ButtonLink variant="outline" size="sm" href="/settings/organization">
            Edit organization name in General settings
          </ButtonLink>
        )}
        {children.length > 0 && (
          <section className="hierarchy-unit-children" aria-label="Visible child units">
            <h3 className="section-title">Directly below</h3>
            <ul>
              {children.map((child) => (
                <li key={child.id}>
                  <Button variant="ghost" size="sm" onClick={() => onSelect(child.id)}>
                    {child.name}
                  </Button>
                  {child.context && <Badge variant="outline">Path context</Badge>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {accessLink}
        <p className="panel-help">
          Counts describe the units available within your access. They do not represent the entire
          organization when your coverage is limited.
        </p>
      </CardContent>
      <CardFooter className="access-panel-footer">
        <Button variant="outline" onClick={onFocus}>
          Focus this branch
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Close details
        </Button>
      </CardFooter>
    </Card>
  );
}
