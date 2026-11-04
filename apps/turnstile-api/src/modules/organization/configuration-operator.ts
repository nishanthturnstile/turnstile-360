import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIGURATION_LIMITS, configurationActorSchema } from '@thaarei/turnstile-contracts';
import { z } from 'zod';
import { lockConfiguration } from '../../infrastructure/database/configuration-lock.js';
import { withProductOperator } from '../../infrastructure/database/product-operator.js';
import { accessCounts, configurationManagerIds } from '../access/access-evaluator.js';
import { lockAccess } from '../access/access-transactions.js';
import type { ConfigurationRecord } from './persistence/organization.repository.js';

const operatorInput = z.strictObject({ operatorId: configurationActorSchema });
export type ConfigurationOperation = 'verify-installation' | 'initialize' | 'inspect' | 'prune';

// One-off owning migrator only. Never calls runtime bootstrap or queries authority tables.
export async function configurationOperator(
  operation: ConfigurationOperation,
  input: unknown,
  environment = process.env,
) {
  z.enum(['verify-installation', 'initialize', 'inspect', 'prune']).parse(operation);
  const { operatorId } = operatorInput.parse(input);
  return withProductOperator(environment, async (client, installed) => {
    const tenantId = installed.tenant_id;
    // Release preflight also works on the pre-onboarding schema. The shared
    // operator verifies the existing identity/role without inserting anything.
    if (operation === 'verify-installation')
      return {
        action: 'configuration-verify-installation',
        operatorId,
        tenantId,
        applicationId: installed.application_id,
        at: (
          (await client.query('SELECT statement_timestamp() AS at')).rows[0].at as Date
        ).toISOString(),
      };
    let record = (await lockConfiguration(client, tenantId)) as ConfigurationRecord | undefined;
    const initialized = !!record;
    if (!record && operation === 'initialize') {
      record = (
        await client.query(
          'INSERT INTO turnstile.organization_configuration (tenant_id) VALUES ($1) RETURNING *',
          [tenantId],
        )
      ).rows[0] as ConfigurationRecord;
      await client.query(
        `INSERT INTO turnstile.configuration_audit (tenant_id,id,actor_kind,actor_id,request_id,action,subject_id,changed_fields,revision_before,revision_after)
          VALUES ($1,$2,'operator',$3,$4,'initialized',$1,'{}',NULL,0)`,
        [tenantId, randomUUID(), operatorId, randomUUID()],
      );
    }
    if (!record) throw new Error('Setup initialization required');
    const at = (await client.query('SELECT statement_timestamp() AS at')).rows[0].at as Date;
    const base = {
      action: `configuration-${operation}`,
      operatorId,
      at: at.toISOString(),
      tenantId: installed.tenant_id as string,
      applicationId: installed.application_id as string,
    };
    if (operation === 'initialize')
      return {
        ...base,
        alreadyInitialized: initialized,
        revision: record.revision,
        requirementVersion: record.requirement_version,
      };
    if (operation === 'prune') {
      const audit = await client.query(
        `DELETE FROM turnstile.configuration_audit WHERE tenant_id = $1 AND id IN
          (SELECT id FROM turnstile.configuration_audit WHERE tenant_id = $1 AND occurred_at < statement_timestamp() - $2 * interval '1 day' ORDER BY occurred_at,id LIMIT $3)`,
        [
          record.tenant_id,
          CONFIGURATION_LIMITS.auditRetentionDays,
          CONFIGURATION_LIMITS.maintenanceRows,
        ],
      );
      const receipts = await client.query(
        `DELETE FROM turnstile.configuration_create_receipt WHERE tenant_id = $1 AND key IN
          (SELECT key FROM turnstile.configuration_create_receipt WHERE tenant_id = $1 AND expires_at <= statement_timestamp() ORDER BY expires_at,key LIMIT $2)`,
        [record.tenant_id, CONFIGURATION_LIMITS.maintenanceRows - (audit.rowCount ?? 0)],
      );
      return {
        ...base,
        auditDeleted: audit.rowCount ?? 0,
        receiptsDeleted: receipts.rowCount ?? 0,
        revision: record.revision,
      };
    }
    await lockAccess(client, record.tenant_id);
    const managers = await configurationManagerIds(client, record.tenant_id);
    const managerCount = (await accessCounts(client, record.tenant_id)).managers;
    const auditCount = (
      await client.query(
        'SELECT count(*)::int AS total FROM turnstile.configuration_audit WHERE tenant_id = $1',
        [record.tenant_id],
      )
    ).rows[0].total as number;
    const audit = (
      await client.query(
        'SELECT id, actor_kind, actor_id, request_id, action, subject_id, subject_user_id, changed_fields, revision_before, revision_after, occurred_at FROM turnstile.configuration_audit WHERE tenant_id = $1 ORDER BY occurred_at DESC,id DESC LIMIT 100',
        [record.tenant_id],
      )
    ).rows;
    const receipts = (
      await client.query(
        'SELECT count(*)::int AS total, count(*) FILTER (WHERE expires_at > statement_timestamp())::int AS live FROM turnstile.configuration_create_receipt WHERE tenant_id = $1',
        [record.tenant_id],
      )
    ).rows[0];
    return {
      ...base,
      revision: record.revision,
      requirementVersion: record.requirement_version,
      state: record.completed_at ? 'completed' : record.revision ? 'in_progress' : 'not_started',
      completion: record.completed_at
        ? {
            completedAt: record.completed_at.toISOString(),
            completedBy: record.completed_by,
            requirementVersion: record.requirement_version,
          }
        : null,
      managers: { total: managerCount, ids: managers, truncated: managerCount > managers.length },
      receipts,
      audit: { total: auditCount, entries: audit, truncated: auditCount > audit.length },
    };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const operation = process.argv[2];
    if (
      !['verify-installation', 'initialize', 'inspect', 'prune'].includes(operation ?? '') ||
      process.stdin.isTTY
    )
      throw new Error('Private operation/input required');
    process.stdin.setEncoding('utf8');
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > CONFIGURATION_LIMITS.bodyBytes)
        throw new Error('Input too large');
    }
    console.log(
      JSON.stringify(
        await configurationOperator(operation as ConfigurationOperation, JSON.parse(input)),
      ),
    );
  } catch {
    console.error(
      'Configuration operation failed; check private input, owning role, reviewed migrations and existing fixed installation',
    );
    process.exitCode = 1;
  }
}
