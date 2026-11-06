import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgPolicy,
  pgRole,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { applicationRegistration, dmsSchema } from '../../access/persistence/dms.schema.js';
import { document } from './registry.schema.js';

const tenant = sql`tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid`;
const owner = sql`${tenant} AND current_setting('app.principal_kind',true)='machine' AND owner_application_id=nullif(current_setting('app.application_id',true),'')::uuid`;
const operator = sql`${tenant} AND current_setting('app.principal_kind',true)='operator' AND EXISTS(SELECT 1 FROM dms.operator_authorization WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND subject_id=current_setting('app.actor_id',true) AND revoked_at IS NULL)`;
export const documentGrant = dmsSchema
  .table(
    'document_grant',
    {
      tenantId: uuid('tenant_id').notNull(),
      ownerApplicationId: uuid('owner_application_id').notNull(),
      documentId: uuid('document_id').notNull(),
      applicationId: uuid('application_id').notNull(),
      rights: text().array().notNull(),
    },
    (t) => [
      unique('document_grant_identity').on(t.tenantId, t.documentId, t.applicationId),
      foreignKey({
        columns: [t.tenantId, t.ownerApplicationId, t.documentId],
        foreignColumns: [document.tenantId, document.applicationId, document.id],
      }),
      foreignKey({
        columns: [t.tenantId, t.applicationId],
        foreignColumns: [applicationRegistration.tenantId, applicationRegistration.id],
      }),
      check(
        'document_grant_bounds',
        sql`${t.ownerApplicationId}<>${t.applicationId} AND cardinality(${t.rights}) BETWEEN 1 AND 3 AND ${t.rights}<@ARRAY['READ','EDIT_METADATA','ADD_VERSION']::text[]`,
      ),
      index('document_grant_recipient').on(t.tenantId, t.applicationId, t.documentId),
      pgPolicy('machine_read', {
        for: 'select',
        to: pgRole('thaarei_dms_runtime').existing(),
        using: sql`${tenant} AND (owner_application_id=nullif(current_setting('app.application_id',true),'')::uuid OR application_id=nullif(current_setting('app.application_id',true),'')::uuid)`,
      }),
      pgPolicy('owner_insert', {
        for: 'insert',
        to: pgRole('thaarei_dms_runtime').existing(),
        withCheck: owner,
      }),
      pgPolicy('owner_delete', {
        for: 'delete',
        to: pgRole('thaarei_dms_runtime').existing(),
        using: owner,
      }),
      pgPolicy('operator_manage', {
        for: 'all',
        to: pgRole('thaarei_dms_operator').existing(),
        using: operator,
        withCheck: operator,
      }),
      pgPolicy('maintenance', {
        for: 'all',
        to: pgRole('thaarei_dms_migrator').existing(),
        using: tenant,
        withCheck: tenant,
      }),
    ],
  )
  .enableRLS();
