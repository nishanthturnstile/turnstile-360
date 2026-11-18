import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { user } from './auth.generated.ts';

const central = pgSchema('control_plane');
const time = (field: string) => timestamp(field, { withTimezone: true }).notNull().defaultNow();
export const registryClient = central.table(
  'registry_client',
  {
    id: uuid('id').primaryKey(),
    code: varchar('code', { length: 32 }).notNull().unique(),
    name: varchar('name', { length: 160 }).notNull(),
    contactName: varchar('contact_name', { length: 100 }),
    contactEmail: varchar('contact_email', { length: 254 }),
    archived: boolean('archived').notNull().default(false),
    revision: integer('revision').notNull().default(1),
    registeredAt: time('registered_at'),
    updatedAt: time('updated_at'),
  },
  (t) => [
    check('registry_client_revision', sql`${t.revision}>0`),
    check('registry_client_code', sql`${t.code} ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'`),
  ],
);
export const registryInstallation = central.table(
  'registry_installation',
  {
    id: uuid('id').primaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => registryClient.id),
    environment: varchar('environment', { length: 32 }).notNull(),
    label: varchar('label', { length: 100 }).notNull(),
    localInstallationId: uuid('local_installation_id').notNull().unique(),
    tenantId: uuid('tenant_id').notNull(),
    registeredAt: time('registered_at'),
  },
  (t) => [
    unique('registry_installation_client_environment').on(t.clientId, t.environment),
    unique('registry_installation_client_pair').on(t.id, t.clientId),
    check(
      'registry_installation_environment',
      sql`${t.environment} ~ '^[a-z0-9][a-z0-9_-]{0,31}$'`,
    ),
  ],
);
export const registryProduct = central.table(
  'registry_product',
  {
    id: uuid('id').primaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => registryClient.id),
    installationId: uuid('installation_id').notNull(),
    product: text('product').notNull(),
    applicationId: uuid('application_id'),
    policyState: text('policy_state').notNull().default('pending'),
    licenceExpiresAt: timestamp('licence_expires_at', { withTimezone: true }),
    revision: integer('revision').notNull().default(1),
    registeredAt: time('registered_at'),
    policyChangedAt: time('policy_changed_at'),
    policyChangedBy: text('policy_changed_by')
      .notNull()
      .references(() => user.id),
    policyReason: varchar('policy_reason', { length: 300 }),
    // Owning pairing metadata for the approval prerequisite. No I03 runtime writer may set it.
    pairingVerifiedAt: timestamp('pairing_verified_at', { withTimezone: true }),
    firstApprovedAt: timestamp('first_approved_at', { withTimezone: true }),
    lastApprovedAt: timestamp('last_approved_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: 'registry_product_installation_client',
      columns: [t.installationId, t.clientId],
      foreignColumns: [registryInstallation.id, registryInstallation.clientId],
    }),
    unique('registry_product_installation_kind').on(t.installationId, t.product),
    index('registry_product_client_idx').on(t.clientId),
    index('registry_product_actor_idx').on(t.policyChangedBy),
    check(
      'registry_product_kind_binding',
      sql`(${t.product}='dms' AND ${t.applicationId} IS NULL) OR (${t.product}='turnstile' AND ${t.applicationId} IS NOT NULL)`,
    ),
    check('registry_product_revision', sql`${t.revision}>0`),
    check(
      'registry_product_policy',
      sql`${t.policyState} IN ('pending','approved','rejected','suspended')`,
    ),
    check(
      'registry_product_approval_pairing',
      sql`${t.policyState}<>'approved' OR ${t.pairingVerifiedAt} IS NOT NULL`,
    ),
    check(
      'registry_product_approval_dates',
      sql`(${t.firstApprovedAt} IS NULL AND ${t.lastApprovedAt} IS NULL) OR (${t.firstApprovedAt} IS NOT NULL AND ${t.lastApprovedAt} IS NOT NULL AND ${t.firstApprovedAt}<=${t.lastApprovedAt})`,
    ),
    check(
      'registry_product_approved_evidence',
      sql`${t.policyState}<>'approved' OR ${t.firstApprovedAt} IS NOT NULL`,
    ),
  ],
);
export const registryReceipt = central.table(
  'registry_receipt',
  {
    requestId: uuid('request_id').primaryKey(),
    actorId: text('actor_id')
      .notNull()
      .references(() => user.id),
    digest: varchar('digest', { length: 64 }).notNull(),
    result: jsonb('result').notNull(),
    committedAt: time('committed_at'),
  },
  (t) => [index('registry_receipt_actor_idx').on(t.actorId)],
);
export const registryAudit = central.table(
  'registry_audit',
  {
    id: uuid('id').primaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => registryClient.id),
    resourceId: uuid('resource_id').notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => user.id),
    actorRole: text('actor_role').notNull(),
    action: text('action').notNull(),
    reason: varchar('reason', { length: 300 }).notNull(),
    before: jsonb('before'),
    after: jsonb('after').notNull(),
    committedAt: time('committed_at'),
  },
  (t) => [
    index('registry_audit_client_time_idx').on(t.clientId, t.committedAt, t.id),
    index('registry_audit_actor_idx').on(t.actorId),
    check('registry_audit_actor_role', sql`${t.actorRole} IN ('admin','operator','viewer')`),
  ],
);
