import { ArrowRight01Icon, Shield01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { MemberDto, UserSessionDto } from '@thaarei/turnstile-contracts';
import { AppLink } from '@/components/navigation';
import { Notice } from '@/components/notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AccessInspection } from './AccessInspection';
import { permissionLabel, UnitPaths } from './shared';

export const memberName = (member: MemberDto) =>
  'name' in member.identity ? member.identity.name : 'Account details unavailable';
const contact = (member: MemberDto) =>
  'email' in member.identity
    ? member.identity.email
    : member.identity.state === 'deleted'
      ? 'Identity account deleted'
      : 'Identity service unavailable';
const coverage = (scope: MemberDto['assignments'][number]['scope']) =>
  scope.kind === 'company'
    ? 'Whole company'
    : `${scope.unitIds.length} ${scope.unitIds.length === 1 ? 'unit' : 'units'} · ${scope.includeChildren ? 'Includes children' : 'Selected units only'}`;
export function MemberIdentity({
  member,
  currentUserId,
}: {
  member: MemberDto;
  currentUserId?: string;
}) {
  const name = memberName(member);
  return (
    <div className="member-identity">
      <span className="member-avatar" aria-hidden="true">
        {'name' in member.identity
          ? name
              .trim()
              .split(/\s+/u)
              .slice(0, 2)
              .map((part) => Array.from(part)[0])
              .join('')
          : '?'}
      </span>
      <div className="member-identity-text">
        <h2>{name}</h2>
        <p>{contact(member)}</p>
        {member.userId === currentUserId && <Badge variant="outline">You</Badge>}
      </div>
    </div>
  );
}
export function MemberTable({
  members,
  currentUserId,
  selectedId,
  disabled,
  onSelect,
}: {
  members: MemberDto[];
  currentUserId: string;
  selectedId?: string | undefined;
  disabled: boolean;
  onSelect: (member: MemberDto) => void;
}) {
  return (
    <Table className="member-table">
      <caption className="sr-only">
        Workspace members, membership status, and saved roles with their coverage.
      </caption>
      <TableHeader>
        <TableRow>
          <TableHead>Person</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Roles & coverage</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <TableRow key={member.id} data-state={member.id === selectedId ? 'selected' : undefined}>
            <TableCell>
              <MemberIdentity member={member} currentUserId={currentUserId} />
            </TableCell>
            <TableCell>
              <Badge variant={member.status === 'suspended' ? 'destructive' : 'secondary'}>
                {member.status === 'active' ? 'Active' : 'Suspended'}
              </Badge>
              {member.identity.state !== 'fresh' && (
                <p className="member-meta">
                  {member.identity.state === 'stale'
                    ? 'Contact may be outdated'
                    : 'Identity unavailable'}
                </p>
              )}
            </TableCell>
            <TableCell>
              <div className="member-role-list">
                {member.assignments.slice(0, 2).map((a) => (
                  <div key={a.id}>
                    <strong>{a.role.name}</strong>
                    <p>{coverage(a.scope)}</p>
                  </div>
                ))}
                {member.assignments.length > 2 && (
                  <span className="member-meta">
                    +{member.assignments.length - 2} more assignments
                  </span>
                )}
                {member.legacySource && !member.legacySource.retired && (
                  <Badge variant="outline">Imported access retained</Badge>
                )}
                {!member.assignments.length &&
                  (!member.legacySource || member.legacySource.retired) && (
                    <span>No access assigned</span>
                  )}
              </div>
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={`View access for ${memberName(member)}`}
                onClick={() => onSelect(member)}
              >
                View access
                <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
export function MemberOverview({
  member,
  session,
  disabled,
  onEdit,
  onStatus,
}: {
  member: MemberDto;
  session: UserSessionDto;
  disabled: boolean;
  onEdit: () => void;
  onStatus: () => void;
}) {
  return (
    <div className="member-overview">
      <div className="member-overview-heading">
        <Badge variant={member.status === 'suspended' ? 'destructive' : 'secondary'}>
          {member.status === 'active' ? 'Active member' : 'Suspended member'}
        </Badge>
        <p>
          {member.status === 'suspended'
            ? 'Workspace access is paused. Saved assignments remain in place.'
            : 'Review their saved roles and where each role applies.'}
        </p>
      </div>
      {member.identity.state !== 'fresh' && (
        <Notice
          message={
            member.identity.state === 'stale'
              ? 'Contact details are from the last verified display and may be outdated. Identity status does not replace membership permissions.'
              : 'Current identity details are unavailable. This membership remains bound to its original account.'
          }
        />
      )}
      <section className="member-access-section" aria-label="Saved member access">
        <div className="member-section-heading">
          <h3>Roles & coverage</h3>
          <Button size="sm" variant="outline" disabled={disabled} onClick={onEdit}>
            Edit access
          </Button>
        </div>
        <p className="member-meta">
          Roles define what they can do. Coverage defines where they can do it.
        </p>
        {member.assignments.map((a) => (
          <article className="member-grant" key={a.id}>
            <div className="member-grant-title">
              <HugeiconsIcon icon={Shield01Icon} />
              <h4>{a.role.name}</h4>
              {a.role.systemKey === 'workspace_administrator' && (
                <Badge variant="outline">Protected</Badge>
              )}
            </div>
            <dl>
              <div>
                <dt>Applies to</dt>
                <dd>{coverage(a.scope)}</dd>
              </div>
            </dl>
            {a.scope.kind === 'units' && <UnitPaths ids={a.scope.unitIds} session={session} />}
            <details>
              <summary>
                {a.role.permissions.length}{' '}
                {a.role.permissions.length === 1 ? 'permission' : 'permissions'}
              </summary>
              <div className="access-permission-summary">
                {a.role.permissions.map((p) => (
                  <Badge key={p} variant="outline">
                    {permissionLabel(p)}
                  </Badge>
                ))}
              </div>
            </details>
          </article>
        ))}
        {!member.assignments.length && (
          <p className="member-meta">
            No roles assigned. Use Edit access to add a role and coverage.
          </p>
        )}
        {member.legacySource && !member.legacySource.retired && (
          <div className="member-grant">
            <h4>Imported access is still retained</h4>
            <p className="member-meta">
              This independent company-wide source remains in effect while membership is active.
              Changing roles alone does not remove it.
            </p>
            <div className="access-permission-summary">
              {member.legacySource.permissions.map((p) => (
                <Badge variant="outline" key={p}>
                  {permissionLabel(p)}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </section>
      <section className="member-status-section" aria-label="Membership status">
        <AccessInspection member={member} session={session} />
        <AppLink href={`/people/activity?subjectId=${member.id}`}>
          View activity for this member
        </AppLink>
        <h3>
          {member.status === 'active' ? 'Pause workspace access' : 'Restore workspace access'}
        </h3>
        <p>
          {member.status === 'active'
            ? 'Suspension blocks all access to this workspace, including retained imported grants. It does not delete their identity account.'
            : 'Reactivation restores saved access only after current identity and permission checks.'}
        </p>
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          <li>Review all roles, unit coverage and retained imported access above.</li>
          <li>
            Suspension blocks this workspace immediately while preserving assignments and audit
            history.
          </li>
          <li>
            Before reactivation, review saved assignments; reactivation can restore their access.
          </li>
          <li>
            Account-wide sessions, credentials and identity-provider deprovisioning belong to the
            identity administrator.
          </li>
        </ul>
        <Button
          variant={member.status === 'active' ? 'destructive' : 'outline'}
          disabled={disabled}
          onClick={onStatus}
        >
          Review {member.status === 'active' ? 'suspension' : 'reactivation'}
        </Button>
      </section>
      <details className="member-account-details">
        <summary>Account details & imported history</summary>
        <dl>
          <div>
            <dt>Account ID</dt>
            <dd>{member.userId}</dd>
          </div>
          <div>
            <dt>Contact display</dt>
            <dd>{member.identity.state === 'fresh' ? 'Current' : member.identity.state}</dd>
          </div>
          {member.acceptedAt && (
            <div>
              <dt>Invitation accepted</dt>
              <dd>
                <time dateTime={member.acceptedAt}>
                  {new Date(member.acceptedAt).toLocaleString()}
                </time>
              </dd>
            </div>
          )}
          {member.importedAt && (
            <div>
              <dt>Access imported</dt>
              <dd>
                <time dateTime={member.importedAt}>
                  {new Date(member.importedAt).toLocaleString()}
                </time>
              </dd>
            </div>
          )}
        </dl>
        {!member.acceptedAt && (
          <p className="member-meta">
            An invitation acceptance date is not recorded for this membership.
          </p>
        )}
        {member.legacySource?.retired && (
          <p>Imported access was retired and grants no current permissions.</p>
        )}
      </details>
    </div>
  );
}
