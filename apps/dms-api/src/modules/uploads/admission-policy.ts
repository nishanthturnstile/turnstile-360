import { Injectable } from '@nestjs/common';
import { EXTRACTION_FORMATS, OCR_FORMATS } from '@thaarei/dms-contracts/private';
import {
  type AdmissionPolicy,
  admissionPolicyInputSchema,
  admissionPolicyProjectionSchema,
  DOCUMENT_LIMITS,
} from '@thaarei/dms-contracts/public';
import type { PoolClient } from 'pg';

// Only owning verified feature implementations may populate this catalog. Configuration
// cannot claim an installed scanner/parser or a public upload lifecycle that does not exist.
@Injectable()
export class AdmissionFeatures {
  uploadLifecycleInstalled() {
    return true;
  }
  formats(): readonly string[] {
    return Object.keys(EXTRACTION_FORMATS);
  }
  profiles(): readonly string[] {
    return ['secure-only', 'searchable', ...(this.structureEnabled() ? ['structured'] : [])];
  }
  structureEnabled() {
    return process.env.DMS_STRUCTURE_ENABLED === 'true';
  }
  supports(contentType: string, profile: string) {
    return (
      this.formats().includes(contentType) &&
      this.profiles().includes(profile) &&
      (profile !== 'structured' ||
        OCR_FORMATS.includes(contentType as (typeof OCR_FORMATS)[number]))
    );
  }
}
export async function readAdmissionPolicy(client: PoolClient, lock = false) {
  if (lock)
    await client.query(
      "SELECT pg_advisory_xact_lock_shared(hashtextextended('dms-admission-policy:'||current_setting('app.tenant_id'),0))",
    );
  const { rows } = await client.query<{ revision: string; settings: unknown }>(
    'SELECT revision,settings FROM dms.admission_policy',
  );
  const row = rows[0];
  return row
    ? { revision: row.revision, settings: admissionPolicyInputSchema.parse(row.settings) }
    : null;
}
export function policyProjection(
  policy: { revision: string; settings: AdmissionPolicy } | null,
  features: AdmissionFeatures,
) {
  const installedProfiles =
    policy?.settings.profiles.filter((v) => features.profiles().includes(v)) ?? [];
  const formats =
    policy?.settings.contentTypes.filter((v) =>
      installedProfiles.some((p) => features.supports(v, p)),
    ) ?? [];
  const profiles = installedProfiles.filter((p) => formats.some((v) => features.supports(v, p)));
  const state = !policy
    ? 'not-configured'
    : !policy.settings.enabled
      ? 'paused'
      : !features.uploadLifecycleInstalled() || !formats.length || !profiles.length
        ? 'not-installed'
        : 'enabled';
  return admissionPolicyProjectionSchema.parse({
    version: 1,
    revision: policy?.revision ?? '0',
    state,
    limits: {
      maxFileBytes: policy?.settings.maxFileBytes ?? DOCUMENT_LIMITS.maxFileBytes,
      metadataBytes: 16384,
      uploadControlBytes: 32768,
      batchManifestBytes: 262144,
      batchControlBytes: 266240,
      activePerApplication: policy?.settings.activePerApplication ?? 4,
      activePerTenant: policy?.settings.activePerTenant ?? 16,
      queuedWork: policy?.settings.queuedWork ?? 100,
    },
    formats: state === 'enabled' ? formats : [],
    profiles: state === 'enabled' ? profiles : [],
  });
}
