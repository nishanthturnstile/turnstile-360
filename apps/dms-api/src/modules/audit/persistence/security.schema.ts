import { sql } from 'drizzle-orm';
import { check, foreignKey, index, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { dmsSchema, installation, tenantPolicy } from '../../access/persistence/dms.schema.js';

// Fixed bounded fields only: no arbitrary request bodies, credentials or personal profiles.
export const securityEvent = dmsSchema
  .table(
    'security_event',
    {
      id: uuid().primaryKey(),
      tenantId: uuid('tenant_id').notNull(),
      action: text().notNull(),
      outcome: text().notNull(),
      actorKind: text('actor_kind').notNull(),
      actorId: text('actor_id').notNull(),
      subjectId: text('subject_id').notNull(),
      requestId: uuid('request_id'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      foreignKey({ columns: [table.tenantId], foreignColumns: [installation.tenantId] }),
      check(
        'security_event_bounds',
        sql`length(${table.actorId}) BETWEEN 1 AND 200 AND length(${table.subjectId}) BETWEEN 1 AND 128 AND ${table.action} ~ '^[a-z][a-z0-9_.-]{0,47}$'`,
      ),
      check('security_event_outcome', sql`${table.outcome} IN ('success', 'denied', 'pending')`),
      check('security_event_actor_kind', sql`${table.actorKind} IN ('operator', 'machine')`),
      index('security_event_retention_idx').on(table.tenantId, table.createdAt),
      tenantPolicy(table.tenantId),
    ],
  )
  .enableRLS();
