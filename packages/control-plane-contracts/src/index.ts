import { z } from 'zod';
export const PROTOCOL_VERSION = 1;
export const MAX_BODY_BYTES = 32768;
export const DECISION_TYPE = 'thaarei-deployment+jwt';
export const MAX_DECISION_SECONDS = 7 * 86400;
export const RENEW_BELOW_SECONDS = 6 * 86400;
export const id = z.uuid();
export const positive = z.number().int().positive().max(2147483647);
export const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const baseBinding = {
  clientId: id,
  installationId: id,
  productId: id,
  localInstallationId: id,
  tenantId: id,
};
export const binding = z.discriminatedUnion('product', [
  z.object({ ...baseBinding, product: z.literal('dms'), applicationId: z.null() }).strict(),
  z.object({ ...baseBinding, product: z.literal('turnstile'), applicationId: id }).strict(),
]);
export type Binding = z.infer<typeof binding>;
export const audience = (value: Binding) => `urn:thaarei:deployment:${value.productId}`;
export const sameBinding = (a: Binding, b: Binding) =>
  Object.keys(baseBinding).every(
    (k) => a[k as keyof typeof baseBinding] === b[k as keyof typeof baseBinding],
  ) &&
  a.product === b.product &&
  a.applicationId === b.applicationId;
export const origin = z
  .string()
  .url()
  .refine((value) => {
    const u = new URL(value);
    return u.origin === value && u.protocol === 'https:' && !u.username && !u.password;
  });
// Exported by the product's private bootstrap from its durable identity, before central registration.
export const localSetupManifest = z.discriminatedUnion('product', [
  z
    .object({
      version: z.literal(1),
      localInstallationId: id,
      tenantId: id,
      product: z.literal('dms'),
      applicationId: z.null(),
      environment: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/),
      buildVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$/),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      localInstallationId: id,
      tenantId: id,
      product: z.literal('turnstile'),
      applicationId: id,
      environment: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/),
      buildVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$/),
    })
    .strict(),
]);
export const manifest = z.object({ version: z.literal(1), origin, binding }).strict();
export const pairingFile = manifest
  .extend({ pairingId: id, code: secret, expiresAt: z.iso.datetime() })
  .strict();
export const activateRequest = z
  .object({
    version: z.literal(1),
    requestId: id,
    binding,
    pairingId: id,
    code: secret,
    candidateSecret: secret,
  })
  .strict();
export const machineReceipt = z
  .object({
    version: z.literal(1),
    requestId: id,
    binding,
    epoch: id,
    generation: positive,
    operationId: id,
  })
  .strict();
export const appliedDecision = z
  .object({
    decisionId: id,
    policyRevision: positive,
    decisionSequence: positive,
    appliedAt: positive,
  })
  .strict();
// Operational fields are bounded safe metadata; aggregate/history reporting is owned by TCP-I07.
const reportOrdering = {
  reportEpoch: id.optional(),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  localState: z.enum(['pending', 'approved', 'rejected', 'suspended']).nullable().optional(),
  appliedPolicyRevision: positive.nullable().optional(),
};
export const usageCounters = z
  .object({
    epoch: id,
    startedAt: z.iso.datetime(),
    publishedDocuments: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    publishedVersions: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    completedProcessingJobs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  })
  .strict();
const dmsReport = z
  .object({
    product: z.literal('dms'),
    ...reportOrdering,
    activeDocuments: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    retainedOriginalBytes: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable()
      .optional(),
    counters: usageCounters.optional(),
    observedAt: z.iso.datetime(),
    buildVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$/),
    processingReady: z.boolean(),
    pendingJobs: z.number().int().nonnegative().max(2147483647),
    failedJobs: z.number().int().nonnegative().max(2147483647),
    outbox: z.number().int().nonnegative().max(2147483647),
    storageFreeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    scratchFreeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  })
  .strict();
export const machineReport = z.discriminatedUnion('product', [
  dmsReport,
  z
    .object({
      product: z.literal('turnstile'),
      ...reportOrdering,
      observedAt: z.iso.datetime(),
      buildVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$/),
      activeMembers: z.number().int().nonnegative().max(2147483647),
    })
    .strict(),
]);
export const syncRequest = z
  .object({
    version: z.literal(1),
    reportId: id,
    report: machineReport.optional(),
    binding,
    epoch: id.nullable(),
    applied: appliedDecision.nullable(),
  })
  .strict()
  .refine((value) => !value.report || value.report.product === value.binding.product)
  .refine(
    (value) =>
      !value.report ||
      (value.report.reportEpoch === undefined && value.report.sequence === undefined) ||
      (value.report.reportEpoch === value.epoch && value.report.sequence !== undefined),
  );
export const rotateRequest = z
  .object({
    version: z.literal(1),
    operationId: id,
    binding,
    epoch: id,
    expectedGeneration: positive,
    candidateSecret: secret,
  })
  .strict();
export const syncResponse = z
  .object({
    version: z.literal(1),
    receiptId: id,
    binding,
    epoch: id,
    generation: positive,
    operationId: id,
    decision: z.string().min(100).max(8192),
  })
  .strict();
