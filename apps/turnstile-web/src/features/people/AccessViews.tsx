import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Building03Icon,
  RefreshIcon,
  Search01Icon,
  Shield01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { RoleDefinitionDto, scopedUnitsResponseSchema } from '@thaarei/turnstile-contracts';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { AppLink } from '@/components/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { permissionLabel } from './labels';
import { type OutlineNode, structureOutline } from './structure-outline';

export function Reload({
  loading,
  onClick,
  label = 'Reload current data',
}: {
  loading: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      disabled={loading}
      onClick={onClick}
    >
      <HugeiconsIcon icon={RefreshIcon} />
    </Button>
  );
}

export function AccessEmpty({ title, description }: { title: string; description: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={Search01Icon} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** A non-modal editor retains navigation/draft protection and remains alongside its list. */
export function AccessInspector({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const panel = ref.current;
    panel?.focus({ preventScroll: true });
    panel?.scrollIntoView({
      block: window.matchMedia('(max-width: 70rem)').matches ? 'start' : 'nearest',
    });
  }, []);
  return (
    <section ref={ref} tabIndex={-1} aria-label={label} className="access-inspector">
      {children}
    </section>
  );
}

export function RoleTable({
  roles,
  selectedId,
  disabled,
  onSelect,
  usage,
}: {
  usage?: { roleId: string; memberCount: number; invitationCount: number }[] | undefined;
  roles: RoleDefinitionDto[];
  selectedId?: string | undefined;
  disabled?: boolean;
  onSelect: (role: RoleDefinitionDto) => void;
}) {
  return (
    <Table className="access-role-table">
      <caption className="sr-only">
        Role definitions and the permissions they grant. Scope is chosen when assigning a role.
      </caption>
      <TableHeader>
        <TableRow>
          <TableHead>Role</TableHead>
          <TableHead>Permissions</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {roles.map((role) => (
          <TableRow key={role.id} data-state={selectedId === role.id ? 'selected' : undefined}>
            <TableCell>
              <div className="access-role-name">
                <HugeiconsIcon icon={Shield01Icon} />
                <div>
                  <h2>{role.name}</h2>
                  <p>
                    {role.description ||
                      (role.systemKey ? 'Built-in workspace role' : 'Defined for your workspace')}
                  </p>
                  {usage
                    ?.filter((u) => u.roleId === role.id)
                    .map((u) => (
                      <p key={u.roleId}>
                        <AppLink
                          href={`/people/members?roleId=${role.id}`}
                          aria-label={`Members using ${role.name}`}
                        >
                          {u.memberCount} {u.memberCount === 1 ? 'member' : 'members'}
                        </AppLink>
                        {' · '}
                        <AppLink
                          href={`/people/invitations?roleId=${role.id}&actionable=true`}
                          aria-label={`Open invitations using ${role.name}`}
                        >
                          {u.invitationCount} open{' '}
                          {u.invitationCount === 1 ? 'invitation' : 'invitations'}
                        </AppLink>
                      </p>
                    ))}
                  <div className="access-badges">
                    <Badge variant={role.systemKey ? 'secondary' : 'outline'}>
                      {role.systemKey ? 'System' : 'Custom'}
                    </Badge>
                    {role.systemKey === 'workspace_administrator' && (
                      <Badge variant="outline">Protected</Badge>
                    )}
                  </div>
                </div>
              </div>
            </TableCell>
            <TableCell>
              <div className="role-permission-preview">
                <span>
                  {role.permissions.length}{' '}
                  {role.permissions.length === 1 ? 'permission' : 'permissions'}
                </span>
                <p className="member-meta">
                  {role.permissions.slice(0, 2).map(permissionLabel).join(' · ')}
                  {role.permissions.length > 2 ? ' · …' : ''}
                </p>
              </div>
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={`View ${role.name}`}
                aria-pressed={selectedId === role.id}
                onClick={() => onSelect(role)}
              >
                View
                <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function StructureOutline({
  snapshot,
  selectedId,
  disabled,
  onSelect,
  canManage = () => true,
}: {
  snapshot: ReturnType<typeof scopedUnitsResponseSchema.parse>;
  canManage?: (id: string) => boolean;
  selectedId?: string | undefined;
  disabled?: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="access-outline" aria-label="Organization hierarchy">
      {structureOutline(snapshot).map((node) => (
        <OutlineBranch
          key={node.id}
          node={node}
          selectedId={selectedId}
          disabled={disabled}
          canManage={canManage}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}
function OutlineBranch({
  node,
  canManage,
  selectedId,
  disabled,
  onSelect,
}: {
  node: OutlineNode;
  canManage: (id: string) => boolean;
  selectedId: string | undefined;
  disabled: boolean | undefined;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const branchId = useId();
  const content = (
    <div className="access-unit-row" data-selected={selectedId === node.id}>
      {!!node.children.length && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="access-branch-toggle"
          aria-label={`Toggle ${node.name} branch`}
          aria-expanded={expanded}
          aria-controls={branchId}
          onClick={() => setExpanded(!expanded)}
        >
          <HugeiconsIcon icon={expanded ? ArrowDown01Icon : ArrowRight01Icon} />
        </Button>
      )}
      <HugeiconsIcon icon={Building03Icon} className="access-unit-icon" />
      <div className="access-unit-label">
        <h2>{node.name}</h2>
        <span>
          {node.type === 'organization'
            ? 'Organization'
            : node.type === 'site'
              ? 'Site / Plant'
              : 'Department'}
        </span>
      </div>
      {!node.actionable && <Badge variant="outline">Path context</Badge>}
      {node.actionable && (
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={`${canManage(node.id) ? 'Manage' : 'View'} ${node.name}`}
          aria-pressed={selectedId === node.id}
          onClick={() => onSelect(node.id)}
        >
          {canManage(node.id) ? 'Manage' : 'View'}
          <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
        </Button>
      )}
    </div>
  );
  return (
    <li className="access-branch">
      {content}
      {!!node.children.length && (
        <ul id={branchId} hidden={!expanded}>
          {node.children.map((child) => (
            <OutlineBranch
              key={child.id}
              node={child}
              selectedId={selectedId}
              disabled={disabled}
              canManage={canManage}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
