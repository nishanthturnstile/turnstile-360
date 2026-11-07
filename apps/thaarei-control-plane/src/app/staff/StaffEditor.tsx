'use client';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { request } from '../access/client.ts';

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
      <p>
        <a href="/access">Verify MFA again</a> before sensitive changes.
      </p>
      <p role="status" className={message ? 'notice' : ''}>
        {message}
      </p>
      <h2>Admit an employee</h2>
      <form onSubmit={admit}>
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
      </form>
      <h2>Staff access</h2>
      {members.map((member) => (
        <form key={`${member.id}:${member.revision}`} onSubmit={(event) => update(event, member)}>
          <h3>{member.name}</h3>
          <p>
            {member.email}
            <br />
            {member.verified ? 'Email verified' : 'Email verification pending'} ·{' '}
            {member.mfaEnabled ? 'MFA enrolled' : 'MFA enrollment pending'}
          </p>
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
        </form>
      ))}
    </>
  );
}
