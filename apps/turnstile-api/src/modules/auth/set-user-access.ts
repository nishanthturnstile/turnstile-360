import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  accessAssignmentSchema,
  CONFIGURATION_LIMITS,
  CONFIGURATION_MANAGE_PERMISSION,
  TURNSTILE_PERMISSIONS,
} from '@thaarei/turnstile-contracts';
import { lockConfiguration } from '../../infrastructure/database/configuration-lock.js';
import { withProductOperator } from '../../infrastructure/database/product-operator.js';

export class LastConfigurationManagerError extends Error {
  readonly code = 'LAST_CONFIGURATION_MANAGER_REQUIRED';
}

// Private deployment/operator command. Runtime APIs retain read-only access to grants.
export async function setUserAccess(input: unknown, environment = process.env) {
  const value = accessAssignmentSchema.parse(input);
  const permissions = TURNSTILE_PERMISSIONS.filter((permission) =>
    value.permissions.includes(permission),
  );
  return withProductOperator(environment, async (client, installation) => {
    const tenantId = installation.tenant_id;
    const context = await lockConfiguration(client, tenantId);
    if (!context) throw new Error('Setup initialization required');
    const previous = (
      await client.query<{ enabled: boolean; permissions: string[] }>(
        'SELECT enabled,permissions FROM turnstile.user_access WHERE tenant_id = $1 AND user_id = $2 FOR UPDATE',
        [tenantId, value.userId],
      )
    ).rows[0];
    const wasManager =
      previous?.enabled &&
      previous.permissions.includes('turnstile:access') &&
      previous.permissions.includes(CONFIGURATION_MANAGE_PERMISSION);
    const isManager =
      value.enabled &&
      permissions.includes('turnstile:access') &&
      permissions.includes(CONFIGURATION_MANAGE_PERMISSION);
    if (wasManager && !isManager) {
      const other = (
        await client.query(
          'SELECT EXISTS(SELECT 1 FROM turnstile.user_access WHERE tenant_id = $1 AND user_id <> $2 AND enabled AND permissions @> $3::text[]) AS present',
          [tenantId, value.userId, ['turnstile:access', CONFIGURATION_MANAGE_PERMISSION]],
        )
      ).rows[0];
      if (!other?.present)
        throw new LastConfigurationManagerError('Last configuration manager required');
    }
    const changedFields = [
      previous?.enabled !== value.enabled ? 'enabled' : null,
      !previous ||
      previous.permissions.length !== permissions.length ||
      permissions.some((permission) => !previous.permissions.includes(permission))
        ? 'permissions'
        : null,
    ].filter((field): field is string => field !== null);
    if (changedFields.length) {
      await client.query(
        'INSERT INTO turnstile.user_access (tenant_id,user_id,enabled,permissions) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,user_id) DO UPDATE SET enabled = EXCLUDED.enabled, permissions = EXCLUDED.permissions',
        [tenantId, value.userId, value.enabled, permissions],
      );
      await client.query(
        `INSERT INTO turnstile.configuration_audit (tenant_id,id,actor_kind,actor_id,request_id,action,subject_id,subject_user_id,changed_fields,revision_before,revision_after)
        VALUES ($1,$2,'operator',$3,$4,'access_changed',$1,$5,$6,$7,$7)`,
        [
          tenantId,
          randomUUID(),
          value.operatorId,
          randomUUID(),
          value.userId,
          changedFields,
          context.revision,
        ],
      );
    }
    const at = (await client.query('SELECT statement_timestamp() AS at')).rows[0].at as Date;
    return {
      action: 'set-user-access',
      at: at.toISOString(),
      tenantId,
      applicationId: installation.application_id,
      ...value,
      permissions,
      changed: changedFields.length > 0,
    };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    if (process.stdin.isTTY || process.argv.length !== 2)
      throw new Error('Supply private JSON input');
    process.stdin.setEncoding('utf8');
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > CONFIGURATION_LIMITS.bodyBytes)
        throw new Error('Input too large');
    }
    console.log(JSON.stringify(await setUserAccess(JSON.parse(input))));
  } catch (error) {
    if (error instanceof LastConfigurationManagerError) {
      console.error(JSON.stringify({ code: error.code }));
      process.exitCode = 2;
    } else {
      console.error(
        'Product access assignment failed; check private input, initialized installation and dedicated operator connection',
      );
      process.exitCode = 1;
    }
  }
}
