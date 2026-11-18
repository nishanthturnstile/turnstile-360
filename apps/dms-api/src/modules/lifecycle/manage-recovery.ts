import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recoveryCommandSchema } from '@thaarei/dms-contracts/private';
import { withFreshOperatorIdentity, withOperatorRead } from '../access/operator-context.js';
import { insertSecurityEvent } from '../audit/security-event.js';
export async function manageRecovery(raw: unknown, environment = process.env) {
  const input = recoveryCommandSchema.parse(raw);
  return withFreshOperatorIdentity(environment, input, async (identity) => {
    if (
      ['backup-authorize', 'backup-register', 'recovery-open'].includes(input.action) &&
      !identity.admin
    )
      throw new Error('Verified authority administrator and DMS operator required');
    return withOperatorRead(
      environment,
      identity.config.INSTALLATION_TENANT_ID,
      identity.config.INSTALLATION_CUSTOMER_KEY,
      identity.subjectId,
      async (tx) => {
        let result: unknown;
        let subject = tx.context.tenantId;
        if (input.action === 'backup-authorize') {
          if (!(await tx.client.query('SELECT dms.recovery_open() AS open')).rows[0]?.open)
            throw new Error('Source recovery is closed');
          subject = randomUUID();
          result = {
            id: subject,
            tenantId: tx.context.tenantId,
            customerKey: identity.config.INSTALLATION_CUSTOMER_KEY,
            subjectId: identity.subjectId,
          };
        } else if (input.action === 'backup-register') {
          const m = input.manifest;
          if (
            m.tenantId !== tx.context.tenantId ||
            m.customerKey !== identity.config.INSTALLATION_CUSTOMER_KEY
          )
            throw new Error('Recovery installation mismatch');
          await tx.client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended('dms-lifecycle:'||$1,0))",
            [tx.context.tenantId],
          );
          const previous = (
            await tx.client.query('SELECT * FROM dms.backup_catalog WHERE id=$1', [m.id])
          ).rows[0];
          if (
            previous &&
            ((previous.manifest_sha256 !== null &&
              previous.manifest_sha256 !== input.manifestSha256) ||
              previous.recovery_point.toISOString() !== m.recoveryPoint ||
              previous.repository_id !== m.repositoryId ||
              previous.expires_at.toISOString() !== m.expiresAt)
          )
            throw new Error('Backup catalog identity cannot change');
          if (
            !previous &&
            (
              await tx.client.query(
                "SELECT 1 FROM dms.document WHERE lifecycle IN ('PURGING','PURGED') AND restore_deadline>=$1 LIMIT 1",
                [m.recoveryPoint],
              )
            ).rowCount
          )
            throw new Error('A new historical recovery horizon cannot cross a disposal decision');
          await tx.client.query(
            'INSERT INTO dms.backup_catalog(id,tenant_id,recovery_point,expires_at,manifest_sha256,repository_id,confirmed_off_host,bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET manifest_sha256=EXCLUDED.manifest_sha256,confirmed_off_host=EXCLUDED.confirmed_off_host,bytes=EXCLUDED.bytes,verified_at=clock_timestamp() WHERE dms.backup_catalog.manifest_sha256 IS NULL',
            [
              m.id,
              m.tenantId,
              m.recoveryPoint,
              m.expiresAt,
              input.manifestSha256,
              m.repositoryId,
              m.confirmedOffHost,
              input.bytes,
            ],
          );
          if (m.confirmedOffHost)
            await tx.client.query('SELECT dms.report_backup($1,$2)', [
              m.recoveryPoint,
              input.manifestSha256,
            ]);
          subject = m.id;
          result = { registered: true, id: m.id, confirmedOffHost: m.confirmedOffHost };
        } else if (input.action === 'recovery-open') {
          if (
            !(
              await tx.client.query('SELECT dms.open_recovery($1,$2) AS opened', [
                input.backupId,
                input.manifestSha256,
              ])
            ).rows[0]?.opened
          )
            throw new Error('Recovery integrity/access verification is incomplete');
          subject = input.backupId;
          result = { opened: true };
        } else if (input.action === 'backup-inspect') {
          result = (
            await tx.client.query(
              'SELECT id,recovery_point,expires_at,manifest_sha256,repository_id,confirmed_off_host,bytes,verified_at FROM dms.backup_catalog ORDER BY recovery_point DESC,id DESC LIMIT 100',
            )
          ).rows;
        } else if (input.action === 'disposal-inspect') {
          result = (
            await tx.client.query(
              'SELECT id,application_id,area,object_id,state,requested_at,next_attempt_at,completed_at FROM dms.disposal_intent ORDER BY requested_at DESC,id DESC LIMIT 100',
            )
          ).rows;
        } else {
          const planned = (
            await tx.client.query('SELECT dms.request_disposal($1) AS planned', [
              input.action === 'disposal-request' ? input.documentId : null,
            ])
          ).rows[0].planned;
          if (input.action === 'disposal-request') subject = input.documentId;
          result = { planned };
        }
        const action =
          input.action === 'backup-authorize'
            ? 'backup.authorize'
            : input.action === 'backup-register'
              ? 'backup.register'
              : input.action === 'recovery-open'
                ? 'recovery.open'
                : input.action === 'backup-inspect'
                  ? 'backup.inspect'
                  : input.action === 'disposal-inspect'
                    ? 'disposal.inspect'
                    : 'disposal.request';
        await insertSecurityEvent(tx.client, tx.context.tenantId, {
          action,
          actorKind: 'operator',
          actorId: identity.subjectId,
          subjectId: subject,
          outcome: 'success',
        });
        return result;
      },
      'recovery',
    );
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let value = '';
    for await (const block of process.stdin) {
      value += block;
      if (Buffer.byteLength(value) > 32768) throw new Error();
    }
    console.log(JSON.stringify(await manageRecovery(JSON.parse(value))));
  } catch {
    console.error(
      'Private recovery/disposal command rejected; verify current proof, recovery evidence and retention policy',
    );
    process.exitCode = 1;
  }
}
