import { admissionPolicyInputSchema } from '@thaarei/dms-contracts/public';
import type { DmsTransaction, OperatorContext } from '../access/resource-policy.js';
import { insertSecurityEvent } from '../audit/security-event.js';
import { AdmissionFeatures, policyProjection, readAdmissionPolicy } from './admission-policy.js';
export async function operatorAdmissionPolicy(
  tx: DmsTransaction<OperatorContext>,
  operation: {
    action: 'admission-policy-read' | 'admission-policy-set';
    expectedRevision?: string;
    policy?: unknown;
  },
) {
  if (operation.action === 'admission-policy-read') {
    const policy = await readAdmissionPolicy(tx.client);
    await insertSecurityEvent(tx.client, tx.context.tenantId, {
      action: 'admission.policy.read',
      actorKind: 'operator',
      actorId: tx.context.subjectId,
      subjectId: tx.context.tenantId,
      outcome: 'success',
    });
    return {
      revision: policy?.revision ?? '0',
      settings: policy?.settings ?? null,
      effective: policyProjection(policy, new AdmissionFeatures()),
    };
  }
  const input = admissionPolicyInputSchema.parse(operation.policy);
  if (
    input.applicationBudgetBytes > input.storageBudgetBytes ||
    input.activePerApplication > input.activePerTenant
  )
    throw new Error('Application limits exceed installation limits');
  input.profiles = [...new Set(input.profiles)].sort();
  input.contentTypes = [...new Set(input.contentTypes)].sort();
  await tx.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `dms-admission-policy:${tx.context.tenantId}`,
  ]);
  const current = await readAdmissionPolicy(tx.client);
  const revision = current?.revision ?? '0';
  if (revision !== operation.expectedRevision) {
    if (
      current &&
      Number(revision) === Number(operation.expectedRevision) + 1 &&
      JSON.stringify(current.settings) === JSON.stringify(input)
    ) {
      await insertSecurityEvent(tx.client, tx.context.tenantId, {
        action: 'admission.policy.read',
        actorKind: 'operator',
        actorId: tx.context.subjectId,
        subjectId: tx.context.tenantId,
        outcome: 'success',
      });
      return { revision, settings: current.settings, changed: false };
    }
    throw new Error('Admission policy revision conflict');
  }
  const next = Number(revision) + 1;
  if (!Number.isSafeInteger(next) || next > 999999999999999)
    throw new Error('Admission policy revision exhausted');
  await tx.client.query(
    'INSERT INTO dms.admission_policy (tenant_id,revision,settings) VALUES ($1,$2,$3) ON CONFLICT (tenant_id) DO UPDATE SET revision=EXCLUDED.revision,settings=EXCLUDED.settings,updated_at=now()',
    [tx.context.tenantId, next, input],
  );
  await insertSecurityEvent(tx.client, tx.context.tenantId, {
    action: 'admission.policy.configure',
    actorKind: 'operator',
    actorId: tx.context.subjectId,
    subjectId: tx.context.tenantId,
    outcome: 'success',
  });
  return { revision: String(next), settings: input, changed: true };
}
