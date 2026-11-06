import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const specification = 'docs/dms/headless_dms_functionality_requirements_v1.md';
export function requirements() {
  const text = readFileSync(specification, 'utf8');
  return [
    ...text.matchAll(/^- \*\*(FR-\d{2}\.\d{2}):\*\* (.+)$/gm),
    ...text.matchAll(/^\| (NFR-\d{2}) \| (.+?)\s*\|$/gm),
  ].map((m) => ({
    id: m[1],
    requirement: m[2].trim(),
    requirementSha256: createHash('sha256').update(m[2].trim()).digest('hex'),
  }));
}
const owning = 'apps/dms-api/test/enrollment.database-spec.ts';
const groups = {
  '01': ['apps/dms-api/test/standalone.database-spec.ts', 'docs/runbooks/dms-standalone.md'],
  '02': [owning, 'docs/runbooks/authentication.md'],
  '03': ['apps/dms-api/test/api-docs.e2e-spec.ts', 'docs/runbooks/dms-api-explorer.md'],
  '04': [owning, 'docs/runbooks/dms-audit.md'],
  '05': [owning, 'docs/runbooks/dms-admission.md'],
  '06': [owning, 'docs/runbooks/dms-admission.md'],
  '07': [owning, 'docs/runbooks/dms-uploads.md'],
  '08': [owning, 'docs/runbooks/dms-work.md'],
  '09': [owning, 'docs/runbooks/dms-assessment.md'],
  10: [owning, 'docs/runbooks/dms-secure-transfer.md'],
  11: [owning, 'docs/runbooks/dms-versions.md'],
  12: [owning, 'docs/runbooks/dms-metadata.md'],
  13: [owning, 'docs/runbooks/dms-sharing.md'],
  14: [owning, 'docs/runbooks/dms-lifecycle.md'],
  15: ['apps/dms-processing/tests/test_extraction.py', 'docs/runbooks/dms-extraction.md'],
  16: ['apps/dms-processing/tests/test_ocr.py', 'docs/runbooks/dms-ocr.md'],
  17: [owning, 'docs/runbooks/dms-results.md'],
  18: [owning, 'docs/runbooks/dms-discovery.md'],
  19: ['scripts/test-dms-distribution.mjs', 'docs/runbooks/dms-distribution.md'],
  20: ['scripts/fixtures/dms-distribution/recovery.mjs', 'docs/runbooks/dms-recovery.md'],
};
export function ledger(report) {
  const rows = requirements();
  assert.equal(new Set(rows.map((x) => x.id)).size, rows.length);
  return {
    schemaVersion: 1,
    specification,
    scope:
      'Per-requirement traceability. Group evidence is not a claim that every sentence has a dedicated automated assertion. Manual/target/deployed states require separate recorded sign-off.',
    candidate: report?.candidate ?? null,
    requirements: rows.map((row) => {
      const group = row.id.startsWith('FR-') ? row.id.slice(3, 5) : null;
      const references = group
        ? groups[group]
        : ['examples/dms/qualification.mjs', 'docs/runbooks/dms-handover.md'];
      assert.ok(references);
      for (const path of references)
        assert.ok(existsSync(path), `Missing evidence reference ${path}`);
      const conditional =
        row.id === 'FR-02.16'
          ? 'External issuer selection is not selected/qualified in the bundled-authority candidate; external-authority administration and recovery need separate documented acceptance.'
          : row.id === 'NFR-13'
            ? 'Inventory/notices are automated evidence; customer redistribution/legal sign-off remains explicit.'
            : ['NFR-07', 'NFR-10', 'NFR-14'].includes(row.id)
              ? 'Only the declared synthetic local dataset is measured. No customer-volume, sustained-monthly or physical off-host claim.'
              : null;
      return {
        ...row,
        states: {
          implemented: 'see owning source/contracts and group evidence',
          automatedTested: report
            ? 'group suites plus selected exact-image scenarios passed'
            : 'not run for this candidate',
          manualTested: false,
          deployed: false,
          targetAccepted: false,
        },
        evidence: references,
        execution: report ? 'docs/qualification/dms-i20-release.json' : null,
        condition: conditional,
      };
    }),
  };
}
