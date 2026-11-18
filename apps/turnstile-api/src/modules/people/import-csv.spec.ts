import { parseImportCsv } from './import-csv.js';

describe('Bounded invitation CSV parsing', () => {
  it('normalizes quoted UTF-8/BOM/CRLF records and reports duplicates/column errors', () => {
    expect(
      parseImportCsv(
        '\uFEFFemail\r\n" ALEX@example.test "\r\n\r\nalex@example.test\ninvalid\n"comma,address"\nfirst@example.test,extra\n,,\n',
      ),
    ).toEqual([
      { number: 2, email: 'alex@example.test', reason: null },
      { number: 3, email: 'alex@example.test', reason: 'duplicate_csv' },
      { number: 4, email: 'invalid', reason: 'invalid_email' },
      { number: 5, email: 'comma,address', reason: 'invalid_email' },
      { number: 6, email: 'first@example.test', reason: 'invalid_columns' },
      { number: 7, email: '', reason: 'invalid_columns' },
    ]);
  });
  it('keeps embedded quoted newlines and escaped quotes in the same invalid recipient', () => {
    expect(parseImportCsv('email\n"bad\n""value"\n')).toEqual([
      { number: 2, email: 'bad\n"value', reason: 'invalid_email' },
    ]);
  });
  it('rejects malformed/headerless/empty and over-capacity inputs', () => {
    for (const csv of [
      'email\n"open',
      'email\n"closed"suffix',
      'email,role\na@b.test,x',
      'Email\na@b.test',
      'email\n',
      `email\n${Array.from({ length: 501 }, (_, i) => `a${i}@example.test`).join('\n')}`,
      `email\n${'x'.repeat(131073)}`,
    ])
      expect(() => parseImportCsv(csv)).toThrow();
  });
});
