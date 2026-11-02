import { sql } from 'drizzle-orm';
import { check, integer, pgSchema, text, uuid } from 'drizzle-orm/pg-core';

export const productSchema = pgSchema('turnstile');
export const installation = productSchema.table(
  'installation',
  {
    singleton: integer().primaryKey().default(1),
    tenantId: uuid('tenant_id').notNull().unique(),
    customerKey: text('customer_key').notNull().unique(),
    applicationId: uuid('application_id').notNull().unique(),
  },
  (table) => [check('one_installation', sql`${table.singleton} = 1`)],
);
