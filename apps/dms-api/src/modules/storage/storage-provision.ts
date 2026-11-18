import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CreateBucketCommand, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';
import { storageAuthenticationRequired } from './storage-auth.js';
import {
  STORAGE_ROLES,
  type StorageConfiguration,
  storageConfiguration,
  storageCredentials,
} from './storage-configuration.js';

// Private installation tool, not a document operator command or a runtime startup seed.
export function seaweedIdentityConfiguration(environment: NodeJS.ProcessEnv) {
  const config = storageConfiguration(environment);
  const bootstrap = {
    accessKey: environment.DMS_STORAGE_BOOTSTRAP_ACCESS_KEY_ID,
    secretKey: environment.DMS_STORAGE_BOOTSTRAP_SECRET_ACCESS_KEY,
  };
  if (!bootstrap.accessKey || !bootstrap.secretKey || bootstrap.secretKey.length < 32)
    throw new Error('Private bootstrap identity required');
  const entries = STORAGE_ROLES.map((role) => ({
    role,
    credentials: storageCredentials(environment, role),
  }));
  const keys = [bootstrap.accessKey, ...entries.map((v) => v.credentials.accessKeyId)];
  const secrets = [bootstrap.secretKey, ...entries.map((v) => v.credentials.secretAccessKey)];
  if (new Set(keys).size !== keys.length || new Set(secrets).size !== secrets.length)
    throw new Error('Separate storage credentials required');
  const resource = (area: keyof StorageConfiguration['buckets']) =>
    `arn:aws:s3:::${config.buckets[area]}/*`;
  const allow = (Action: string, Resource: string[]) => ({
    Effect: 'Allow',
    Action: [Action],
    Resource,
  });
  const statements = {
    upload: [allow('s3:PutObject', [resource('staging')])],
    originalRead: [allow('s3:GetObject', [resource('originals')])],
    artifactRead: [allow('s3:GetObject', [resource('artifacts')])],
    snapshot: [
      allow('s3:GetObject', [resource('staging'), resource('originals')]),
      allow('s3:PutObject', [resource('originals')]),
    ],
    artifactWrite: [allow('s3:PutObject', [resource('artifacts')])],
    cleanup: [
      allow(
        's3:GetBucketVersioning',
        Object.values(config.buckets).map((b) => `arn:aws:s3:::${b}`),
      ),
      allow(
        's3:DeleteObject',
        Object.values(config.buckets).map((b) => `arn:aws:s3:::${b}/*`),
      ),
    ],
  };
  return {
    identities: [
      { name: 'dms-bootstrap', credentials: [bootstrap], actions: ['Admin'] },
      ...entries.map(({ role, credentials }) => ({
        name: `dms-${role}`,
        credentials: [
          { accessKey: credentials.accessKeyId, secretKey: credentials.secretAccessKey },
        ],
        actions: [],
        policyNames: [`dms-${role}`],
      })),
    ],
    policies: entries.map(({ role }) => ({
      name: `dms-${role}`,
      content: JSON.stringify({ Version: '2012-10-17', Statement: statements[role] }),
    })),
  };
}
export async function configureStorage(environment: NodeJS.ProcessEnv) {
  const config = storageConfiguration(environment);
  if (!(await storageAuthenticationRequired(new URL(config.endpoint))))
    throw new Error('Authenticated storage required');
  seaweedIdentityConfiguration(environment); // reject missing/reused identities before mutation
  const client = new S3Client({
    endpoint: config.endpoint,
    forcePathStyle: true,
    region: config.region,
    maxAttempts: 1,
    credentials: {
      accessKeyId: environment.DMS_STORAGE_BOOTSTRAP_ACCESS_KEY_ID as string,
      secretAccessKey: environment.DMS_STORAGE_BOOTSTRAP_SECRET_ACCESS_KEY as string,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    requestHandler: { connectionTimeout: 3000, requestTimeout: 10000 },
  });
  try {
    for (const bucket of Object.values(config.buckets)) {
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (error) {
        if ((error as { name?: string }).name !== 'BucketAlreadyOwnedByYou')
          throw new Error('Storage bucket configuration failed');
      }
      if (config.origins.length)
        await client.send(
          new PutBucketCorsCommand({
            Bucket: bucket,
            CORSConfiguration: {
              CORSRules: [
                {
                  AllowedOrigins: config.origins,
                  AllowedMethods: ['GET', 'PUT'],
                  AllowedHeaders: ['content-type', 'if-none-match', 'range'],
                  ExposeHeaders: ['ETag', 'Content-Length', 'Content-Range', 'Accept-Ranges'],
                  MaxAgeSeconds: 60,
                },
              ],
            },
          }),
        );
    }
  } finally {
    client.destroy();
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const action = process.argv[2];
    if (action === 'identity-file' && process.argv[3])
      await writeFile(process.argv[3], JSON.stringify(seaweedIdentityConfiguration(process.env)), {
        mode: 0o600,
        flag: 'wx',
      });
    else if (action === 'buckets') await configureStorage(process.env);
    else throw new Error('Use identity-file <private-path> or buckets');
    console.log('Private storage configuration completed');
  } catch {
    console.error(
      'Private storage configuration rejected; verify protected configuration and provider access',
    );
    process.exitCode = 1;
  }
}
