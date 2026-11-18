import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { user } from './auth.generated.ts';

const central = pgSchema('control_plane');
const time = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow();
export const moduleCode = central.table(
  'module_code',
  {
    id: uuid('id').primaryKey(),
    digest: varchar('digest', { length: 64 }).notNull().unique(),
    document: jsonb('document').notNull(),
    proofDigest: varchar('proof_digest', { length: 64 }).notNull(),
    keyId: varchar('key_id', { length: 80 }).notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => user.id),
    createdAt: time('created_at'),
  },
  (t) => [
    index('module_code_actor_idx').on(t.actorId),
    check('module_code_digest', sql`${t.digest} ~ '^[a-f0-9]{64}$'`),
    check(
      'module_code_document_bound',
      sql`jsonb_typeof(${t.document})='object' AND octet_length(${t.document}::text)<=131072`,
    ),
  ],
);
export const moduleCatalogue = central.table(
  'module_catalogue',
  {
    id: uuid('id').primaryKey(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => moduleCode.id),
    digest: varchar('digest', { length: 64 }).notNull().unique(),
    document: jsonb('document').notNull(),
    revision: integer('revision').notNull().default(1),
    status: text('status').notNull().default('draft'),
    proofDigest: varchar('proof_digest', { length: 64 }),
    keyId: varchar('key_id', { length: 80 }),
    createdAt: time('created_at'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [
    index('module_catalogue_source_idx').on(t.sourceId),
    check('module_catalogue_revision', sql`${t.revision}>0`),
    check('module_catalogue_digest', sql`${t.digest} ~ '^[a-f0-9]{64}$'`),
    check(
      'module_catalogue_document_bound',
      sql`jsonb_typeof(${t.document})='object' AND octet_length(${t.document}::text)<=131072`,
    ),
    check(
      'module_catalogue_state',
      sql`(${t.status}='draft' AND ${t.publishedAt} IS NULL AND ${t.proofDigest} IS NULL AND ${t.keyId} IS NULL) OR (${t.status}='released' AND ${t.publishedAt} IS NOT NULL AND ${t.proofDigest} IS NOT NULL AND ${t.keyId} IS NOT NULL)`,
    ),
  ],
);
export const moduleReceipt = central.table(
  'module_receipt',
  {
    requestId: uuid('request_id').primaryKey(),
    actorId: text('actor_id')
      .notNull()
      .references(() => user.id),
    digest: varchar('digest', { length: 64 }).notNull(),
    result: jsonb('result').notNull(),
    committedAt: time('committed_at'),
  },
  (t) => [index('module_receipt_actor_idx').on(t.actorId)],
);
export const moduleAudit = central.table(
  'module_audit',
  {
    id: uuid('id').primaryKey(),
    resourceId: uuid('resource_id').notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => user.id),
    action: text('action').notNull(),
    reason: varchar('reason', { length: 300 }).notNull(),
    before: jsonb('before'),
    after: jsonb('after').notNull(),
    committedAt: time('committed_at'),
  },
  (t) => [
    index('module_audit_resource_idx').on(t.resourceId, t.committedAt, t.id),
    index('module_audit_actor_idx').on(t.actorId),
  ],
);
