import { z } from 'zod';

// App-owned, platform-independent staff registry contracts. Machine protocol belongs to TCP-I04.
export const REGISTRY_PAGE_SIZE = 50;
export const INSTALLATIONS_PER_CLIENT = 100;
const id = z.uuid().toLowerCase();
const revision = z.number().int().min(1).max(2147483647);
const expectedRevision = revision.max(2147483646);
const reason = z.string().trim().min(1).max(300);
const name = z.string().trim().min(1).max(160);
const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,31}$/);
const contactName = z.string().trim().min(1).max(100).nullable();
const contactEmail = z.email().max(254).toLowerCase().nullable();
export const policyState = z.enum(['pending', 'approved', 'rejected', 'suspended']);
export const clientCreate = z
  .object({
    type: z.literal('client.create'),
    requestId: id,
    code,
    name,
    contactName: contactName.default(null),
    contactEmail: contactEmail.default(null),
    reason,
  })
  .strict();
export const clientUpdate = z
  .object({
    type: z.literal('client.update'),
    requestId: id,
    id,
    revision: expectedRevision,
    name,
    contactName,
    contactEmail,
    archived: z.boolean(),
    reason,
  })
  .strict();
export const installationCreate = z
  .object({
    type: z.literal('installation.create'),
    requestId: id,
    clientId: id,
    environment: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/),
    label: z.string().trim().min(1).max(100),
    localInstallationId: id,
    tenantId: id,
    reason,
  })
  .strict();
export const productCreate = z
  .object({
    type: z.literal('product.create'),
    requestId: id,
    clientId: id,
    installationId: id,
    binding: z.discriminatedUnion('product', [
      z.object({ product: z.literal('dms'), applicationId: z.null() }).strict(),
      z.object({ product: z.literal('turnstile'), applicationId: id }).strict(),
    ]),
    reason,
  })
  .strict();
export const productPolicy = z
  .object({
    type: z.literal('product.policy'),
    requestId: id,
    id,
    revision: expectedRevision,
    decision: z.enum(['approve', 'reject', 'suspend']),
    reason,
  })
  .strict();
export const registryCommand = z.discriminatedUnion('type', [
  clientCreate,
  clientUpdate,
  installationCreate,
  productCreate,
  productPolicy,
]);
export type RegistryCommand = z.infer<typeof registryCommand>;
export const registryQuery = z
  .object({
    q: z.string().trim().max(100).default(''),
    archived: z.enum(['active', 'archived', 'all']).default('active'),
    after: code.optional(),
  })
  .strict();
export const receipt = z
  .object({
    requestId: id,
    resourceKind: z.enum(['client', 'installation', 'product']),
    resourceId: id,
    clientId: id,
    revision: revision.nullable(),
    committedAt: z.iso.datetime(),
  })
  .strict();
export type RegistryReceipt = z.infer<typeof receipt>;
export const clientRecord = z
  .object({
    id,
    code,
    name,
    contactName,
    contactEmail,
    archived: z.boolean(),
    revision,
    registeredAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ClientRecord = z.infer<typeof clientRecord>;
export const installationRecord = z
  .object({
    id,
    clientId: id,
    environment: z.string(),
    label: z.string(),
    localInstallationId: id,
    tenantId: id,
    registeredAt: z.iso.datetime(),
  })
  .strict();
export type InstallationRecord = z.infer<typeof installationRecord>;
export const productRecord = z
  .object({
    id,
    clientId: id,
    installationId: id,
    product: z.enum(['dms', 'turnstile']),
    applicationId: id.nullable(),
    localInstallationId: id,
    tenantId: id,
    environment: z.string(),
    policyState,
    revision,
    registeredAt: z.iso.datetime(),
    policyChangedAt: z.iso.datetime(),
    policyChangedBy: z.string(),
    policyReason: z.string().nullable(),
    pairingVerifiedAt: z.iso.datetime().nullable(),
    firstApprovedAt: z.iso.datetime().nullable(),
    lastApprovedAt: z.iso.datetime().nullable(),
    // TCP-I04 owns issued/application/contact metadata; activity/version await TCP-I07.
    firstActivationAcknowledgedAt: z.iso.datetime().nullable(),
    currentActivationAcknowledgedAt: z.iso.datetime().nullable(),
    firstIssuedApprovalAt: z.iso.datetime().nullable(),
    firstReportedActivityAt: z.null(),
    lastContactAt: z.iso.datetime().nullable(),
    reportedVersion: z.null(),
  })
  .strict();
export type ProductRecord = z.infer<typeof productRecord>;
export const auditRecord = z
  .object({
    id,
    clientId: id,
    resourceId: id,
    action: z.string(),
    actorId: z.string(),
    actorRole: z.enum(['admin', 'operator', 'viewer']),
    reason: z.string(),
    before: z.record(z.string(), z.unknown()).nullable(),
    after: z.record(z.string(), z.unknown()),
    committedAt: z.iso.datetime(),
  })
  .strict();
export const clientDetail = z
  .object({
    client: clientRecord,
    installations: z.array(installationRecord),
    products: z.array(productRecord),
    activity: z.array(auditRecord),
  })
  .strict();
export type ClientDetail = z.infer<typeof clientDetail>;
export const clientList = z
  .object({ clients: z.array(clientRecord), nextCursor: z.string().nullable() })
  .strict();
export type ClientList = z.infer<typeof clientList>;
