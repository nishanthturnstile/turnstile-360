import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  foreignKey,
  integer,
  pgPolicy,
  pgRole,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const dmsSchema = pgSchema('dms');
export const tenantPolicy = (tenantId: AnyPgColumn) =>
  pgPolicy('tenant_isolation', {
    for: 'all',
    to: [pgRole('thaarei_dms_runtime').existing(), pgRole('thaarei_dms_migrator').existing()],
    using: sql`${tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
    withCheck: sql`${tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
  });
export const installation = dmsSchema.table(
  'installation',
  {
    singleton: integer().primaryKey().default(1),
    tenantId: uuid('tenant_id').notNull().unique(),
    customerKey: text('customer_key').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('one_installation', sql`${table.singleton} = 1`)],
);

export const applicationRegistration = dmsSchema
  .table(
    'application_registration',
    {
      id: uuid().primaryKey(),
      tenantId: uuid('tenant_id').notNull(),
      issuer: text().notNull(),
      clientId: text('client_id').notNull(),
      name: text().notNull(),
      status: text().notNull().default('pending'),
      principalKind: text('principal_kind').notNull().default('consumer'),
      scopeCeiling: text('scope_ceiling').array().notNull().default(sql`'{}'::text[]`),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      foreignKey({ columns: [table.tenantId], foreignColumns: [installation.tenantId] }),
      unique('application_tenant_identity').on(table.tenantId, table.id),
      unique('application_client_identity').on(table.tenantId, table.issuer, table.clientId),
      unique('application_enrollment_identity').on(
        table.tenantId,
        table.id,
        table.issuer,
        table.clientId,
      ),
      check('application_status', sql`${table.status} IN ('pending', 'active', 'disabled')`),
      check(
        'application_principal_kind',
        sql`${table.principalKind} IN ('consumer', 'publisher', 'scanner', 'extractor')`,
      ),
      pgPolicy('tenant_isolation', {
        for: 'all',
        to: [pgRole('thaarei_dms_runtime').existing(), pgRole('thaarei_dms_migrator').existing()],
        using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
        withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
      }),
    ],
  )
  .enableRLS();
