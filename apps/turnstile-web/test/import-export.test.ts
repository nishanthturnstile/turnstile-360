import assert from 'node:assert/strict';
import test from 'node:test';
import { importErrorsCsv } from '../src/features/people/import-export.ts';

test('complete row error CSV quotes delimiters/newlines and neutralizes formulas', () => {
  const csv = importErrorsCsv([
    {
      number: 2,
      email: '  =HYPERLINK("x")\nnext',
      state: 'failed',
      reason: 'invalid_email',
      invitationId: null,
    },
  ]);
  assert.ok(csv.startsWith('"record","email","status","reason"\r\n'));
  assert.ok(csv.includes('"\'  =HYPERLINK(""x"")\nnext"'));
  assert.ok(csv.endsWith('"Invalid email address"\r\n'));
});
