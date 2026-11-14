import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgRole,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  installation,
  productSchema,
} from '../../../infrastructure/database/installation.schema.js';

const tenant = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => installation.tenantId);

import { accessRole } from '../../access/access.schema.js';
import { organizationUnit } from '../../organization/persistence/organization.schema.js';

const at = (name: string) =>
  timestamp(name, { withTimezone: true }).notNull().default(sql`statement_timestamp()`);
const policy = (column: AnyPgColumn) =>
  pgPolicy('installation_isolation', {
    for: 'all',
    to: [
      pgRole('thaarei_turnstile_runtime').existing(),
      pgRole('thaarei_turnstile_migrator').existing(),
    ],
    using: sql`${column}=nullif(current_setting('app.tenant_id',true),'')::uuid`,
    withCheck: sql`${column}=nullif(current_setting('app.tenant_id',true),'')::uuid`,
  });
export const invitation = productSchema
  .table(
    'invitation',
    {
      tenantId: tenant(),
      id: uuid().notNull(),
      email: text().notNull(),
      version: integer().notNull().default(1),
      generation: integer().notNull().default(1),
      state: text().notNull(),
      approverId: text('approver_id').notNull(),
      approvalId: uuid('approval_id'),
      assignments: jsonb().notNull(),
      recoveryEpoch: text('recovery_epoch').notNull(),
      createdAt: at('created_at'),
      expiresAt: at('expires_at'),
      invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
      cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
      acceptedAt: timestamp('accepted_at', { withTimezone: true }),
      acceptedUserId: text('accepted_user_id'),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.id] }),
      policy(t.tenantId),
      uniqueIndex('invitation_actionable_email_idx')
        .on(t.tenantId, t.email)
        .where(sql`${t.state} IN ('pending','needs_reapproval')`),
      index('invitation_expiry_idx').on(t.tenantId, t.expiresAt),
      index('invitation_created_idx').on(t.tenantId, t.createdAt, t.id),
      index('invitation_accepted_subject_idx')
        .on(t.tenantId, t.acceptedUserId, t.acceptedAt)
        .where(sql`${t.state}='accepted'`),
      check(
        'invitation_state',
        sql`${t.state} IN ('pending','needs_reapproval','accepted','cancelled','expired')`,
      ),
      check(
        'invitation_versions',
        sql`${t.version} BETWEEN 1 AND 2147483647 AND ${t.generation} BETWEEN 1 AND 2147483647`,
      ),
      check(
        'invitation_email',
        sql`${t.email}=lower(${t.email}) AND length(${t.email}) BETWEEN 3 AND 254`,
      ),
      check(
        'invitation_approval',
        sql`(${t.state} IN ('pending','accepted'))=(${t.approvalId} IS NOT NULL)`,
      ),
    ],
  )
  .enableRLS();
export const invitationGeneration = productSchema
  .table(
    'invitation_generation',
    {
      tenantId: tenant(),
      invitationId: uuid('invitation_id').notNull(),
      generation: integer().notNull(),
      id: uuid().notNull(),
      email: text().notNull(),
      approverId: text('approver_id').notNull(),
      approval: jsonb().notNull(),
      assignments: jsonb().notNull(),
      credentialHash: text('credential_hash').notNull(),
      recoveryEpoch: text('recovery_epoch').notNull(),
      createdAt: at('created_at'),
      expiresAt: at('expires_at'),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.invitationId, t.generation] }),
      policy(t.tenantId),
      uniqueIndex('invitation_credential_idx').on(t.tenantId, t.credentialHash),
      check(
        'invitation_generation_digests',
        sql`${t.credentialHash} ~ '^[0-9a-f]{64}$' AND ${t.recoveryEpoch} ~ '^[0-9a-f]{64}$'`,
      ),
      check(
        'invitation_generation_lifetime',
        sql`${t.expiresAt}>${t.createdAt} AND ${t.expiresAt}<=${t.createdAt}+interval '604800 seconds'`,
      ),
      foreignKey({
        name: 'invitation_generation_owner_fk',
        columns: [t.tenantId, t.invitationId],
        foreignColumns: [invitation.tenantId, invitation.id],
      }).onDelete('cascade'),
    ],
  )
  .enableRLS();
export const invitationReference = productSchema
  .table(
    'invitation_reference',
    {
      tenantId: tenant(),
      id: uuid().notNull(),
      invitationId: uuid('invitation_id').notNull(),
      roleId: uuid('role_id'),
      unitId: uuid('unit_id'),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.id] }),
      policy(t.tenantId),
      check('invitation_reference_kind', sql`(${t.roleId} IS NULL)<>(${t.unitId} IS NULL)`),
      index('invitation_reference_invitation_idx').on(t.tenantId, t.invitationId),
      index('invitation_reference_role_idx').on(t.tenantId, t.roleId),
      index('invitation_reference_unit_idx').on(t.tenantId, t.unitId),
      foreignKey({
        columns: [t.tenantId, t.invitationId],
        foreignColumns: [invitation.tenantId, invitation.id],
      }).onDelete('cascade'),
      foreignKey({
        columns: [t.tenantId, t.roleId],
        foreignColumns: [accessRole.tenantId, accessRole.id],
      }),
      foreignKey({
        columns: [t.tenantId, t.unitId],
        foreignColumns: [organizationUnit.tenantId, organizationUnit.id],
      }),
    ],
  )
  .enableRLS();
