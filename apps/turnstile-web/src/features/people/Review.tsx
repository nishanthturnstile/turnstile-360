import {
  impactReviewSchema,
  peopleCommandResultSchema,
  peopleCommandSchema,
  type RoleAssignmentRequestDto,
  type RoleDefinitionDto,
  type UserSessionDto,
} from '@thaarei/turnstile-contracts';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Notice } from '@/components/notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePeopleActivity } from './activity';
import { execute, message, PeopleError, request } from './client';
import { permissionLabel } from './labels';
import { AssignmentSummary } from './shared';
export function Review({
  command,
  session,
  onSaved,
  onCancel,
  target,
  onBusyChange,
  actionsTarget,
  beforeRole,
  beforeAssignments,
}: {
  beforeRole?: RoleDefinitionDto | undefined;
  beforeAssignments?:
    | { role: RoleDefinitionDto; scope: RoleAssignmentRequestDto['scope'] }[]
    | undefined;
  command: unknown;
  session: UserSessionDto;
  onSaved: () => Promise<void>;
  onCancel: () => void;
  target: string;
  onBusyChange?: (busy: boolean) => void;
  actionsTarget?: HTMLDivElement | null;
}) {
  const active = usePeopleActivity();
  const detail = peopleCommandSchema.parse(command);
  const title =
    detail.operation === 'role.patch'
      ? detail.change === 'details'
        ? 'Update role details'
        : 'Change shared role permissions'
      : {
          'role.create': 'Create custom role',
          'role.delete': 'Delete role',
          'member.assignments': 'Change member assignments',
          'member.suspend': 'Suspend member',
          'member.reactivate': 'Reactivate member',
          'invitation.issue': 'Approve invitation',
          'invitation.resend': 'Resend invitation',
          'invitation.reapprove': 'Reapprove invitation',
          'invitation.cancel': 'Cancel invitation',
        }[detail.operation];
  const [review, setReview] = useState<ReturnType<typeof impactReviewSchema.parse>>();
  const [key] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const [uncertain, setUncertain] = useState(false);
  const [done, setDone] = useState(false);
  const uncertainOutcome = useRef(false);
  const writing = useRef(false);
  const markUncertain = (value: boolean) => {
    uncertainOutcome.current = value;
    setUncertain(value);
  };
  useEffect(() => {
    onBusyChange?.(busy || uncertain);
  }, [busy, uncertain, onBusyChange]);
  useEffect(() => {
    void session.access?.fingerprint;
    setReview(undefined);
    // A review is read-only. Never replay a write or replace uncertain-outcome recovery.
    if (!active || uncertainOutcome.current || writing.current) return;
    const controller = new AbortController();
    setBusy(true);
    setFailure(undefined);
    void request('/api/people/impact', impactReviewSchema, {
      method: 'POST',
      csrf: session.csrfToken,
      body: { command },
      signal: controller.signal,
    })
      .then((current) => {
        if (!controller.signal.aborted) setReview(current);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setFailure(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [active, session.access?.fingerprint, session.csrfToken, command]);
  useEffect(() => {
    if (!review || done || uncertain) return;
    const timer = window.setTimeout(
      () => {
        setReview(undefined);
        setFailure(new PeopleError(409, 'PEOPLE_CONFLICT', 'impact_stale'));
      },
      Math.max(0, Date.parse(review.expiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [review, done, uncertain]);
  async function run(work: () => Promise<void>) {
    if (!active || busy) return;
    setBusy(true);
    onBusyChange?.(true);
    setFailure(undefined);
    try {
      await work();
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!review) return;
    if (Date.parse(review.expiresAt) <= Date.now()) {
      setReview(undefined);
      setFailure(new PeopleError(409, 'PEOPLE_CONFLICT', 'impact_stale'));
      return;
    }
    await run(async () => {
      try {
        writing.current = true;
        await execute(command, review.confirmation, key, session.csrfToken);
      } catch (e) {
        setReview(undefined);
        if (!(e instanceof PeopleError) || (e.status >= 500 && e.reason !== 'readiness'))
          markUncertain(true);
        throw e;
      } finally {
        writing.current = false;
      }
      setDone(true);
      await onSaved();
    });
  }
  const assess = () =>
    run(async () => {
      const current = await request('/api/people/impact', impactReviewSchema, {
        method: 'POST',
        csrf: session.csrfToken,
        body: { command },
      });
      setReview(current);
      markUncertain(false);
    });
  const actions = (
    <div className="access-review-actions">
      {done ? null : uncertain ? (
        <>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await request(`/api/people/commands/${key}`, peopleCommandResultSchema);
                markUncertain(false);
                setDone(true);
                await onSaved();
              })
            }
          >
            Check command status
          </Button>
          <Button disabled={busy} variant="outline" onClick={() => void assess()}>
            Review current state for the same command
          </Button>
        </>
      ) : review ? (
        <Button
          data-confirm-access-change
          variant={
            ['role.delete', 'member.suspend', 'invitation.cancel'].includes(detail.operation)
              ? 'destructive'
              : 'default'
          }
          disabled={busy || Date.parse(review.expiresAt) <= Date.now()}
          onClick={() => void save()}
        >
          {busy
            ? 'Saving…'
            : {
                'role.create': 'Create role',
                'role.patch': 'Save role changes',
                'role.delete': 'Delete role',
                'member.assignments': 'Save access changes',
                'member.suspend': 'Suspend member',
                'member.reactivate': 'Reactivate member',
                'invitation.issue': 'Confirm and send',
                'invitation.resend': 'Resend invitation',
                'invitation.reapprove': 'Confirm and reapprove',
                'invitation.cancel': 'Cancel invitation',
              }[detail.operation]}
        </Button>
      ) : (
        <Button disabled={busy} onClick={() => void assess()}>
          {busy ? 'Checking impact…' : 'Review current impact'}
        </Button>
      )}
      <Button disabled={busy || uncertain} variant="outline" onClick={onCancel}>
        {done ? 'Close' : 'Back to draft'}
      </Button>
    </div>
  );
  return (
    <section aria-label="Review access change" className="access-review">
      <div className="access-review-heading">
        <span>
          {uncertain ? 'Check saved outcome' : review ? 'Ready to confirm' : 'Review before saving'}
        </span>
        <h2>{title}</h2>
        <p>{target}</p>
      </div>
      {'name' in detail && <p>Name: {detail.name}</p>}
      {'email' in detail && <p>Recipient: {detail.email}</p>}
      {detail.operation === 'member.assignments' && (
        <p className="panel-help">
          {detail.retireLegacyVersion === null
            ? 'Any retained imported access stays in place.'
            : 'Retained imported access will be retired.'}
        </p>
      )}
      {'permissions' in detail && (
        <div className="access-permission-summary">
          {detail.permissions.map((p) => (
            <Badge key={p} variant="outline">
              {permissionLabel(p)}
            </Badge>
          ))}
        </div>
      )}
      {!!failure && <Notice message={message(failure)} />}
      {detail.operation === 'role.patch' && detail.change === 'permissions' && beforeRole && (
        <section className="access-change-comparison" aria-label="Permission changes">
          <div>
            <h3>Added permissions</h3>
            {detail.permissions
              .filter((p) => !beforeRole.permissions.includes(p))
              .map((p) => (
                <p key={p}>{permissionLabel(p)}</p>
              ))}
            {!detail.permissions.some((p) => !beforeRole.permissions.includes(p)) && <p>None</p>}
          </div>
          <div>
            <h3>Removed permissions</h3>
            {beforeRole.permissions
              .filter((p) => !detail.permissions.includes(p))
              .map((p) => (
                <p key={p}>{permissionLabel(p)}</p>
              ))}
            {!beforeRole.permissions.some((p) => !detail.permissions.includes(p)) && <p>None</p>}
          </div>
        </section>
      )}
      {detail.operation === 'member.assignments' && beforeAssignments && (
        <section className="access-change-comparison" aria-label="Assignment changes">
          <div>
            <h3>Removed assignments</h3>
            <AssignmentSummary
              assignments={beforeAssignments.filter(
                (a) =>
                  !detail.assignments.some(
                    (b) => assignmentKey(a.role.id, a.scope) === assignmentKey(b.roleId, b.scope),
                  ),
              )}
              session={session}
            />
            {!beforeAssignments.some(
              (a) =>
                !detail.assignments.some(
                  (b) => assignmentKey(a.role.id, a.scope) === assignmentKey(b.roleId, b.scope),
                ),
            ) && <p>None</p>}
          </div>
          <div>
            <h3>Added assignments</h3>
            {review && review.visibility === 'people' ? (
              <AssignmentSummary
                assignments={review.assignments.filter(
                  (a) =>
                    !beforeAssignments.some(
                      (b) =>
                        assignmentKey(a.role.id, a.scope) === assignmentKey(b.role.id, b.scope),
                    ),
                )}
                session={session}
              />
            ) : (
              <p>Checking proposed assignments…</p>
            )}
            {review &&
              !detail.assignments.some(
                (a) =>
                  !beforeAssignments.some(
                    (b) => assignmentKey(a.roleId, a.scope) === assignmentKey(b.role.id, b.scope),
                  ),
              ) && <p>None</p>}
          </div>
        </section>
      )}
      {done ? (
        <Notice success message="Saved. Current access has been refreshed." />
      ) : uncertain ? (
        <div className="access-review-note">
          <h3>Save outcome is uncertain</h3>
          <p>
            Check the command outcome before making another change. Nothing is replayed
            automatically. If no completed outcome is available, compare current saved access with
            this draft before reviewing the same command.
          </p>
        </div>
      ) : review ? (
        <>
          <div className="access-review-note">
            <h3>Current impact</h3>
            {review.visibility === 'people' ? (
              <p>
                {review.memberCount} {review.memberCount === 1 ? 'member' : 'members'} ·{' '}
                {review.invitationCount}{' '}
                {review.invitationCount === 1 ? 'invitation' : 'invitations'} affected
              </p>
            ) : (
              <p>Role definitions only; this review does not list member identities.</p>
            )}
          </div>
          {review.visibility === 'people' ? (
            <AssignmentSummary assignments={review.assignments} session={session} />
          ) : (
            review.roles.map((r) => <p key={r.id}>{r.name}</p>)
          )}
          <p className="panel-help">
            Valid until {new Date(review.expiresAt).toLocaleTimeString()}. Saving checks current
            access again.
          </p>
          <p className="access-review-note">
            {detail.operation === 'role.patch' && detail.change === 'permissions'
              ? 'This changes access for people and invitations using this shared role.'
              : detail.operation === 'member.suspend'
                ? 'This pauses every source of workspace access. The identity account is preserved.'
                : detail.operation === 'invitation.issue'
                  ? 'Confirmation approves the invitation and queues delivery. The recipient must verify and accept it before becoming a member.'
                  : 'Confirmation applies only the reviewed change. Other independent access sources remain unless explicitly removed.'}
          </p>
        </>
      ) : (
        <p className="panel-help">
          Check the latest affected access, then confirm. No changes have been saved yet.
        </p>
      )}
      {actionsTarget ? createPortal(actions, actionsTarget) : actions}
    </section>
  );
}

function assignmentKey(roleId: string, scope: RoleAssignmentRequestDto['scope']) {
  return JSON.stringify([
    roleId,
    scope.kind,
    scope.kind === 'units' ? [...scope.unitIds].sort() : [],
    scope.kind === 'units' && scope.includeChildren,
  ]);
}
