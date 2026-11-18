import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { registryProduct } from './registry.schema.ts';

const central = pgSchema('control_plane');
const time = (name: string) => timestamp(name, { withTimezone: true });
export const machineAuthority = central.table(
  'machine_authority',
  {
    slot: integer('slot').primaryKey(),
    markerDigest: varchar('marker_digest', { length: 64 }).notNull(),
  },
  (t) => [check('machine_authority_singleton', sql`${t.slot}=1`)],
);
export const machine = central.table(
  'machine',
  {
    productId: uuid('product_id')
      .primaryKey()
      .references(() => registryProduct.id),
    epoch: uuid('epoch').notNull(),
    generation: integer('generation').notNull(),
    secretDigest: varchar('secret_digest', { length: 64 }).notNull(),
    operationId: uuid('operation_id').notNull(),
    revokedAt: time('revoked_at'),
    sequence: integer('sequence').notNull().default(0),
    firstIssuedAt: time('first_issued_at'),
    firstAcknowledgedAt: time('first_acknowledged_at'),
    currentAcknowledgedAt: time('current_acknowledged_at'),
    lastContactAt: time('last_contact_at'),
  },
  (t) => [
    uniqueIndex('machine_secret_digest_idx').on(t.secretDigest),
    check('machine_generation_positive', sql`${t.generation}>0 AND ${t.sequence}>=0`),
  ],
);
export const pairing = central.table(
  'pairing',
  {
    id: uuid('id').primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => registryProduct.id),
    codeDigest: varchar('code_digest', { length: 64 }).notNull(),
    issuedAt: time('issued_at').notNull().defaultNow(),
    expiresAt: time('expires_at').notNull(),
    revokedAt: time('revoked_at'),
    consumedAt: time('consumed_at'),
    requestId: uuid('request_id'),
    inputDigest: varchar('input_digest', { length: 64 }),
    receipt: jsonb('receipt'),
  },
  (t) => [
    index('pairing_product_idx').on(t.productId),
    check(
      'pairing_consumption_complete',
      sql`(${t.consumedAt} IS NULL AND ${t.requestId} IS NULL AND ${t.inputDigest} IS NULL AND ${t.receipt} IS NULL) OR (${t.consumedAt} IS NOT NULL AND ${t.requestId} IS NOT NULL AND ${t.inputDigest} IS NOT NULL AND ${t.receipt} IS NOT NULL)`,
    ),
  ],
);
export const machineReceipt = central.table(
  'machine_receipt',
  {
    id: uuid('id').primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => registryProduct.id),
    kind: text('kind').notNull(),
    digest: varchar('digest', { length: 64 }).notNull(),
    result: jsonb('result').notNull(),
    committedAt: time('committed_at').notNull().defaultNow(),
  },
  (t) => [
    index('machine_receipt_product_idx').on(t.productId),
    check('machine_receipt_kind', sql`${t.kind} IN ('sync','rotate')`),
  ],
);
export const machineDecision = central.table(
  'machine_decision',
  {
    id: uuid('id').primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => registryProduct.id),
    epoch: uuid('epoch').notNull(),
    revision: integer('revision').notNull(),
    sequence: integer('sequence').notNull(),
    state: text('state').notNull(),
    token: text('token').notNull(),
    issuedAt: time('issued_at').notNull(),
    expiresAt: time('expires_at').notNull(),
  },
  (t) => [
    index('machine_decision_current_idx').on(t.productId, t.epoch, t.revision, t.sequence),
    uniqueIndex('machine_decision_application_binding_idx').on(t.productId, t.epoch, t.id),
    check('machine_decision_order', sql`${t.revision}>0 AND ${t.sequence}>0`),
    check(
      'machine_decision_state',
      sql`${t.state} IN ('pending','approved','rejected','suspended')`,
    ),
  ],
);

// Presence is a permanent v2 floor. Runtime may create a closed fence, but cannot
// delete it or directly update active authority. MOD-I08 uses its reviewed SQL writer.
export const moduleAuthority = central.table(
  'module_authority',
  {
    productId: uuid('product_id')
      .primaryKey()
      .references(() => registryProduct.id),
    minimumVersion: integer('minimum_version').notNull().default(2),
    document: jsonb('document'),
  },
  (t) => [
    check('module_authority_version', sql`${t.minimumVersion}=2`),
    check(
      'module_authority_bound',
      sql`${t.document} IS NULL OR (jsonb_typeof(${t.document})='object' AND octet_length(${t.document}::text)<=131072)`,
    ),
  ],
);

// Authenticated machine observation is an installation claim, not an attestation or grant.
export const moduleObservation = central.table(
  'module_observation',
  {
    productId: uuid('product_id')
      .primaryKey()
      .references(() => registryProduct.id),
    epoch: uuid('epoch').notNull(),
    installed: jsonb('installed').notNull(),
    observedAt: time('observed_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'module_observation_bound',
      sql`jsonb_typeof(${t.installed})='object' AND octet_length(${t.installed}::text)<=1024`,
    ),
  ],
);

// Validated product-reported application evidence; never independent runtime attestation.
export const machineApplication = central.table(
  'machine_application',
  {
    productId: uuid('product_id')
      .primaryKey()
      .references(() => registryProduct.id),
    epoch: uuid('epoch').notNull(),
    decisionId: uuid('decision_id').notNull(),
    appliedAt: time('applied_at').notNull(),
    receivedAt: time('received_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.productId, t.epoch, t.decisionId],
      foreignColumns: [machineDecision.productId, machineDecision.epoch, machineDecision.id],
      name: 'machine_application_decision_binding_fk',
    }),
  ],
);
