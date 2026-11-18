import { origin } from '@thaarei/control-plane-contracts';
import { digest, installedModuleIdentity } from '@thaarei/module-catalog';
import { z } from 'zod';
export const ENGINE_VERSION = '0.1.0';
export const RELEASE_TYPE = 'thaarei-customer-release+jwt';
export const RELEASE_AUDIENCE = 'urn:thaarei:installation-release';
const path = z
  .string()
  .startsWith('/')
  .max(4096)
  .refine((v) => !/[\r\n\0,]/.test(v));
export const imageId = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const imageRoles = [
  'engine',
  'dms-api',
  'postgres',
  'turnstile-api',
  'turnstile-web',
] as const;
const fileName = z.enum([
  'images.tar',
  'installer',
  'README.md',
  'NOTICES',
  'COVERED_SOURCE_OFFER.txt',
  'modules/delivery.json',
  'modules/images.tar',
  'modules/source-inventory.json',
  'modules/artifact-inventory.json',
  'modules/NOTICES',
  'modules/README.md',
]);
export const customerRelease = z
  .object({
    version: z.literal(1),
    engineVersion: z.literal(ENGINE_VERSION),
    profile: z.literal('module-poc'),
    platform: z.literal('linux/amd64'),
    sourceDigest: digest,
    module: installedModuleIdentity,
    images: z
      .array(z.object({ role: z.enum(imageRoles), id: imageId }).strict())
      .length(imageRoles.length)
      .refine((v) => new Set(v.map((i) => i.role)).size === imageRoles.length),
    files: z
      .array(
        z
          .object({
            name: fileName,
            digest,
            size: z
              .number()
              .int()
              .positive()
              .max(32 * 1024 ** 3),
          })
          .strict(),
      )
      .length(11)
      .refine((v) => new Set(v.map((f) => f.name)).size === 11),
  })
  .strict();
export type CustomerRelease = z.infer<typeof customerRelease>;
const smtp = z
  .object({
    host: z.string().regex(/^[A-Za-z0-9:._-]{1,253}$/),
    port: z.number().int().min(1).max(65535),
    mode: z.enum(['tls', 'starttls']),
    from: z.email(),
    user: z.string().max(200).optional(),
    password: z.string().max(1024).optional(),
  })
  .strict()
  .refine((v) => !!v.user === !!v.password, 'SMTP username and password must be supplied together');
export const installerInput = z
  .object({
    version: z.literal(1),
    directory: path,
    bundleDirectory: path,
    intentFile: path,
    centralTrustFile: path,
    releaseTrustFile: path,
    caFile: path.optional(),
    privateSubnet: z
      .string()
      .regex(
        /^(?:10\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}|192\.168\.\d{1,3})\.0\/24$/,
      )
      .refine((v) =>
        v
          .slice(0, -3)
          .split('.')
          .every((n) => Number(n) < 256),
      )
      .optional(),
    ingressNetwork: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/),
    authorityOrigin: origin,
    resourceOrigin: origin,
    transferOrigin: origin,
    smtp,
    turnstileSmtp: z
      .object({
        host: z.enum(['localhost', '127.0.0.1', '::1', 'mailpit']),
        port: z.number().int().min(1).max(65535),
        mode: z.literal('starttls'),
        from: z.email(),
      })
      .strict(),
    operatorId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
  })
  .strict()
  .refine(
    (v) => v.authorityOrigin !== v.resourceOrigin,
    'This combined profile requires distinct authority and resource origins',
  );
export type InstallerInput = z.infer<typeof installerInput>;
export const action = z.enum([
  'plan',
  'install',
  'resume',
  'status',
  'verify',
  'pair',
  'sync',
  'owner',
  'retry-open',
  'identity',
]);
export const retryOpenInput = z.strictObject({
  stage: z.string().regex(/^owner-[0-9a-f-]{36}$/),
  administratorCookie: z.string().min(1).max(8192),
});
export const ownerCommand = z
  .object({
    operation: z.enum([
      'provision-user',
      'resend-verification',
      'authority-client',
      'application',
      'dms-operator',
      'bootstrap-operator',
      'configuration',
      'access',
      'release',
      'module-access',
    ]),
    subcommand: z
      .string()
      .regex(/^[a-z][a-z-]{0,63}$/)
      .optional(),
    input: z.record(z.string(), z.unknown()),
  })
  .strict();
export type OwnerCommand = z.infer<typeof ownerCommand>;
export const pairingInput = z
  .object({
    product: z.enum(['dms', 'turnstile']),
    file: path,
    mode: z.enum(['setup', 'rebind']).default('setup'),
  })
  .strict();
export const stageJournal = z
  .object({
    version: z.literal(1),
    engineVersion: z.literal(ENGINE_VERSION),
    releaseDigest: digest,
    binding: z.record(z.string(), z.unknown()),
    settings: z.record(z.string(), z.unknown()),
    jobs: z.record(
      z.string().regex(/^[a-z0-9_-]{1,160}$/),
      z
        .object({
          name: z.string(),
          phase: z.enum(['planned', 'created', 'complete', 'superseded']),
          replayable: z.boolean(),
          attempt: z.number().int().min(1).max(100),
          id: z.string().optional(),
          exitCode: z.number().int().optional(),
        })
        .strict(),
    ),
    phase: z.enum(['preparing', 'configured', 'initialized']),
    privateRequest: z.string(),
  })
  .strict();
export type StageJournal = z.infer<typeof stageJournal>;
export const result = z
  .object({
    version: z.literal(1),
    state: z.enum(['complete', 'waiting', 'conflict', 'unavailable']),
    nextActor: z.enum(['operator', 'central-staff', 'customer', 'none']),
    conditions: z.array(z.string()).max(32),
    releaseId: digest.optional(),
    profileDigest: digest.optional(),
    installationId: z.uuid().optional(),
  })
  .strict();
export type InstallerResult = z.infer<typeof result>;

export const identitySetupInput = z
  .object({
    operatorEmail: z.email(),
    operatorPassword: z.string().min(15).max(128),
    initialPermissions: z
      .array(z.enum(['turnstile:access', 'turnstile:dms:capabilities:read']))
      .min(1)
      .max(2)
      .refine((v) => new Set(v).size === v.length && v.includes('turnstile:access')),
  })
  .strict();
