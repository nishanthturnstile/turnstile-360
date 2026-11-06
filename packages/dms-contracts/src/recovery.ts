import { z } from 'zod';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const backupPartNames = [
  'postgres',
  'storage',
  'configuration',
  'signatures',
  'objects',
  'images',
] as const;
export const backupManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.uuid(),
    tenantId: z.uuid(),
    customerKey: z.string().min(1).max(48),
    sourceProject: z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/),
    recoveryPoint: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    postgresMajor: z.literal(18),
    systemIdentifier: z.string().regex(/^[0-9]+$/),
    checkpointLsn: z.string().regex(/^[0-9A-F]+\/[0-9A-F]+$/),
    releaseVersion: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
    imageLockSha256: sha,
    repositoryId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    confirmedOffHost: z.boolean(),
    roles: z
      .array(
        z
          .object({
            name: z.string().regex(/^thaarei_(auth|dms)_(runtime|migrator|operator|coordinator)$/),
            login: z.boolean(),
          })
          .strict(),
      )
      .length(6),
    services: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)).max(20),
    parts: z
      .array(
        z
          .object({
            name: z.enum(backupPartNames),
            sha256: sha,
            bytes: z
              .number()
              .int()
              .positive()
              .max(2 ** 50),
          })
          .strict(),
      )
      .length(6),
    objectCount: z.number().int().nonnegative(),
    sourceBytes: z
      .number()
      .int()
      .nonnegative()
      .max(2 ** 50),
    durationSeconds: z.number().nonnegative(),
  })
  .strict()
  .superRefine((m, c) => {
    if (
      new Set(m.parts.map((p) => p.name)).size !== 6 ||
      new Set(m.roles.map((r) => r.name)).size !== 6 ||
      m.roles.some(
        (r) =>
          ![
            'thaarei_auth_runtime',
            'thaarei_auth_migrator',
            'thaarei_dms_runtime',
            'thaarei_dms_migrator',
            'thaarei_dms_operator',
            'thaarei_dms_coordinator',
          ].includes(r.name),
      ) ||
      Date.parse(m.expiresAt) < Date.parse(m.recoveryPoint) + 7 * 86400000
    )
      c.addIssue({
        code: 'custom',
        message: 'Complete parts and seven-day minimum recovery retention required',
      });
  });
export const recoveryCommandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('backup-authorize'),
      operatorEmail: z.email(),
      operatorPassword: z.string().min(15).max(128),
    })
    .strict(),
  z
    .object({
      action: z.literal('backup-register'),
      operatorEmail: z.email(),
      operatorPassword: z.string().min(15).max(128),
      manifest: backupManifestSchema,
      manifestSha256: sha,
      bytes: z
        .number()
        .int()
        .positive()
        .max(2 ** 50),
    })
    .strict(),
  z
    .object({
      action: z.literal('recovery-open'),
      operatorEmail: z.email(),
      operatorPassword: z.string().min(15).max(128),
      backupId: z.uuid(),
      manifestSha256: sha,
      accessReviewed: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal('disposal-request'),
      operatorEmail: z.email(),
      operatorPassword: z.string().min(15).max(128),
      documentId: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.enum(['disposal-inspect', 'backup-inspect']),
      operatorEmail: z.email(),
      operatorPassword: z.string().min(15).max(128),
    })
    .strict(),
  z
    .object({
      action: z.literal('cleanup-request'),
      operatorEmail: z.email(),
      operatorPassword: z.string().min(15).max(128),
    })
    .strict(),
]);
export const backupManifestJsonSchema = z.toJSONSchema(backupManifestSchema);
export const recoveryCommandJsonSchema = z.toJSONSchema(recoveryCommandSchema);
