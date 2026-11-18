import { z } from 'zod';

export const STORAGE_ROLES = [
  'upload',
  'originalRead',
  'artifactRead',
  'snapshot',
  'artifactWrite',
  'cleanup',
] as const;
export type StorageRole = (typeof STORAGE_ROLES)[number];
export const AREAS = ['staging', 'originals', 'artifacts'] as const;
export type StorageArea = (typeof AREAS)[number];
export const objectReferenceSchema = z
  .object({ area: z.enum(AREAS), tenantId: z.uuid(), applicationId: z.uuid(), id: z.uuid() })
  .strict();
export type ObjectReference = z.infer<typeof objectReferenceSchema>;
const url = z.url().refine((value) => {
  const target = new URL(value);
  return (
    ['http:', 'https:'].includes(target.protocol) &&
    !target.username &&
    !target.password &&
    target.pathname === '/' &&
    !target.search &&
    !target.hash
  );
}, 'Use an explicit origin without credentials/path/query');
const schema = z.object({
  DMS_STORAGE_ENDPOINT: url,
  DMS_STORAGE_PUBLIC_ORIGIN: url,
  DMS_STORAGE_REGION: z.string().regex(/^[a-z0-9-]{1,32}$/),
  DMS_STORAGE_PATH_STYLE: z.literal('true'),
  DMS_STORAGE_ALLOW_HTTP: z.enum(['false', 'true']).default('false'),
  DMS_STORAGE_STAGING_BUCKET: z.string().regex(/^[a-z][a-z0-9-]{2,62}$/),
  DMS_STORAGE_ORIGINALS_BUCKET: z.string().regex(/^[a-z][a-z0-9-]{2,62}$/),
  DMS_STORAGE_ARTIFACTS_BUCKET: z.string().regex(/^[a-z][a-z0-9-]{2,62}$/),
  DMS_STORAGE_BROWSER_ORIGINS: z.string().default('[]'),
});
export function storageConfiguration(environment: NodeJS.ProcessEnv) {
  const parsed = schema.parse(environment);
  if (
    parsed.DMS_STORAGE_ALLOW_HTTP !== 'true' &&
    [parsed.DMS_STORAGE_ENDPOINT, parsed.DMS_STORAGE_PUBLIC_ORIGIN].some(
      (v) => !v.startsWith('https:'),
    )
  )
    throw new Error('Storage TLS required');
  const publicUrl = new URL(parsed.DMS_STORAGE_PUBLIC_ORIGIN);
  if (
    publicUrl.protocol === 'http:' &&
    !['127.0.0.1', 'localhost', '[::1]'].includes(publicUrl.hostname)
  )
    throw new Error('Public transfer TLS required');
  const buckets = {
    staging: parsed.DMS_STORAGE_STAGING_BUCKET,
    originals: parsed.DMS_STORAGE_ORIGINALS_BUCKET,
    artifacts: parsed.DMS_STORAGE_ARTIFACTS_BUCKET,
  };
  if (new Set(Object.values(buckets)).size !== 3)
    throw new Error('Separate storage buckets required');
  const origins = z
    .array(url)
    .max(20)
    .parse(JSON.parse(parsed.DMS_STORAGE_BROWSER_ORIGINS))
    .map((v) => new URL(v).origin);
  return {
    endpoint: new URL(parsed.DMS_STORAGE_ENDPOINT).origin,
    publicOrigin: new URL(parsed.DMS_STORAGE_PUBLIC_ORIGIN).origin,
    region: parsed.DMS_STORAGE_REGION,
    buckets,
    origins,
  };
}
export type StorageConfiguration = ReturnType<typeof storageConfiguration>;
export function storageCredentials(environment: NodeJS.ProcessEnv, role: StorageRole) {
  const prefix = `DMS_STORAGE_${role.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;
  return z
    .object({
      accessKeyId: z.string().regex(/^[A-Za-z0-9]{16,64}$/),
      secretAccessKey: z.string().min(32).max(128),
    })
    .parse({
      accessKeyId: environment[`${prefix}_ACCESS_KEY_ID`],
      secretAccessKey: environment[`${prefix}_SECRET_ACCESS_KEY`],
    });
}
export function objectKey(reference: ObjectReference) {
  const ref = objectReferenceSchema.parse(reference);
  return `${ref.tenantId.toLowerCase()}/${ref.applicationId.toLowerCase()}/${ref.id.toLowerCase()}`;
}
