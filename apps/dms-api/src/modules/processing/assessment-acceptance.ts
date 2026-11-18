import { type AssessmentEvidence, extractionTask } from '@thaarei/dms-contracts/private';
import { appendDocumentAudit } from '../audit/document-audit.js';
import { requireDeployment } from '../deployment/access.js';
import { lockOriginal } from '../documents/download-policy.js';
import { AdmissionFeatures, readAdmissionPolicy } from '../uploads/admission-policy.js';
import { initialProcessingRun } from './results-state.js';
import { WorkError } from './work-configuration.js';
import { type CoordinatorTx, enqueueWork, wall } from './work-state.js';
export async function acceptAssessment(
  tx: CoordinatorTx,
  uploadId: string,
  evidence: AssessmentEvidence,
) {
  const owning = (
    await tx.client.query(
      'SELECT a.document_id,a.lifecycle_generation,d.lifecycle_generation AS document_generation,d.lifecycle FROM dms.upload_admission a JOIN dms.document d ON d.id=a.document_id WHERE a.id=$1',
      [uploadId],
    )
  ).rows[0];
  if (owning?.lifecycle !== 'ACTIVE' || owning.lifecycle_generation !== owning.document_generation)
    throw new WorkError('WORK_STALE');
  await lockOriginal(tx.client, tx.context.tenantId, owning.document_id, true);
  const candidate = (
    await tx.client.query('SELECT * FROM dms.security_candidate WHERE upload_id=$1 FOR UPDATE', [
      uploadId,
    ])
  ).rows[0];
  const source = (
    await tx.client.query(
      'SELECT * FROM dms.upload_admission a JOIN dms.upload_session s USING(id) WHERE a.id=$1',
      [uploadId],
    )
  ).rows[0];
  const now = await wall(tx.client),
    started = new Date(evidence.startedAt),
    finished = new Date(evidence.finishedAt),
    signatures = new Date(evidence.signatureTime);
  if (
    !candidate ||
    candidate.id !== evidence.candidateId ||
    candidate.state !== 'PENDING' ||
    evidence.size !== Number(candidate.size) ||
    started > finished ||
    finished > now ||
    started.getTime() < now.getTime() - 600000
  )
    throw new WorkError('WORK_INVALID', 400);
  if (evidence.outcome === 'PASSED') await requireDeployment(tx.client, 'completion');
  const pass = evidence.outcome === 'PASSED';
  const policy = await readAdmissionPolicy(tx.client, true);
  if (
    pass &&
    (!policy?.settings.enabled ||
      !policy.settings.contentTypes.includes(source.descriptor.contentType) ||
      !policy.settings.profiles.includes(source.profile) ||
      evidence.size > policy.settings.maxFileBytes)
  )
    throw new WorkError('WORK_INVALID', 400);
  if (
    pass &&
    (!evidence.complete ||
      !evidence.isolated ||
      evidence.code !== 'OK' ||
      source.descriptor.contentType !== evidence.contentType ||
      !new AdmissionFeatures().supports(source.descriptor.contentType, source.profile) ||
      evidence.policy !==
        (evidence.contentType === 'text/plain' ? 'utf8-text-v1' : 'format-security-v1') ||
      (source.descriptor.sha256 && source.descriptor.sha256 !== evidence.sha256) ||
      (candidate.expected_sha256 && candidate.expected_sha256 !== evidence.sha256) ||
      signatures > now ||
      now.getTime() - signatures.getTime() > 48 * 3600000)
  )
    throw new WorkError('WORK_INVALID', 400);
  if (!pass && evidence.code === 'OK') throw new WorkError('WORK_INVALID', 400);
  await tx.client.query(
    "UPDATE dms.security_candidate SET state=$1,sha256=$2,evidence=$3,assessed_at=$4,expected_sha256=CASE WHEN $1='PASSED' THEN coalesce(expected_sha256,$2) ELSE expected_sha256 END,invalidation_generation=invalidation_generation+$6 WHERE id=$5",
    [evidence.outcome, evidence.sha256, evidence, now, candidate.id, pass ? 0 : 1],
  );
  await tx.client.query('UPDATE dms.document_version SET availability=$1 WHERE id=$2', [
    pass ? 'AVAILABLE' : 'UNAVAILABLE',
    source.version_id,
  ]);
  if (!pass) {
    await tx.client.query(
      "UPDATE dms.security_candidate SET state='INVALIDATED',invalidation_generation=invalidation_generation+1 WHERE object_id=$1 AND id<>$2",
      [candidate.object_id, candidate.id],
    );
    await tx.client.query(
      "UPDATE dms.document_version SET availability='UNAVAILABLE' WHERE id IN (SELECT a.version_id FROM dms.upload_admission a JOIN dms.security_candidate c ON c.upload_id=a.id WHERE c.object_id=$1)",
      [candidate.object_id],
    );
  }
  if (pass) {
    // Serialize on the logical document. A late lower revision cannot replace a higher one.
    await tx.client.query('SELECT id FROM dms.document WHERE id=$1 FOR UPDATE', [
      source.document_id,
    ]);
    await tx.client.query(
      `UPDATE dms.document d SET current_version_id=v.id,revision=d.revision+1 FROM dms.document_version v WHERE d.id=$1 AND v.id=$2 AND d.lifecycle='ACTIVE' AND (d.current_version_id IS NULL OR v.number>(SELECT number FROM dms.document_version WHERE id=d.current_version_id))`,
      [source.document_id, source.version_id],
    );
  }
  if (pass && ['searchable', 'structured'].includes(source.profile)) {
    const runId = await initialProcessingRun(tx, uploadId);
    await enqueueWork(
      tx,
      uploadId,
      source.profile === 'structured'
        ? 'document.heavy'
        : extractionTask(source.descriptor.contentType),
      runId,
      true,
    );
  }
  await tx.client.query(
    'UPDATE dms.upload_session SET upload_state=$1,failure_code=$2 WHERE id=$3',
    [pass ? 'COMPLETED' : 'FAILED', pass ? null : 'SECURITY_ASSESSMENT_FAILED', uploadId],
  );
  await tx.client.query(
    "UPDATE dms.lifecycle_restore SET state=$2,failure_code=$3 WHERE upload_id=$1 AND generation=$4 AND state='SCANNING'",
    [
      uploadId,
      pass ? 'COMPLETE' : 'FAILED',
      pass ? null : 'SECURITY_ASSESSMENT_FAILED',
      owning.document_generation,
    ],
  );
  await appendDocumentAudit(tx, {
    documentId: source.document_id,
    applicationId: source.application_id,
    action: pass ? 'document.published' : 'security.assessed',
  });
}
// Owning security control-plane kernel; no consumer or extraction-result invalidation path.
export async function invalidateCandidate(tx: CoordinatorTx, candidateId: string) {
  const owning = (
    await tx.client.query(
      'SELECT a.document_id FROM dms.upload_admission a JOIN dms.security_candidate c ON c.upload_id=a.id WHERE c.id=$1',
      [candidateId],
    )
  ).rows[0];
  if (!owning) throw new WorkError('WORK_STALE');
  await lockOriginal(tx.client, tx.context.tenantId, owning.document_id, true);
  const candidate = (
    await tx.client.query('SELECT * FROM dms.security_candidate WHERE id=$1 FOR UPDATE', [
      candidateId,
    ])
  ).rows[0];
  if (!candidate) throw new WorkError('WORK_STALE');
  await tx.client.query(
    "UPDATE dms.security_candidate SET state='INVALIDATED',invalidation_generation=invalidation_generation+1 WHERE object_id=$1",
    [candidate.object_id],
  );
  await tx.client.query(
    "UPDATE dms.document_version SET availability='UNAVAILABLE' WHERE id IN (SELECT a.version_id FROM dms.upload_admission a JOIN dms.security_candidate c ON c.upload_id=a.id WHERE c.object_id=$1)",
    [candidate.object_id],
  );
  const source = (
    await tx.client.query('SELECT * FROM dms.upload_admission WHERE id=$1', [candidate.upload_id])
  ).rows[0];
  await appendDocumentAudit(tx, {
    documentId: source.document_id,
    applicationId: source.application_id,
    action: 'security.invalidated',
  });
}
