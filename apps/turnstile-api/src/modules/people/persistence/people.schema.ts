import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgRole,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { productSchema } from '../../../infrastructure/database/installation.schema.js';
import { accessMember } from '../../access/access.schema.js';
export const memberDisplay = productSchema
  .table(
    'member_display',
    {
      tenantId: uuid('tenant_id').notNull(),
      memberId: uuid('member_id').notNull(),
      memberVersion: integer('member_version').notNull(),
      userId: text('user_id').notNull(),
      state: text().notNull(),
      name: text(),
      email: text(),
      verifiedAt: timestamp('verified_at', { withTimezone: true }),
      checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.memberId] }),
      foreignKey({
        columns: [t.tenantId, t.memberId],
        foreignColumns: [accessMember.tenantId, accessMember.id],
      }).onDelete('cascade'),
      index('member_display_email_idx').on(t.tenantId, t.email),
      index('member_display_refresh_idx').on(t.tenantId, t.checkedAt),
      check(
        'member_display_shape',
        sql`${t.state} IN ('present','deleted') AND ${t.memberVersion}>0 AND (${t.state}='deleted' OR (${t.name} IS NOT NULL AND ${t.email} IS NOT NULL))`,
      ),
      pgPolicy('installation_isolation', {
        for: 'all',
        to: [
          pgRole('thaarei_turnstile_runtime').existing(),
          pgRole('thaarei_turnstile_migrator').existing(),
        ],
        using: sql`${t.tenantId}=nullif(current_setting('app.tenant_id',true),'')::uuid`,
        withCheck: sql`${t.tenantId}=nullif(current_setting('app.tenant_id',true),'')::uuid`,
      }),
    ],
  )
  .enableRLS();
