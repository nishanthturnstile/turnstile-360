import type { ImportRowDto } from '@thaarei/turnstile-contracts';
export const importReasonLabel = (reason: ImportRowDto['reason']) =>
  reason
    ? {
        invalid_email: 'Invalid email address',
        invalid_columns: 'Expected one email column',
        duplicate_csv: 'Duplicate in this file',
        existing_member: 'Already a workspace member',
        existing_invitation: 'An invitation is already open',
        context_changed: 'Access or organization changed; review a new import',
        permission_changed: 'The submitting administrator no longer has the required access',
        dependency: 'Waiting for a service to recover',
        rate_limit: 'Waiting for the invitation allowance to reset',
        cancelled: 'Cancelled before invitation was saved',
        attempts_exhausted: 'Paused after repeated service failures',
      }[reason]
    : '';
export function importErrorsCsv(rows: ImportRowDto[]) {
  const cell = (value: unknown) => {
    const text = String(value ?? '');
    const safe = /^[\s]*[=+@-]/u.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return `${[
    ['record', 'email', 'status', 'reason'],
    ...rows.map((r) => [r.number, r.email, r.state, importReasonLabel(r.reason)]),
  ]
    .map((row) => row.map(cell).join(','))
    .join('\r\n')}\r\n`;
}
export function downloadImportCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