const decisionBase = {
  version: z.literal(1),
  iss: origin,
  aud: z.string().min(1).max(120),
  binding,
  epoch: id,
  policyRevision: positive,
  decisionSequence: positive,
  decisionId: id,
  iat: positive,
  nbf: positive,
  exp: positive,
};
export const decision = z.discriminatedUnion('state', [
  z
    .object({
      ...decisionBase,
      state: z.literal('approved'),
      entitlement: z.literal('product-business'),
    })
    .strict(),
  ...(['pending', 'rejected', 'suspended'] as const).map((state) =>
    z.object({ ...decisionBase, state: z.literal(state) }).strict(),
  ),
]);
export type Decision = z.infer<typeof decision>;
export type SyncRequest = z.infer<typeof syncRequest>;
export type SyncResponse = z.infer<typeof syncResponse>;
export const pairingCommand = z
  .object({
    requestId: id,
    productId: id,
    revision: positive,
    action: z.enum(['issue', 'revoke', 'replace', 'revoke-credential']),
    pairingId: id,
    code: secret.nullable(),
    reason: z.string().trim().min(1).max(300),
  })
  .strict()
  .refine((c) =>
    ['revoke', 'revoke-credential'].includes(c.action) ? c.code === null : c.code !== null,
  );
export const machineError = z
  .object({
    version: z.literal(1),
    error: z.enum([
      'INVALID_INPUT',
      'MACHINE_CREDENTIAL_REQUIRED',
      'DENIED',
      'NOT_FOUND',
      'RECONCILIATION_REQUIRED',
      'BODY_TOO_LARGE',
      'JSON_REQUIRED',
      'UNAVAILABLE',
    ]),
  })
  .strict();
// Private installer readback, scoped to the authenticated product's exact current epoch.
// This projection is not a signed decision and cannot authorize business access.
export const machineStatusRequest = z
  .object({ version: z.literal(1), binding, epoch: id })
  .strict();
export const machineStatusResponse = z
  .object({
    version: z.literal(1),
    binding,
    epoch: id,
    policyRevision: positive,
    policyState: z.enum(['pending', 'approved', 'rejected', 'suspended']),
    paired: z.boolean(),
    activationAcknowledged: z.boolean(),
    moduleDesired: z
      .object({
        catalogueDigest: z.string().regex(/^[a-f0-9]{64}$/),
        profileDigest: z.string().regex(/^[a-f0-9]{64}$/),
        assignmentRevision: positive,
      })
      .strict()
      .nullable(),
    lastContactAt: z.iso.datetime().nullable(),
    reportReceivedAt: z.iso.datetime().nullable(),
    reportFreshness: z.enum(['never', 'current', 'stale']),
  })
  .strict();

const schemas = {
  MachineError: machineError,
  MachineReport: machineReport,
  LocalSetupManifest: localSetupManifest,
  Binding: binding,
  SetupManifest: manifest,
  PairingFile: pairingFile,
  ActivationRequest: activateRequest,
  MachineReceipt: machineReceipt,
  SyncRequest: syncRequest,
  SyncResponse: syncResponse,
  RotationRequest: rotateRequest,
  MachineStatusRequest: machineStatusRequest,
  MachineStatusResponse: machineStatusResponse,
  Decision: decision,
};
export const openApi = {
  openapi: '3.1.0',
  info: { title: 'Thaarei deployment control machine API', version: '1.0.0' },
  components: {
    schemas: Object.fromEntries(
      Object.entries(schemas).map(([key, value]) => [
        key,
        z.toJSONSchema(value, { target: 'draft-2020-12' }),
      ]),
    ),
    securitySchemes: {
      productKey: {
        type: 'http',
        scheme: 'bearer',
        description:
          'Per-product random machine secret; never a staff session or customer access token.',
      },
    },
  },
  paths: Object.fromEntries(
    (
      [
        ['activate', 'ActivationRequest', 'MachineReceipt'],
        ['sync', 'SyncRequest', 'SyncResponse'],
        ['status', 'MachineStatusRequest', 'MachineStatusResponse'],
        ['rotate', 'RotationRequest', 'MachineReceipt'],
      ] as const
    ).map(([name, input, output]) => [
      `/api/machine/v1/${name}`,
      {
        post: {
          operationId: name,
          security: name === 'activate' ? [] : [{ productKey: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: `#/components/schemas/${input}` } } },
          },
          responses: {
            '200': {
              description: 'Committed result; only the signed decision grants authorization.',
              content: {
                'application/json': { schema: { $ref: `#/components/schemas/${output}` } },
              },
            },
            '400': { description: 'Strict validation failure' },
            '401': { description: 'Product credential required' },
            '409': {
              description: 'Binding, operation or generation conflict; reconcile before retry',
            },
            '413': {
              description: name === 'status' ? 'Body exceeds 4 KiB' : 'Body exceeds 32 KiB',
            },
            '503': { description: 'Unavailable or recovery quarantine' },
          },
        },
      },
    ]),
  ),
};
