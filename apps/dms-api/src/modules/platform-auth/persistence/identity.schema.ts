import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const auth = pgSchema('auth');
const binding = () => ({
  tenantId: uuid('tenant_id').notNull(),
  applicationId: uuid('application_id').notNull(),
  clientId: text('client_id').notNull(),
});
const time = (name: string) => timestamp(name, { withTimezone: true }).notNull();
export const identityEpoch = auth.table(
  'identity_epoch',
  {
    ...binding(),
    invitationId: uuid('invitation_id').notNull(),
    generation: integer('generation').notNull(),
    email: text('email').notNull(),
    expiresAt: time('expires_at'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.applicationId, t.clientId, t.invitationId] }),
    check('identity_epoch_generation', sql`${t.generation} > 0`),
  ],
);
export const identityPreparation = auth.table(
  'identity_preparation',
  {
    ...binding(),
    id: uuid('id').notNull(),
    invitationId: uuid('invitation_id').notNull(),
    generation: integer('generation').notNull(),
    email: text('email').notNull(),
    requestHash: text('request_hash').notNull(),
    receiptHash: text('receipt_hash').notNull(),
    sealedReceipt: text('sealed_receipt').notNull(),
    exchangedAt: timestamp('exchanged_at', { withTimezone: true }),
    expiresAt: time('expires_at'),
    retainedUntil: time('retained_until'),
    userId: text('user_id'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.applicationId, t.clientId, t.id] }),
    unique('identity_receipt_hash').on(t.receiptHash),
    index('identity_preparation_retention').on(t.retainedUntil),
    foreignKey({
      columns: [t.tenantId, t.applicationId, t.clientId, t.invitationId],
      foreignColumns: [
        identityEpoch.tenantId,
        identityEpoch.applicationId,
        identityEpoch.clientId,
        identityEpoch.invitationId,
      ],
    }).onDelete('cascade'),
  ],
);
export const identitySetup = auth.table(
  'identity_setup',
  {
    ...binding(),
    digest: text('digest').primaryKey(),
    preparationId: uuid('preparation_id').notNull(),
    expiresAt: time('expires_at'),
  },
  (t) => [
    index('identity_setup_preparation').on(
      t.tenantId,
      t.applicationId,
      t.clientId,
      t.preparationId,
    ),
    index('identity_setup_expiry').on(t.expiresAt),
    foreignKey({
      columns: [t.tenantId, t.applicationId, t.clientId, t.preparationId],
      foreignColumns: [
        identityPreparation.tenantId,
        identityPreparation.applicationId,
        identityPreparation.clientId,
        identityPreparation.id,
      ],
    }).onDelete('cascade'),
  ],
);
export const identitySubject = auth.table(
  'identity_subject',
  {
    ...binding(),
    memberId: uuid('member_id').notNull(),
    userId: text('user_id').notNull(),
    memberVersion: integer('member_version').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.applicationId, t.clientId, t.memberId] }),
    unique('identity_subject_user').on(t.tenantId, t.applicationId, t.clientId, t.userId),
    check('identity_subject_version', sql`${t.memberVersion} > 0`),
  ],
);
export const identityAudit = auth.table(
  'identity_audit',
  {
    ...binding(),
    id: uuid('id').primaryKey(),
    action: text('action').notNull(),
    operationId: uuid('operation_id'),
    createdAt: time('created_at'),
  },
  (t) => [
    index('identity_audit_retention').on(t.createdAt),
    check(
      'identity_audit_action',
      sql`${t.action} IN ('prepare', 'complete', 'project', 'cancel')`,
    ),
  ],
);
export const identityLimit = auth.table(
  'identity_limit',
  {
    tenantId: uuid('tenant_id').notNull(),
    key: text('key').notNull(),
    window: time('window'),
    count: integer('count').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.key, t.window] }),
    index('identity_limit_expiry').on(t.window),
  ],
);
