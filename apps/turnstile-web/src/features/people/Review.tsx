import {
  impactReviewSchema,
  peopleCommandResultSchema,
  peopleCommandSchema,
  type UserSessionDto,
} from '@thaarei/turnstile-contracts';
import { useEffect, useState } from 'react';
import { Notice } from '@/components/notice';
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
}: {
  command: unknown;
  session: UserSessionDto;
  onSaved: () => Promise<void>;
  onCancel: () => void;
  target: string;
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
  useEffect(() => {
    void active;
    void session.access?.fingerprint;
    void session.csrfToken;
    setReview(undefined);
  }, [active, session.access?.fingerprint, session.csrfToken]);
  async function run(work: () => Promise<void>) {
    if (!active || busy) return;
    setBusy(true);
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
        await execute(command, review.confirmation, key, session.csrfToken);
      } catch (e) {
        setReview(undefined);
        if (!(e instanceof PeopleError) || (e.status >= 500 && e.reason !== 'readiness'))
          setUncertain(true);
        throw e;
      }
      setDone(true);
      await onSaved();
    });
  }
  return (
    <section
      aria-label="Review access change"
      className="flex flex-col gap-5 rounded-xl border p-5"
    >
      <h2 className="section-title">{title}</h2>
      <p className="break-words">{target}</p>
      {'name' in detail && <p>Name: {detail.name}</p>}
      {'email' in detail && <p>Recipient: {detail.email}</p>}
      {detail.operation === 'member.assignments' && (
        <p>
          {detail.retireLegacyVersion === null
            ? 'Imported grants are retained.'
            : 'Imported grants will be retired.'}
        </p>
      )}
      {'permissions' in detail && (
        <p>Requested permissions: {detail.permissions.map(permissionLabel).join(', ')}</p>
      )}
      {!!failure && <Notice message={message(failure)} />}
      {done ? (
        <Notice success message="Saved. Current access has been refreshed." />
      ) : uncertain ? (
        <>
          <p>
            We could not confirm whether this command committed. Check its current outcome before
            starting another change. No request will be replayed automatically.
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await request(`/api/people/commands/${key}`, peopleCommandResultSchema);
                setUncertain(false);
                setDone(true);
                await onSaved();
              })
            }
          >
            Check command status
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const current = await request('/api/people/impact', impactReviewSchema, {
                  method: 'POST',
                  csrf: session.csrfToken,
                  body: { command },
                });
                setReview(current);
                setUncertain(false);
              })
            }
          >
            Review current state for the same command
          </Button>
          <p className="text-sm text-muted-foreground">
            If no completed command is available, reload current data and compare it with this draft
            before reviewing another change.
          </p>
        </>
      ) : review ? (
        <>
          <p>
            Review is valid until {new Date(review.expiresAt).toLocaleTimeString()}. Saving checks
            current access again.
          </p>
          {review.visibility === 'people' ? (
            <>
              <p>
                {review.memberCount} members · {review.invitationCount} invitations affected
              </p>
              <AssignmentSummary assignments={review.assignments} session={session} />
            </>
          ) : (
            review.roles.map((r) => (
              <p key={r.id}>
                {r.name} · version {r.version}
              </p>
            ))
          )}
          <p className="text-sm">
            Shared role edits affect everyone using that role. Retained imported grants remain
            effective unless explicitly retired.
          </p>
          <Button
            variant={
              ['role.delete', 'member.suspend', 'invitation.cancel'].includes(detail.operation)
                ? 'destructive'
                : 'default'
            }
            disabled={busy || Date.parse(review.expiresAt) <= Date.now()}
            onClick={() => void save()}
          >
            Confirm and save
          </Button>
        </>
      ) : (
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () =>
              setReview(
                await request('/api/people/impact', impactReviewSchema, {
                  method: 'POST',
                  csrf: session.csrfToken,
                  body: { command },
                }),
              ),
            )
          }
        >
          Review current impact
        </Button>
      )}
      {!busy && (
        <Button disabled={uncertain} variant="outline" onClick={onCancel}>
          {done ? 'Close' : 'Back to draft'}
        </Button>
      )}
    </section>
  );
}
