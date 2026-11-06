import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgRole,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { dmsSchema } from '../../access/persistence/dms.schema.js';
import { extractionStage } from './extraction.schema.js';
import { processingRun } from './results.schema.js';

const vector = customType<{ data: string }>({ dataType: () => 'tsvector' });
const tenant = sql`tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid`;
const policies = () => [
  pgPolicy('maintenance', {
    for: 'all',
    to: pgRole('thaarei_dms_migrator').existing(),
    using: tenant,
    withCheck: tenant,
  }),
  pgPolicy('coordinator', {
    for: 'all',
    to: pgRole('thaarei_dms_coordinator').existing(),
    using: tenant,
    withCheck: tenant,
  }),
  pgPolicy('reader', {
    for: 'select',
    to: pgRole('thaarei_dms_runtime').existing(),
    using: sql`${tenant} AND dms.search_stage_visible(stage_id)`,
  }),
];
export const searchGeneration = dmsSchema
  .table(
    'search_generation',
    {
      stageId: uuid('stage_id').primaryKey(),
      tenantId: uuid('tenant_id').notNull(),
      runId: uuid('run_id').notNull(),
      status: text().notNull(),
    },
    (t) => [
      foreignKey({
        columns: [t.tenantId, t.stageId],
        foreignColumns: [extractionStage.tenantId, extractionStage.id],
      }),
      foreignKey({
        columns: [t.tenantId, t.runId],
        foreignColumns: [processingRun.tenantId, processingRun.id],
      }),
      check('search_generation_status', sql`${t.status} IN ('READY','PARTIAL')`),
      index('search_generation_run').on(t.tenantId, t.runId),
      ...policies(),
    ],
  )
  .enableRLS();
export const searchChunk = dmsSchema
  .table(
    'search_chunk',
    {
      stageId: uuid('stage_id')
        .notNull()
        .references(() => searchGeneration.stageId, { onDelete: 'cascade' }),
      tenantId: uuid('tenant_id').notNull(),
      ordinal: integer().notNull(),
      unitId: text('unit_id').notNull(),
      kind: text().notNull(),
      source: jsonb().notNull(),
      text: text().notNull(),
      vector: vector().generatedAlwaysAs(sql`to_tsvector('english'::regconfig,text)`),
    },
    (t) => [
      primaryKey({ columns: [t.stageId, t.ordinal] }),
      check(
        'search_chunk_bounds',
        sql`${t.ordinal} BETWEEN 0 AND 8191 AND char_length(${t.text}) BETWEEN 1 AND 4096 AND octet_length(${t.source}::text)<=4096 AND char_length(${t.unitId})<=160`,
      ),
      index('search_chunk_vector').using('gin', t.vector),
      index('search_chunk_tenant').on(t.tenantId, t.stageId),
      ...policies(),
    ],
  )
  .enableRLS();
