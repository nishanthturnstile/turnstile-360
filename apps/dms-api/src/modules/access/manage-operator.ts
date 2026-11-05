import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dmsOperatorCommandSchema } from '@thaarei/dms-contracts/private';
import { assertInstallation } from '../../infrastructure/database/migrate.js';
import { createPool, withTenant } from '../../infrastructure/database/postgres.js';
import { readAuditPage } from '../audit/audit.service.js';
import { insertSecurityEvent } from '../audit/security-event.js';
import { withFreshOperatorIdentity, withOperatorRead } from './operator-context.js';

// Private process entry only: freshly authenticate on every invocation. Possession
// of an authority cookie or consumer token cannot invoke this maintenance interface.
export async function runOperatorCommand(input: unknown, environment = process.env) {
  const operation = dmsOperatorCommandSchema.parse(input);
  return withFreshOperatorIdentity(
    environment,
    operation,
    async ({ subjectId: actor, admin, authPool, config }) => {
      if (operation.action === 'audit-read') {
        return withOperatorRead(
          environment,
          config.INSTALLATION_TENANT_ID,
          config.INSTALLATION_CUSTOMER_KEY,
          actor,
          async (tx) => {
            const result = await readAuditPage(tx, config.AUTH_SECRET, operation);
            await insertSecurityEvent(tx.client, tx.context.tenantId, {
              action: 'operator.audit.read',
              actorKind: 'operator',
              actorId: actor,
              subjectId: operation.applicationId ?? tx.context.tenantId,
              outcome: 'success',
            });
            return result;
          },
        );
      }
      if (!environment.DMS_MIGRATION_DATABASE_URL)
        throw new Error('Maintenance authority required');
      await assertInstallation(environment);
      const special = ['bootstrap', 'recover'].includes(operation.action);
      if (special && (!admin || ('subjectId' in operation && operation.subjectId)))
        throw new Error('Bootstrap/recovery requires verified administrator self proof');
      const subject = special ? actor : 'subjectId' in operation ? operation.subjectId : undefined;
      if (!subject) throw new Error('Explicit subject required');
      const pool = createPool(environment.DMS_MIGRATION_DATABASE_URL, 1);
      try {
        return await withTenant(pool, config.INSTALLATION_TENANT_ID, async (client) => {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            `dms-operator:${config.INSTALLATION_TENANT_ID}`,
          ]);
          // Serialize bootstrap, grants and last-operator revocation on installation.
          await client.query('SELECT singleton FROM dms.installation WHERE singleton=1 FOR UPDATE');
          const {
            rows: [registry],
          } = await client.query<{
            total: string;
            active: string;
            actor_active: boolean;
            subject_active: boolean;
          }>(
            `SELECT count(*) AS total, count(*) FILTER (WHERE revoked_at IS NULL) AS active,
            coalesce(bool_or(subject_id=$1 AND revoked_at IS NULL),false) AS actor_active,
            coalesce(bool_or(subject_id=$2 AND revoked_at IS NULL),false) AS subject_active
            FROM dms.operator_authorization`,
            [actor, subject],
          );
          if (!registry) throw new Error('Operator registry unavailable');
          if (
            operation.action === 'bootstrap' &&
            Number(registry.total) > 0 &&
            !registry.actor_active
          )
            throw new Error('First operator already bootstrapped; use explicit recovery');
          if (!special && !registry.actor_active)
            throw new Error('Active DMS operator authorization required');
          if (operation.action === 'revoke') {
            if (!registry.subject_active || Number(registry.active) < 2)
              throw new Error('Cannot revoke unavailable or last operator');
            await client.query(
              'UPDATE dms.operator_authorization SET revoked_at=now() WHERE subject_id=$1',
              [subject],
            );
          } else {
            const target = await authPool.query(
              'SELECT id FROM auth."user" WHERE id=$1 AND email_verified AND NOT coalesce(banned,false)',
              [subject],
            );
            if (!target.rowCount) throw new Error('Verified active authority subject required');
            await client.query(
              'INSERT INTO dms.operator_authorization (tenant_id,subject_id) VALUES ($1,$2) ON CONFLICT (tenant_id,subject_id) DO UPDATE SET revoked_at=NULL',
              [config.INSTALLATION_TENANT_ID, subject],
            );
          }
          await insertSecurityEvent(client, config.INSTALLATION_TENANT_ID, {
            action: `operator.${operation.action}`,
            actorKind: 'operator',
            actorId: actor,
            subjectId: subject,
            outcome: 'success',
          });
          return {
            action: operation.action,
            tenantId: config.INSTALLATION_TENANT_ID,
            subjectId: subject,
            operatorId: actor,
          };
        });
      } finally {
        await pool.end();
      }
    },
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    if (process.stdin.isTTY) throw new Error('Supply protected JSON stdin');
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > 8192) throw new Error('Input too large');
    }
    console.log(JSON.stringify(await runOperatorCommand(JSON.parse(input))));
  } catch {
    console.error(
      'Private DMS operator operation rejected; check maintenance authority and fresh verified identity',
    );
    process.exitCode = 1;
  }
}
