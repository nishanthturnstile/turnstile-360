import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth.generated.ts';
import { moduleCatalogue } from './module.schema.ts';
import { registryProduct } from './registry.schema.ts';

const central = pgSchema('control_plane');
export const moduleAssignmentEntry = central.table(
  'module_assignment_entry',
  {
    id: uuid('id').primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => registryProduct.id),
    catalogueId: uuid('catalogue_id')
      .notNull()
      .references(() => moduleCatalogue.id),
    kind: text('kind').notNull(),
    revision: integer('revision').notNull(),
    document: jsonb('document').notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('module_assignment_product_revision').on(t.productId, t.revision),
    unique('module_assignment_pointer').on(t.id, t.productId, t.kind),
    check('module_assignment_kind', sql`${t.kind} IN ('draft','approved')`),
    check('module_assignment_revision', sql`${t.revision}>1`),
    check(
      'module_assignment_document_bound',
      sql`jsonb_typeof(${t.document})='object' AND octet_length(${t.document}::text)<=65536`,
    ),
  ],
);
export const moduleAssignmentState = central.table(
  'module_assignment_state',
  {
    productId: uuid('product_id')
      .primaryKey()
      .references(() => registryProduct.id),
    draftId: uuid('draft_id'),
    draftKind: text('draft_kind').notNull().default('draft'),
    desiredId: uuid('desired_id'),
    desiredKind: text('desired_kind').notNull().default('approved'),
  },
  (t) => [
    check(
      'module_assignment_pointer_kinds',
      sql`${t.draftKind}='draft' AND ${t.desiredKind}='approved'`,
    ),
    foreignKey({
      name: 'module_assignment_draft_pointer',
      columns: [t.draftId, t.productId, t.draftKind],
      foreignColumns: [
        moduleAssignmentEntry.id,
        moduleAssignmentEntry.productId,
        moduleAssignmentEntry.kind,
      ],
    }),
    foreignKey({
      name: 'module_assignment_desired_pointer',
      columns: [t.desiredId, t.productId, t.desiredKind],
      foreignColumns: [
        moduleAssignmentEntry.id,
        moduleAssignmentEntry.productId,
        moduleAssignmentEntry.kind,
      ],
    }),
  ],
);
