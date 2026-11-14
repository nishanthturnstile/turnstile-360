import assert from 'node:assert/strict';
import test from 'node:test';
import type { PeopleAuditEventDto } from '@thaarei/turnstile-contracts';
import { auditCsv } from '../src/features/people/audit-export.ts';

test('audit export quotes records and prevents spreadsheet formula execution', () => {
  const event: PeopleAuditEventDto = {
    id: '10000000-0000-4000-8000-000000000001',
    source: 'access',
    action: 'role_created',
    occurredAt: '2026-11-14T00:00:00Z',
    actorKind: 'user',
    actorId: '=SUM(1,2)',
    actorName: '=SUM(1,2)',
    subjectId: null,
    revisionBefore: 0,
    revisionAfter: 1,
    generation: null,
  };
  const csv = auditCsv([event]);
  assert.ok(csv.includes('"\'=SUM(1,2)"'));
  assert.ok(csv.endsWith('\r\n'));
  assert.ok(auditCsv([{ ...event, actorId: ' @formula' }]).includes('"\' @formula"'));
  assert.ok(auditCsv([{ ...event, actorId: 'a"b\nc' }]).includes('"a""b\nc"'));
});
