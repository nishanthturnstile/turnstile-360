import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moduleGuidance, productGuidance } from '../src/app/ui/workflow.ts';
import { type AssignmentView, assignmentView } from '../src/contracts/module-assignments.ts';

const id = '00000000-0000-4000-8000-000000000001';
const hash = 'a'.repeat(64);
const time = '2026-11-12T12:00:00.000Z';
const binding = {
  clientId: id,
  installationId: id,
  productId: id,
  localInstallationId: id,
  tenantId: id,
  product: 'turnstile',
  applicationId: id,
};
function fixture(overrides: Partial<AssignmentView> = {}): AssignmentView {
  return assignmentView.parse({
    binding,
    productRevision: 2,
    policyState: 'approved',
    archived: false,
    legacy: false,
    minimumDecisionVersion: 2,
    draft: null,
    desired: {
      id,
      kind: 'approved',
      revision: 2,
      actorId: id,
      createdAt: time,
      document: {
        command: {
          version: 1,
          operationId: id,
          expectedRevision: 1,
          binding,
          catalogueDigest: hash,
          requestedIndividualIds: [],
          confirmedResolvedIds: ['foundation'],
          explicitlyRemovedIds: [],
          confirmedRemovalClosureIds: [],
          activeBasis: null,
          reason: 'Synthetic workflow guidance',
        },
        profile: {
          version: 1,
          catalogueId: id,
          catalogueDigest: hash,
          sourceDigest: hash,
          platform: 'linux/amd64',
          contractVersion: 2,
          migrationVersion: 1,
          modules: [{ id: 'foundation', version: '1.0.0' }],
        },
        profileDigest: hash,
      },
    },
    delivery: {
      adapter: 'local-bundle',
      key: hash,
      inventory: {
        version: 1,
        catalogueDigest: hash,
        profileDigest: hash,
        sourceDigest: hash,
        releaseId: hash,
        platform: 'linux/amd64',
        images: [
          { role: 'api', digest: hash },
          { role: 'web', digest: hash },
        ],
        archiveDigest: hash,
        noticesDigest: hash,
        sourceInventoryDigest: hash,
      },
    },
    inventory: {
      epoch: id,
      installed: { catalogueDigest: hash, profileDigest: hash, releaseId: hash },
      observedAt: time,
    },
    observed: null,
    effective: null,
    handover: {
      authorityReady: true,
      products: [
        {
          product: 'turnstile',
          productId: id,
          policyState: 'approved',
          revision: 2,
          paired: true,
          acknowledged: false,
          lastContactAt: time,
          reportReceivedAt: time,
          reportFreshness: 'current',
        },
      ],
    },
    statuses: ['awaiting-activation'],
    ...overrides,
  });
}
test('workflow guidance never equates approval or historic application with current access', () => {
  assert.equal(
    productGuidance({
      policyState: 'approved',
      pairingVerifiedAt: time,
      currentActivationAcknowledgedAt: null,
    }).tone,
    'warning',
  );
  assert.equal(
    productGuidance({
      policyState: 'suspended',
      pairingVerifiedAt: time,
      currentActivationAcknowledgedAt: time,
    }).tone,
    'danger',
  );
  assert.equal(
    productGuidance({
      policyState: 'approved',
      pairingVerifiedAt: null,
      currentActivationAcknowledgedAt: time,
    }).title,
    'Connect this product',
  );
  assert.equal(moduleGuidance(fixture({ minimumDecisionVersion: 1 })).href, '#module-enforcement');
  assert.equal(moduleGuidance(fixture({ policyState: 'pending' })).href, `/clients/${id}`);
  assert.equal(moduleGuidance(fixture({ delivery: null })).href, '#module-delivery');
  assert.equal(moduleGuidance(fixture({ inventory: null })).href, '#module-intent');
});
test('restrictions, recovery and incompatible inventory take precedence over happy-path evidence', () => {
  const active = fixture({ statuses: ['active'] });
  assert.match(moduleGuidance(active).title, /acknowledged/);
  assert.equal(moduleGuidance({ ...active, archived: true }).href, `/clients/${id}`);
  assert.match(
    moduleGuidance({ ...active, handover: { ...active.handover, authorityReady: false } }).title,
    /recovery/,
  );
  assert.match(
    moduleGuidance({ ...active, statuses: ['active', 'inventory-mismatch'] }).title,
    /Reconcile/,
  );
  assert.match(
    moduleGuidance({ ...active, statuses: ['restricted', 'awaiting-activation'] }).title,
    /Review module activation/,
  );
  assert.match(moduleGuidance({ ...active, statuses: ['awaiting-acknowledgement'] }).title, /Wait/);
  assert.match(
    moduleGuidance(
      fixture({
        desired: null,
        draft: null,
        delivery: null,
        inventory: null,
        statuses: ['unassigned'],
      }),
    ).title,
    /Choose/,
  );
});
