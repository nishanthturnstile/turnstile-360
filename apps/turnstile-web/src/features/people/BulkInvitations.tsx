import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  type InvitationDto,
  impactReviewSchema,
  invitationEmailSchema,
  peopleCommandResultSchema,
  peopleCommandSchema,
  permissionCatalogSchema,
  type RoleAssignmentRequestDto,
  type UserSessionDto,
} from '@thaarei/turnstile-contracts';
import { useEffect, useRef, useState } from 'react';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldLabel, FieldSet } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { loadSession } from '../auth/product';
import { useUnsavedEntries } from '../configuration/shared';
import { usePeopleActivity } from './activity';
import { execute, message, PeopleError, request } from './client';
import { deliveryStatus, invitationStatus } from './Invitations';
import { AssignmentEditor, AssignmentSummary } from './shared';
import { useTaskConfirm, useTaskDismiss } from './TaskSheet';

type Command = Extract<
  ReturnType<typeof peopleCommandSchema.parse>,
  { operation: 'invitation.issue' }
>;
type Row = {
  email: string;
  key: string;
  state: 'ready' | 'saved' | 'failed' | 'uncertain';
  command: Command;
  error?: unknown;
  current?: InvitationDto;
};
type Proof = ReturnType<typeof impactReviewSchema.parse>;

