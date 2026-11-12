'use client';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { request } from '../access/client.ts';
import { ActionLink } from '../ui/ActionLink.tsx';
import { Badge } from '../ui/Primitives.tsx';

type Member = {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  revision: number;
  verified: boolean;
  mfaEnabled: boolean;
};
export function StaffEditor({ initial }: { initial: Member[] }) {
  const [members, setMembers] = useState(initial);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setMembers(await request('/api/staff', undefined, 'GET'));
  }
  async function admit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    setBusy(true);
    setMessage('');
    try {
      await request('/api/staff', fields);
      await refresh();
      form.reset();
      setMessage(
        'Staff account admitted. Ask the employee to verify their email and choose a password from Account recovery.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to admit account');
    } finally {
      setBusy(false);
    }
  }
  async function update(event: FormEvent<HTMLFormElement>, member: Member) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setMessage('');
    try {
      await request(
        '/api/staff',
        {
          id: member.id,
          revision: member.revision,
          role: fields.role,
          active: fields.active === 'true',
          reason: fields.reason,
        },
        'PATCH',
      );
      await refresh();
      setMessage('Staff access updated. Existing sessions were revoked.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to change access');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="notice">
        <a href="/access" target="_blank" rel="noreferrer">
          Verify MFA in another tab
        </a>{' '}
        before sensitive changes. <strong>Viewer</strong> reads the workspace;{' '}
        <strong>Operator</strong> manages deployments; <strong>Administrator</strong> also manages
        staff, enforcement and recovery.
      </p>
      <div className="section-heading">
        <div>
          <h2>Your team</h2>
          <p>{members.length} staff accounts</p>
        </div>
        <ActionLink href="#admit-employee">Admit an employee</ActionLink>
      </div>
      <p role="status" className={message ? 'notice' : ''}>
        {message}
      </p>
      <details id="admit-employee">
        <summary>Admit an employee</summary>
        <p className="muted">
          The employee verifies their email, chooses a password and enrolls an authenticator before
          entering the workspace.
        </p>
        <form onSubmit={admit}>
          <fieldset disabled={busy}>
            <label>
              Name
              <input name="name" required maxLength={100} />
            </label>
            <label>
              Email
              <input name="email" type="email" required maxLength={254} />
            </label>
            <label>
              Role
              <select name="role" defaultValue="viewer">
                <option value="viewer">Viewer</option>
                <option value="operator">Operator</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <label>
              Reason
              <input name="reason" required maxLength={300} />
            </label>
            <button disabled={busy} type="submit">
              Admit employee
            </button>
          </fieldset>
        </form>
      </details>
      <div className="staff-grid">
        {members.map((member) => (
          <form key={`${member.id}:${member.revision}`} onSubmit={(event) => update(event, member)}>
            <div className="split-heading">
              <h3>{member.name}</h3>
              <Badge tone={member.active ? 'success' : 'neutral'}>
                {member.active ? 'Active' : 'Disabled'}
              </Badge>
            </div>
            <Badge>{member.role}</Badge>
            <p>
              {member.email}
              <br />
              {member.verified ? 'Email verified' : 'Email verification pending'} ·{' '}
              {member.mfaEnabled ? 'MFA enrolled' : 'MFA enrollment pending'}
            </p>
            <details>
              <summary>Change role or access</summary>
              <fieldset disabled={busy}>
                <label>
                  Role
                  <select name="role" defaultValue={member.role}>
                    <option value="viewer">Viewer</option>
                    <option value="operator">Operator</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <label>
                  Access
                  <select name="active" defaultValue={String(member.active)}>
                    <option value="true">Active</option>
                    <option value="false">Disabled</option>
                  </select>
                </label>
                <label>
                  Reason
                  <input name="reason" required maxLength={300} />
                </label>
                <button disabled={busy} type="submit">
                  Save access
                </button>
                <p className="muted">
                  Saving revokes existing sessions. At least one eligible Administrator must remain.
                </p>
              </fieldset>
            </details>
          </form>
        ))}
      </div>
    </>
  );
}
