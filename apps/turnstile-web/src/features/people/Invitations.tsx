import type { InvitationDto } from '@thaarei/turnstile-contracts';
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

export const invitationStatus = (state: InvitationDto['state']) =>
  ({
    pending: 'Pending acceptance',
    needs_reapproval: 'Needs review',
    accepted: 'Accepted',
    cancelled: 'Cancelled',
    expired: 'Expired',
  })[state];
export const deliveryStatus = (state?: NonNullable<InvitationDto['delivery']>['state']) =>
  state
    ? {
        queued: 'Queued',
        sending: 'Sending',
        smtp_accepted: 'Accepted by mail server',
        failed: 'Email failed',
        unknown: 'Delivery uncertain',
      }[state]
    : 'Delivery unavailable';

export function InvitationTable({
  invitations,
  selectedId,
  disabled,
  onSelect,
}: {
  invitations: InvitationDto[];
  selectedId?: string | undefined;
  disabled?: boolean;
  onSelect: (invitation: InvitationDto) => void;
}) {
  return (
    <Table className="invitation-table">
      <caption className="sr-only">
        Invitations, approved access, invitation status and independent email delivery.
      </caption>
      <TableHeader>
        <TableRow>
          <TableHead>Recipient & access</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Email delivery</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invitations.map((invitation) => (
          <TableRow
            key={invitation.id}
            data-state={selectedId === invitation.id ? 'selected' : undefined}
          >
            <TableCell>
              <h3>{invitation.email}</h3>
              <div className="member-role-list">
                {invitation.assignments.slice(0, 2).map((a) => (
                  <div key={a.id}>
                    <span>{a.role.name}</span>
                    <p>
                      {a.scope.kind === 'company'
                        ? 'Whole company'
                        : `${a.scope.unitIds.length} ${a.scope.unitIds.length === 1 ? 'unit' : 'units'} · ${a.scope.includeChildren ? 'Includes child units' : 'Selected units only'}`}
                    </p>
                  </div>
                ))}
                {invitation.assignments.length > 2 && (
                  <span className="member-meta">
                    +{invitation.assignments.length - 2} more assignments
                  </span>
                )}
              </div>
            </TableCell>
            <TableCell>
              <Badge variant={invitation.state === 'needs_reapproval' ? 'outline' : 'secondary'}>
                {invitationStatus(invitation.state)}
              </Badge>
            </TableCell>
            <TableCell>
              <span className="member-meta">{deliveryStatus(invitation.delivery?.state)}</span>
              {invitation.delivery?.state === 'unknown' && (
                <p className="member-meta">Check with the recipient before resending.</p>
              )}
            </TableCell>
            <TableCell>
              <span className="invitation-expiry-label">Expires </span>
              <time dateTime={invitation.expiresAt}>
                {new Date(invitation.expiresAt).toLocaleDateString()}
              </time>
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={`View invitation for ${invitation.email}`}
                onClick={() => onSelect(invitation)}
              >
                View invitation
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
