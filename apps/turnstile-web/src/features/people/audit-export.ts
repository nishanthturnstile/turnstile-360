import type { PeopleAuditEventDto } from '@thaarei/turnstile-contracts';

/** Quote all fields and neutralize spreadsheet formulas, including whitespace prefixes. */
export function auditCsv(events: PeopleAuditEventDto[]) {
  const cell = (value: unknown) => {
    const text = value == null ? '' : String(value);
    const safe = /^[\s]*[=+@-]/u.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const rows: unknown[][] = [
    [
      'Event ID',
      'Time (UTC)',
      'Source',
      'Action',
      'Actor type',
      'Actor ID',
      'Actor name (last verified)',
      'Subject ID',
      'Subject name (current or last verified)',
      'Revision before',
      'Revision after',
      'Generation',
    ],
    ...events.map((e) => [
      e.id,
      e.occurredAt,
      e.source,
      e.action,
      e.actorKind,
      e.actorId,
      e.actorName,
      e.subjectId,
      e.subjectLabel,
      e.revisionBefore,
      e.revisionAfter,
      e.generation,
    ]),
  ];
  return `${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}
