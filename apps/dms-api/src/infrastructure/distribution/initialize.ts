import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { seaweedIdentityConfiguration } from '../../modules/storage/storage-provision.js';

const origin = z.url().refine((value) => {
  const u = new URL(value);
  return (
    u.protocol === 'https:' &&
    u.pathname === '/' &&
    !u.username &&
    !u.password &&
    !u.search &&
    !u.hash &&
    !value.endsWith('/')
  );
});
const input = z
  .object({
    authorityOrigin: origin,
    transferOrigin: origin,
    customerKey: z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/),
    tenantId: z.uuid().optional(),
    ingressNetwork: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/),
    structured: z.boolean().default(false),
    browserOrigins: z.array(origin).max(20).default([]),
    smtp: z
      .object({
        host: z.string().min(1).max(255),
        port: z.number().int().min(1).max(65535),
        mode: z.enum(['tls', 'starttls']),
        user: z.string().max(255).optional(),
        password: z.string().max(1024).optional(),
        from: z.email(),
      })
      .strict(),
  })
  .strict();
const secret = () => randomBytes(36).toString('base64url');
export async function initializeDistribution(raw: unknown, directory: string) {
  const config = input.parse(raw),
    root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await readdir(root)).some((name) => name.startsWith('.env.') || name === '.dms-profile'))
    throw new Error('Fresh configuration directory required');
  const envFiles: Record<string, Record<string, string>> = {};
  const write = async (name: string, value: string) =>
    writeFile(resolve(root, name), value, { flag: 'wx', mode: 0o600 });
  const tenant = config.tenantId ?? randomUUID(),
    dbPassword = secret();
  const url = (user: string, password = secret()) =>
    `postgresql://${user}:${password}@postgres:5432/dms`;
  const connections = {
    AUTH_DATABASE_URL: url('thaarei_auth_runtime'),
    DMS_DATABASE_URL: url('thaarei_dms_runtime'),
    AUTH_MIGRATION_DATABASE_URL: url('thaarei_auth_migrator'),
    DMS_MIGRATION_DATABASE_URL: url('thaarei_dms_migrator'),
    DMS_OPERATOR_DATABASE_URL: url('thaarei_dms_operator'),
    DMS_COORDINATOR_DATABASE_URL: url('thaarei_dms_coordinator'),
  };
  const common = { INSTALLATION_TENANT_ID: tenant, INSTALLATION_CUSTOMER_KEY: config.customerKey };
  const authority = {
    ...common,
    AUTH_MODE: 'standalone',
    AUTH_PROFILE: 'production',
    AUTH_PUBLIC_ORIGIN: config.authorityOrigin,
    AUTH_ISSUER_URL: `${config.authorityOrigin}/identity`,
    DMS_RESOURCE_URL: `${config.authorityOrigin}/v1`,
    AUTH_SECRET: secret(),
    AUTH_DATABASE_URL: connections.AUTH_DATABASE_URL,
    DMS_DATABASE_URL: connections.DMS_DATABASE_URL,
    AUTH_SMTP_HOST: config.smtp.host,
    AUTH_SMTP_PORT: String(config.smtp.port),
    AUTH_SMTP_MODE: config.smtp.mode,
    AUTH_SMTP_USER: config.smtp.user ?? '',
    AUTH_SMTP_PASSWORD: config.smtp.password ?? '',
    AUTH_MAIL_FROM: config.smtp.from,
    AUTH_LOGIN_CLIENTS: '[]',
    DMS_DOCS_MODE: 'off',
  };
  const storage: Record<string, string> = {
    DMS_STORAGE_ENDPOINT: 'http://storage:8333',
    DMS_STORAGE_PUBLIC_ORIGIN: config.transferOrigin,
    DMS_STORAGE_REGION: 'us-east-1',
    DMS_STORAGE_PATH_STYLE: 'true',
    DMS_STORAGE_ALLOW_HTTP: 'true',
    DMS_STORAGE_STAGING_BUCKET: 'dms-staging',
    DMS_STORAGE_ORIGINALS_BUCKET: 'dms-originals',
    DMS_STORAGE_ARTIFACTS_BUCKET: 'dms-artifacts',
    DMS_STORAGE_BROWSER_ORIGINS: JSON.stringify(config.browserOrigins),
  };
  const keys: Record<string, string> = {};
  for (const role of [
    'BOOTSTRAP',
    'UPLOAD',
    'ORIGINAL_READ',
    'ARTIFACT_READ',
    'SNAPSHOT',
    'ARTIFACT_WRITE',
    'CLEANUP',
  ]) {
    keys[`DMS_STORAGE_${role}_ACCESS_KEY_ID`] = randomBytes(16).toString('hex');
    keys[`DMS_STORAGE_${role}_SECRET_ACCESS_KEY`] = secret();
  }
  const pair = (role: string) =>
    Object.fromEntries(
      Object.entries(keys).filter(([key]) => key.startsWith(`DMS_STORAGE_${role}_`)),
    );
  envFiles['.env.dms.compose'] = {
    POSTGRES_PASSWORD: dbPassword,
    DMS_INGRESS_NETWORK: config.ingressNetwork,
    COMPOSE_PROJECT_NAME: `thaarei-dms-${config.customerKey}`,
  };
  envFiles['.env.dms'] = authority;
  envFiles['.env.provision'] = {
    DATABASE_PROFILE: 'dms',
    PROVISION_DATABASE_URL: url('workspace', dbPassword),
    ...connections,
  };
  envFiles['.env.dms-maintenance'] = { ...authority, ...connections };
  envFiles['.env.dms-operator'] = {
    ...authority,
    DMS_OPERATOR_DATABASE_URL: connections.DMS_OPERATOR_DATABASE_URL,
  };
  envFiles['.env.storage-admin'] = { ...storage, ...keys };
  envFiles['.env.dms-upload'] = { ...storage, ...pair('UPLOAD') };
  envFiles['.env.dms-download'] = { ...storage, ...pair('ORIGINAL_READ') };
  envFiles['.env.dms-results'] = { ...storage, ...pair('ARTIFACT_READ') };
  envFiles['.env.storage-transfer'] = {
    ...storage,
    ...Object.fromEntries(
      Object.entries(keys).filter(
        ([key]) =>
          key.endsWith('_ACCESS_KEY_ID') &&
          !key.includes('BOOTSTRAP') &&
          !key.includes('CLEANUP') &&
          !key.includes('SNAPSHOT'),
      ),
    ),
  };
  envFiles['.env.coordinator'] = {
    ...common,
    DMS_COORDINATOR_DATABASE_URL: connections.DMS_COORDINATOR_DATABASE_URL,
    DMS_WORK_ISSUER_URL: authority.AUTH_ISSUER_URL,
    DMS_WORK_ALLOW_HTTP: 'false',
    DMS_WORK_HOST: '0.0.0.0',
    DMS_WORK_PORT: '3003',
    DMS_STORAGE_CAPACITY_PATH: '/capacity/storage',
    DMS_SCRATCH_CAPACITY_PATH: '/capacity/scratch',
    DMS_CAPACITY_INDEPENDENT_FILESYSTEMS: 'false',
    ...storage,
    ...pair('SNAPSHOT'),
    ...pair('CLEANUP'),
    ...pair('ORIGINAL_READ'),
    ...pair('ARTIFACT_READ'),
    ...pair('ARTIFACT_WRITE'),
  };
  const broker: Record<string, string> = {};
  for (const role of ['publisher', 'scanner', 'extractor', 'heavy']) {
    const password = secret();
    broker[`DMS_BROKER_${role.toUpperCase()}_USER`] = `dms-${role}`;
    broker[`DMS_BROKER_${role.toUpperCase()}_PASSWORD`] = password;
    envFiles[`.env.work-${role}`] = {
      DMS_WORK_ROLE: role,
      DMS_WORK_CLIENT_ID: `work-${role}`,
      DMS_WORK_CLIENT_SECRET: '',
      DMS_WORK_ISSUER_URL: authority.AUTH_ISSUER_URL,
      DMS_WORK_TOKEN_URL: `${authority.AUTH_ISSUER_URL}/oauth2/token`,
      DMS_WORK_API_URL: 'http://coordinator:3003/internal/work',
      DMS_WORK_ALLOW_HTTP: 'true',
      DMS_BROKER_URL: `amqp://dms-${role}:${password}@work-broker:5672/dms`,
    };
  }
  envFiles['.env.work-broker'] = broker;
  for (const [name, values] of Object.entries(envFiles)) {
    for (const [key, value] of Object.entries(values))
      if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\r\n\0]/.test(value))
        throw new Error('Single-line raw environment values required');
    await write(
      name,
      `${Object.entries(values)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n')}\n`,
    );
  }
  await write(
    '.env.storage-identities.json',
    JSON.stringify(seaweedIdentityConfiguration({ ...process.env, ...storage, ...keys })),
  );
  await write('.dms-profile', config.structured ? 'structured\n' : 'standard\n');
  return {
    version: '0.20.0',
    tenantId: tenant,
    customerKey: config.customerKey,
    profile: config.structured ? 'structured' : 'standard',
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let raw = '';
    for await (const part of process.stdin) {
      raw += part;
      if (Buffer.byteLength(raw) > 8192) throw new Error();
    }
    console.log(JSON.stringify(await initializeDistribution(JSON.parse(raw), '/configuration')));
  } catch {
    console.error('Standalone configuration rejected; existing private files preserved');
    process.exitCode = 1;
  }
}
