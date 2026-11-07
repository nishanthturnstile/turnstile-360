import { sql } from 'drizzle-orm';
import { bigint, boolean, jsonb, pgPolicy, pgRole, text, uuid } from 'drizzle-orm/pg-core';
import { dmsSchema, installation } from '../access/persistence/dms.schema.js';

const tenant = sql`tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid`;
export const deploymentControl = dmsSchema
  .table(
    'deployment_control',
    {
      tenantId: uuid('tenant_id')
        .primaryKey()
        .references(() => installation.tenantId),
      localInstallationId: uuid('local_installation_id').notNull().defaultRandom(),
      binding: jsonb('binding'),
      decision: jsonb('decision'),
      markerDigest: text('marker_digest'),
      quarantined: boolean('quarantined').notNull().default(false),
      credentialMetadata: jsonb('credential_metadata'),
    },
    () => [
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
      pgPolicy('runtime_read', {
        for: 'select',
        to: pgRole('thaarei_dms_runtime').existing(),
        using: tenant,
      }),
      pgPolicy('operator_read', {
        for: 'select',
        to: pgRole('thaarei_dms_operator').existing(),
        using: tenant,
      }),
    ],
  )
  .enableRLS();

export const deploymentClockState = dmsSchema
  .table(
    'deployment_clock_state',
    {
      tenantId: uuid('tenant_id')
        .primaryKey()
        .references(() => installation.tenantId),
      lastTime: bigint('last_time', { mode: 'number' }).notNull().default(0),
      quarantined: boolean('quarantined').notNull().default(false),
    },
    () => [
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
      pgPolicy('runtime_read', {
        for: 'select',
        to: pgRole('thaarei_dms_runtime').existing(),
        using: tenant,
      }),
    ],
  )
  .enableRLS();