/** A bounded client task over independently durable single-recipient commands, never an atomic batch. */
export function BulkInvitations({
  session,
  onClose,
  onCheck,
}: {
  session: UserSessionDto;
  onClose: (didSave: boolean) => void;
  onCheck: (fresh?: boolean) => Promise<boolean>;
}) {
  const [emails, setEmails] = useState('');
  const [assignments, setAssignments] = useState<RoleAssignmentRequestDto[]>([
    { roleId: '', expectedRoleVersion: 1, scope: { kind: 'company' } },
  ]);
  const [rows, setRows] = useState<Row[]>([]);
  const [proof, setProof] = useState<Proof>();
  const [recovery, setRecovery] = useState<{ key: string; proof: Proof }>();
  const [failure, setFailure] = useState<unknown>();
  const [emailError, setEmailError] = useState<string>();
  const [copyStatus, setCopyStatus] = useState('');
  const confirmDiscard = useTaskConfirm();
  const [busy, setBusy] = useState(false);
  const active = usePeopleActivity();
  const alive = useRef(true);
  const enabled = useRef(active);
  enabled.current = active;
  useEffect(() => {
    void session.access.fingerprint;
    void session.csrfToken;
    void active;
    setRecovery(undefined);
  }, [active, session.access.fingerprint, session.csrfToken]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const unresolved = rows.some((r) => r.state === 'uncertain');
  const unsent = rows
    .filter((r) => r.state === 'ready' || r.state === 'failed')
    .map((r) => r.email)
    .join('\n');
  const hasDraft = !!emails.trim() || assignments.some((a) => !!a.roleId);
  const markSaved = useUnsavedEntries(hasDraft || !!rows.length || busy);
  const close = () => {
    if (busy || unresolved) return;
    const finish = () => {
      markSaved();
      onClose(rows.some((r) => r.state === 'saved'));
    };
    if ((!rows.length && hasDraft) || rows.some((r) => r.state !== 'saved'))
      confirmDiscard('Discard the remaining invitation draft? Saved invitations are kept.', finish);
    else finish();
  };
  useTaskDismiss(close);
  async function fresh() {
    const value = await loadSession({ fresh: true });
    if (!alive.current || !enabled.current || value.user.id !== session.user.id)
      throw new PeopleError(403, 'PERMISSION_DENIED');
    return value;
  }
  async function review() {
    setBusy(true);
    setFailure(undefined);
    try {
      const entries = emails
        .split(/[\n,;]/u)
        .map((e) => e.trim())
        .filter(Boolean);
      const invalid = entries.filter((e) => !invitationEmailSchema.safeParse(e).success);
      if (invalid.length) {
        setEmailError(`Check these email addresses: ${invalid.join(', ')}`);
        document.getElementById('bulk-emails')?.focus();
        return;
      }
      const recipients = [...new Set(entries.map((e) => invitationEmailSchema.parse(e)))];
      if (!recipients.length || recipients.length > 10) {
        setEmailError('Enter between 1 and 10 distinct email addresses.');
        document.getElementById('bulk-emails')?.focus();
        return;
      }
      const current = await fresh();
      const catalog = await request('/api/people/catalog', permissionCatalogSchema);
      const next: Row[] = recipients.map((email) => ({
        email,
        key: crypto.randomUUID(),
        state: 'ready',
        command: peopleCommandSchema.parse({
          operation: 'invitation.issue',
          email,
          assignments,
          expectedAccessRevision: current.access.accessRevision,
          expectedOrganizationRevision: catalog.organizationRevision,
        }) as Command,
      }));
      let first: Proof | undefined;
      for (const row of next) {
        if (!alive.current || !enabled.current) return;
        try {
          const impact = await request('/api/people/impact', impactReviewSchema, {
            method: 'POST',
            csrf: current.csrfToken,
            body: { command: row.command },
          });
          first ??= impact;
        } catch (error) {
          row.state = 'failed';
          row.error = error;
          if (alive.current) setRows(next);
          throw error;
        }
      }
      if (alive.current) {
        setRows(next);
        setProof(first);
      }
    } catch (error) {
      if (alive.current) setFailure(error);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function send() {
    if (busy || unresolved || !proof) return;
    setBusy(true);
    setFailure(undefined);
    const next = rows.map((r) => ({ ...r }));
    for (const row of next) {
      if (row.state !== 'ready' || !alive.current || !enabled.current) continue;
      let writing = false;
      try {
        const current = await fresh();
        // Refresh only the access revision; recipient, scope, role versions and hierarchy stay reviewed.
        row.command = { ...row.command, expectedAccessRevision: current.access.accessRevision };
        const impact = await request('/api/people/impact', impactReviewSchema, {
          method: 'POST',
          csrf: current.csrfToken,
          body: { command: row.command },
        });
        if (!alive.current || !enabled.current) break;
        writing = true;
        const result = await execute(row.command, impact.confirmation, row.key, current.csrfToken);
        if (result.kind === 'invitation') row.current = result.current;
        row.state = 'saved';
        writing = false;
        if (!(await onCheck(true))) break;
      } catch (error) {
        row.error = error;
        row.state =
          writing &&
          (!(error instanceof PeopleError) || (error.status >= 500 && error.reason !== 'readiness'))
            ? 'uncertain'
            : 'failed';
        break;
      } finally {
        if (alive.current) setRows(next.map((r) => ({ ...r })));
      }
    }
    if (alive.current) {
      setBusy(false);
      setProof(undefined);
    }
  }
  async function reconcile(row: Row) {
    setBusy(true);
    setFailure(undefined);
    try {
      await fresh();
      const result = await request(`/api/people/commands/${row.key}`, peopleCommandResultSchema);
      setRows((old) =>
        old.map((r) =>
          r.key === row.key
            ? {
                ...r,
                state: 'saved',
                error: undefined,
                ...(result.kind === 'invitation' ? { current: result.current } : {}),
              }
            : r,
        ),
      );
      await onCheck(true);
    } catch (error) {
      setFailure(error);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function reviewRecovery(row: Row) {
    if (busy) return;
    setBusy(true);
    setFailure(undefined);
    setRecovery(undefined);
    try {
      const current = await fresh();
      const checked = await request('/api/people/impact', impactReviewSchema, {
        method: 'POST',
        csrf: current.csrfToken,
        body: { command: row.command },
      });
      if (alive.current && enabled.current) setRecovery({ key: row.key, proof: checked });
    } catch (error) {
      if (alive.current) setFailure(error);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function retryReviewed(row: Row) {
    if (busy || recovery?.key !== row.key) return;
    if (Date.parse(recovery.proof.expiresAt) <= Date.now()) {
      setRecovery(undefined);
      setFailure(new PeopleError(409, 'PEOPLE_CONFLICT', 'impact_stale'));
      return;
    }
    setBusy(true);
    setFailure(undefined);
    try {
      const current = await fresh();
      // An explicit retry uses the identical command and key, including its captured versions.
      const result = await execute(
        row.command,
        recovery.proof.confirmation,
        row.key,
        current.csrfToken,
      );
      if (alive.current)
        setRows((old) =>
          old.map((r) =>
            r.key === row.key
              ? {
                  ...r,
                  state: 'saved',
                  error: undefined,
                  ...(result.kind === 'invitation' ? { current: result.current } : {}),
                }
              : r,
          ),
        );
      setRecovery(undefined);
      await onCheck(true);
    } catch (error) {
      // A failed retry does not establish the outcome of the original request.
      if (alive.current) {
        setRecovery(undefined);
        setFailure(error);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Card variant="panel" className="access-panel">
      <CardHeader className="access-panel-header">
        <Button
          variant="ghost"
          size="icon-sm"
          className="access-panel-close"
          aria-label="Close panel"
          disabled={busy || unresolved}
          onClick={close}
        >
          <HugeiconsIcon icon={Cancel01Icon} />
        </Button>
        <CardTitle>
          <h2>Invite multiple members</h2>
        </CardTitle>
        <CardDescription>
          Up to 10 recipients with the same roles and coverage. Each invitation is saved separately.
        </CardDescription>
      </CardHeader>
      <CardContent className="access-panel-body">
        {!!failure && (
          <Notice
            message={
              failure instanceof Error && failure.message === 'recipient_limit'
                ? 'Enter between 1 and 10 distinct email addresses.'
                : message(failure)
            }
          />
        )}
        {!rows.length ? (
          <FieldSet disabled={busy} className="flex flex-col gap-5">
            <Field>
              <FieldLabel htmlFor="bulk-emails">Email addresses</FieldLabel>
              <Textarea
                id="bulk-emails"
                value={emails}
                disabled={busy}
                maxLength={2600}
                onChange={(e) => {
                  setEmails(e.target.value);
                  setEmailError(undefined);
                }}
                aria-invalid={!!emailError}
                aria-describedby={emailError ? 'bulk-emails-error' : 'bulk-emails-help'}
                placeholder="alex@example.com, jordan@example.com"
              />
              <p id="bulk-emails-help" className="panel-help">
                Separate up to 10 addresses with commas or new lines. Duplicate addresses are
                combined.
              </p>
              {emailError && (
                <p id="bulk-emails-error" className="field-error" role="alert">
                  {emailError}
                </p>
              )}
            </Field>
            <AssignmentEditor session={session} value={assignments} onChange={setAssignments} />
          </FieldSet>
        ) : (
          <div className="flex flex-col gap-4">
            {proof && proof.visibility === 'people' && (
              <AssignmentSummary assignments={proof.assignments} session={session} />
            )}
            <ul className="bulk-invitation-outcomes" aria-live="polite">
              {rows.map((row) => (
                <li key={row.key}>
                  <strong>{row.email}</strong>
                  <span>
                    {
                      {
                        ready: 'Not sent',
                        saved: row.current
                          ? `Saved · ${invitationStatus(row.current.state)}`
                          : 'Saved',
                        failed: 'Not saved',
                        uncertain: 'Outcome uncertain',
                      }[row.state]
                    }
                  </span>
                  {row.current && <span>{deliveryStatus(row.current.delivery?.state)}</span>}
                  {!!row.error && <p>{message(row.error)}</p>}
                  {row.state === 'uncertain' && (
                    <>
                      <Button disabled={busy} variant="outline" onClick={() => void reconcile(row)}>
                        Check outcome for {row.email}
                      </Button>
                      <Button
                        disabled={busy}
                        variant="outline"
                        onClick={() => void reviewRecovery(row)}
                      >
                        Review recovery for {row.email}
                      </Button>
                      {recovery?.key === row.key && (
                        <section
                          className="flex flex-col gap-3"
                          aria-label={`Recovery review for ${row.email}`}
                        >
                          {recovery.proof.visibility === 'people' && (
                            <AssignmentSummary
                              assignments={recovery.proof.assignments}
                              session={session}
                            />
                          )}
                          <p className="panel-help">
                            Retry this reviewed invitation with its original command key. A
                            completed command returns its saved result. Later recipients remain
                            unsent. Review valid until{' '}
                            {new Date(recovery.proof.expiresAt).toLocaleTimeString()}.
                          </p>
                          <Button disabled={busy} onClick={() => void retryReviewed(row)}>
                            Retry reviewed invitation for {row.email}
                          </Button>
                        </section>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
            {unsent && !proof && (
              <Field>
                <FieldLabel htmlFor="unsent-recipients">Unsent recipients</FieldLabel>
                <Textarea id="unsent-recipients" value={unsent} readOnly rows={3} />
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(unsent);
                      setCopyStatus('Unsent recipients copied.');
                    } catch {
                      setCopyStatus('Copy is unavailable. Select and copy the addresses above.');
                    }
                  }}
                >
                  Copy unsent recipients
                </Button>
                <p className="panel-help" role="status">
                  {copyStatus ||
                    'Saved and uncertain outcomes are excluded. Resolve uncertain outcomes before starting a new task.'}
                </p>
              </Field>
            )}
            {unresolved && (
              <Notice message="Check the uncertain outcome before closing or starting another batch. A missing receipt does not prove failure. You can explicitly review and retry the same command; no invitation is resent automatically." />
            )}
            {!proof && rows.some((r) => r.state === 'ready' || r.state === 'failed') && (
              <p className="panel-help">
                The batch stopped. Saved invitations remain. Review unsent recipients in a new task
                after resolving any uncertain outcome.
              </p>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="access-panel-footer">
        {!rows.length && (
          <Button
            disabled={
              busy ||
              !emails.trim() ||
              !assignments.length ||
              assignments.some(
                (a) => !a.roleId || (a.scope.kind === 'units' && !a.scope.unitIds.length),
              )
            }
            onClick={() => void review()}
          >
            {busy ? 'Checking invitations…' : 'Review invitations'}
          </Button>
        )}
        {!!proof && (
          <Button disabled={busy || unresolved} onClick={() => void send()}>
            {busy
              ? 'Sending invitations…'
              : `Confirm and send ${rows.length} ${rows.length === 1 ? 'invitation' : 'invitations'}`}
          </Button>
        )}
        {!!rows.length && !proof && !unresolved && !rows.some((r) => r.state === 'saved') && (
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => {
              setRows([]);
              setFailure(undefined);
              setCopyStatus('');
            }}
          >
            Edit recipients
          </Button>
        )}
        {!!proof && (
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => {
              setRows([]);
              setProof(undefined);
            }}
          >
            Back to draft
          </Button>
        )}
        <Button disabled={busy || unresolved} variant="outline" onClick={close}>
          Close batch
        </Button>
      </CardFooter>
    </Card>
  );
}
