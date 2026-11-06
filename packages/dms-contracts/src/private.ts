export * from './operations.js';
export * from './recovery.js';

import { z } from 'zod';
import { admissionPolicyInputSchema, documentPermissionsSchema } from './registry.js';
import { batchStatusSchema, uploadStatusSchema } from './uploads.js';
import { WORK_ROLES } from './work.js';

// Trusted backend/authority contracts. Never included in the consumer explorer.
export * from './identity-service.js';
export * from './identity-service-routes.js';
export * from './work.js';
export const DMS_PRINCIPAL_KINDS = ['consumer', 'publisher', 'scanner', 'extractor'] as const;
export type DmsPrincipalKind = (typeof DMS_PRINCIPAL_KINDS)[number];

const operatorCredentials = {
  operatorEmail: z.email(),
  operatorPassword: z.string().min(15).max(128).meta({ writeOnly: true }),
};
export const dmsOperatorCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...operatorCredentials, action: z.literal('operations-inspect') }).strict(),
  z
    .object({
      ...operatorCredentials,
      action: z.literal('operations-backup-report'),
      completedAt: z.iso.datetime(),
      manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z.object({ ...operatorCredentials, action: z.literal('operations-prune') }).strict(),
  z
    .object({
      ...operatorCredentials,
      action: z.literal('work-redrive'),
      jobId: z.uuid(),
      idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    })
    .strict(),

  z
    .object({
      ...operatorCredentials,
      action: z.literal('document-lifecycle-read'),
      documentId: z.uuid(),
    })
    .strict(),
  z
    .object({
      ...operatorCredentials,
      action: z.literal('document-delete'),
      documentId: z.uuid(),
      expectedRevision: z.string().regex(/^[1-9][0-9]{0,14}$/),
    })
    .strict(),
  z
    .object({
      ...operatorCredentials,
      action: z.literal('document-restore'),
      documentId: z.uuid(),
      expectedRevision: z.string().regex(/^[1-9][0-9]{0,14}$/),
      idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    })
    .strict(),

  z
    .object({
      ...operatorCredentials,
      action: z.literal('document-permissions-read'),
      documentId: z.uuid(),
    })
    .strict(),
  z
    .object({
      ...operatorCredentials,
      action: z.literal('document-permissions-set'),
      documentId: z.uuid(),
      expectedRevision: z.string().regex(/^[1-9][0-9]{0,14}$/),
      permissions: documentPermissionsSchema,
    })
    .strict(),
  z
    .object({
      ...operatorCredentials,
      action: z.literal('document-reprocess'),
      documentId: z.uuid(),
      versionId: z.uuid(),
      profile: z.enum(['searchable', 'structured']),
      idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    })
    .strict(),
  z.object({ ...operatorCredentials, action: z.literal('work-inspect'), jobId: z.uuid() }).strict(),
  z
    .object({
      ...operatorCredentials,
      action: z.literal('work-authorize'),
      clientId: z.string().regex(/^[A-Za-z0-9_-]{3,128}$/),
      role: z.enum(WORK_ROLES),
    })
    .strict(),
  z
    .object({
      ...operatorCredentials,
      action: z.literal('work-disable'),
      clientId: z.string().regex(/^[A-Za-z0-9_-]{3,128}$/),
    })
    .strict(),
  z
    .object({ ...operatorCredentials, action: z.literal('upload-inspect'), uploadId: z.uuid() })
    .strict(),
  z
    .object({
      ...operatorCredentials,
      action: z.literal('batch-inspect'),
      batchId: z.uuid(),
      after: z.number().int().min(-1).max(99).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    })
    .strict(),
  z.object({ ...operatorCredentials, action: z.literal('admission-policy-read') }).strict(),
  z
    .object({
      ...operatorCredentials,
      action: z.literal('admission-policy-set'),
      expectedRevision: z.string().regex(/^[0-9]{1,15}$/),
      policy: admissionPolicyInputSchema,
    })
    .strict(),
  z
    .object({ ...operatorCredentials, action: z.literal('document-inspect'), documentId: z.uuid() })
    .strict(),
  z.object({ ...operatorCredentials, action: z.literal('bootstrap') }).strict(),
  z.object({ ...operatorCredentials, action: z.literal('recover') }).strict(),
  z
    .object({
      ...operatorCredentials,
      action: z.literal('assign'),
      subjectId: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      ...operatorCredentials,
      action: z.literal('revoke'),
      subjectId: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      ...operatorCredentials,
      action: z.literal('audit-read'),
      applicationId: z.uuid().optional(),
      documentId: z.uuid().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z
        .string()
        .min(1)
        .max(2048)
        .regex(/^[A-Za-z0-9_-]+$/)
        .optional(),
    })
    .strict(),
]);
export const dmsOperatorJsonSchema = z.toJSONSchema(dmsOperatorCommandSchema);
export const DMS_OPERATOR_COMMANDS = [
  'operations-inspect',
  'operations-backup-report',
  'operations-prune',
  'work-redrive',
  'document-reprocess',
  'document-lifecycle-read',
  'document-delete',
  'document-restore',
  'document-permissions-read',
  'document-permissions-set',
  'work-inspect',
  'work-authorize',
  'work-disable',
  'bootstrap',
  'assign',
  'revoke',
  'recover',
  'audit-read',
  'admission-policy-read',
  'admission-policy-set',
  'document-inspect',
  'upload-inspect',
  'batch-inspect',
] as const;

export const operatorUploadInspectionSchema = uploadStatusSchema;
export const operatorBatchInspectionSchema = batchStatusSchema
  .omit({ nextCursor: true })
  .extend({ nextAfter: z.number().int().min(0).max(99).nullable() })
  .strict();
export const operatorUploadInspectionJsonSchema = z.toJSONSchema(operatorUploadInspectionSchema);
export const operatorBatchInspectionJsonSchema = z.toJSONSchema(operatorBatchInspectionSchema);
