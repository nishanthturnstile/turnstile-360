import { invitationEmailSchema, PEOPLE_IMPORT_LIMITS } from '@thaarei/turnstile-contracts';
import { peopleFailure } from './people-store.service.js';

export type CsvRecipient = {
  number: number;
  email: string;
  reason: 'invalid_email' | 'invalid_columns' | 'duplicate_csv' | null;
};

/** Bounded RFC-style records; embedded newlines stay in the quoted field/record. */
export function parseImportCsv(input: string): CsvRecipient[] {
  if (Buffer.byteLength(input, 'utf8') > PEOPLE_IMPORT_LIMITS.csvBytes)
    return peopleFailure(413, 'PEOPLE_TOO_LARGE');
  const csv = input.replace(/^\uFEFF/u, '');
  const records: string[][] = [];
  let fields: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  const invalid = (): never =>
    peopleFailure(400, 'PEOPLE_INVALID', { fieldErrors: [{ field: 'csv', reason: 'invalid' }] });
  const endField = () => {
    fields.push(field);
    field = '';
    closed = false;
  };
  const endRecord = () => {
    endField();
    if (fields.length > 1 || fields.some((value) => value.trim())) records.push(fields);
    fields = [];
    if (records.length > PEOPLE_IMPORT_LIMITS.rows + 1) invalid();
  };
  for (let index = 0; index < csv.length; index++) {
    const char = csv[index];
    if (quoted) {
      if (char === '"') {
        if (csv[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
    } else if (char === '"') {
      if (field || closed) invalid();
      quoted = true;
    } else if (char === ',') endField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && csv[index + 1] === '\n') index++;
      endRecord();
    } else {
      if (closed) invalid();
      field += char;
    }
  }
  if (quoted) invalid();
  if (field || fields.length || closed) endRecord();
  if (records.length < 2 || records[0]?.length !== 1 || records[0]?.[0]?.trim() !== 'email')
    invalid();
  const seen = new Set<string>();
  return records.slice(1).map((record, index) => {
    const parsed = invitationEmailSchema.safeParse(record[0]?.trim());
    const email = parsed.success ? parsed.data : (record[0] ?? '').trim().slice(0, 320);
    const reason =
      record.length !== 1
        ? 'invalid_columns'
        : !parsed.success
          ? 'invalid_email'
          : seen.has(email)
            ? 'duplicate_csv'
            : null;
    if (!reason) seen.add(email);
    return { number: index + 2, email, reason };
  });
}