export const invitationDelivery = productSchema
  .table(
    'invitation_delivery',
    {
      tenantId: tenant(),
      invitationId: uuid('invitation_id').notNull(),
      generation: integer().notNull(),
      state: text().notNull(),
      attempts: integer().notNull().default(0),
      payload: text(),
      recoveryEpoch: text('recovery_epoch').notNull(),
      nextAttemptAt: at('next_attempt_at'),
      leaseId: uuid('lease_id'),
      leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
      outcomeAt: timestamp('outcome_at', { withTimezone: true }),
      reason: text(),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.invitationId, t.generation] }),
      policy(t.tenantId),
      foreignKey({
        columns: [t.tenantId, t.invitationId, t.generation],
        foreignColumns: [
          invitationGeneration.tenantId,
          invitationGeneration.invitationId,
          invitationGeneration.generation,
        ],
      }).onDelete('cascade'),
      index('invitation_delivery_claim_idx').on(t.tenantId, t.state, t.nextAttemptAt),
      check(
        'invitation_delivery_state',
        sql`${t.state} IN ('queued','sending','smtp_accepted','failed','unknown')`,
      ),
      check('invitation_delivery_attempts', sql`${t.attempts} BETWEEN 0 AND 5`),
      check(
        'invitation_delivery_attempt_state',
        sql`(${t.state}<>'queued' OR ${t.attempts}<5) AND (${t.state} NOT IN ('sending','smtp_accepted','unknown') OR ${t.attempts}>0)`,
      ),
      check(
        'invitation_delivery_payload',
        sql`(${t.state} IN ('queued','sending'))=(${t.payload} IS NOT NULL)`,
      ),
      check(
        'invitation_delivery_lease',
        sql`${t.state}<>'sending' OR (${t.leaseId} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL)`,
      ),
    ],
  )
  .enableRLS();
export const invitationOperation = productSchema
  .table(
    'invitation_operation',
    {
      tenantId: tenant(),
      actorId: text('actor_id').notNull(),
      key: uuid().notNull(),
      invitationId: uuid('invitation_id').notNull(),
      identityOperationId: uuid('identity_operation_id').notNull(),
      input: jsonb().notNull(),
      digest: text().notNull(),
      state: text().notNull().default('preparing'),
      committedAt: timestamp('committed_at', { withTimezone: true }),
      createdAt: at('created_at'),
      expiresAt: timestamp('expires_at', { withTimezone: true })
        .notNull()
        .default(sql`statement_timestamp()+interval '24 hours'`),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.actorId, t.key] }),
      policy(t.tenantId),
      uniqueIndex('invitation_identity_operation_idx').on(t.tenantId, t.identityOperationId),
      index('invitation_operation_expiry_idx').on(t.tenantId, t.expiresAt),
      check('invitation_operation_state', sql`${t.state} IN ('preparing','completed')`),
    ],
  )
  .enableRLS();
export const invitationRate = productSchema
  .table(
    'invitation_rate',
    {
      tenantId: tenant(),
      actor: text().notNull(),
      window: at('window'),
      count: integer().notNull(),
    },
    (t) => [primaryKey({ columns: [t.tenantId, t.actor, t.window] }), policy(t.tenantId)],
  )
  .enableRLS();
export const invitationAudit = productSchema
  .table(
    'invitation_audit',
    {
      tenantId: tenant(),
      id: uuid().notNull(),
      invitationId: uuid('invitation_id').notNull(),
      generation: integer().notNull(),
      actorKind: text('actor_kind').notNull(),
      actorId: text('actor_id'),
      action: text().notNull(),
      createdAt: at('created_at'),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.id] }),
      policy(t.tenantId),
      index('invitation_audit_retention_idx').on(t.tenantId, t.createdAt),
      check(
        'invitation_audit_actions',
        sql`${t.action} IN ('issued','resent','reapproved','cancelled','expired','invalidated','smtp_accepted','delivery_failed','delivery_unknown','accepted','declined')`,
      ),
      check(
        'invitation_audit_actor',
        sql`${t.actorKind} IN ('user','system') AND (${t.actorKind}='system' OR ${t.actorId} IS NOT NULL)`,
      ),
    ],
  )
  .enableRLS();

// Subject-bound result; only the narrow acceptance function can insert it.
export const invitationAcceptance = productSchema
  .table(
    'invitation_acceptance',
    {
      tenantId: tenant(),
      invitationId: uuid('invitation_id').notNull(),
      generation: integer().notNull(),
      userId: text('user_id').notNull(),
      memberId: uuid('member_id').notNull(),
      createdAt: at('created_at'),
      expiresAt: timestamp('expires_at', { withTimezone: true })
        .notNull()
        .default(sql`statement_timestamp()+interval '7 days'`),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.invitationId] }),
      policy(t.tenantId),
      foreignKey({
        columns: [t.tenantId, t.invitationId],
        foreignColumns: [invitation.tenantId, invitation.id],
      }).onDelete('cascade'),
      check(
        'invitation_acceptance_subject',
        sql`${t.userId} ~ '^[A-Za-z0-9_-]{1,200}$' AND ${t.generation}>0`,
      ),
      check('invitation_acceptance_window', sql`${t.expiresAt}=${t.createdAt}+interval '7 days'`),
      index('invitation_acceptance_retention_idx').on(t.tenantId, t.expiresAt),
    ],
  )
  .enableRLS();
