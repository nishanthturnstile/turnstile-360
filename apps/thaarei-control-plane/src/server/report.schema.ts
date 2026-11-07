import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgSchema,
  primaryKey,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { registryProduct } from './registry.schema.ts';

const central = pgSchema('control_plane');
export const reportSnapshot = central.table(
  'report_snapshot',
  {
    id: uuid('id').primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => registryProduct.id),
    epoch: uuid('epoch').notNull(),
    sequence: bigint('sequence', { mode: 'number' }),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb('payload').notNull(),
    counterReset: boolean('counter_reset').notNull().default(false),
  },
  (t) => [
    index('report_snapshot_product_time_idx').on(t.productId, t.receivedAt, t.id),
    index('report_snapshot_retention_idx').on(t.receivedAt, t.id),
    check(
      'report_sequence_bound',
      sql`${t.sequence} IS NULL OR (${t.sequence}>0 AND ${t.sequence}<=9007199254740991)`,
    ),
  ],
);
export const reportLatest = central.table('report_latest', {
  productId: uuid('product_id')
    .primaryKey()
    .references(() => registryProduct.id),
  epoch: uuid('epoch').notNull(),
  reportId: uuid('report_id').notNull(),
  sequence: bigint('sequence', { mode: 'number' }),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  payload: jsonb('payload'),
});
export const reportCounter = central.table(
  'report_counter',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => registryProduct.id),
    epoch: uuid('epoch').notNull(),
    counterEpoch: uuid('counter_epoch').notNull(),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    totals: jsonb('totals').notNull(),
    retired: boolean('retired').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.productId, t.epoch, t.counterEpoch] })],
);
