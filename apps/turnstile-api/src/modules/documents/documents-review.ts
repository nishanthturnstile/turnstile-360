import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DmsClientError } from '@thaarei/dms-client';
import { documentsWorkspaceCommandSchema } from '@thaarei/turnstile-contracts/documents';
import {
  peopleDigestSchema,
  peopleIdSchema,
  peopleSubjectSchema,
} from '@thaarei/turnstile-contracts/runtime';
import { z } from 'zod';
import { withProductOperator } from '../../infrastructure/database/product-operator.js';
import { DmsConfigurationService } from '../../integrations/dms/dms-configuration/dms-configuration.service.js';
import { readAccess } from '../access/access-evaluator.js';
import { canonicalAccessReady } from '../access/access-safety.js';
import { commandDigest, lockAccess } from '../access/access-transactions.js';
import { verifyOperatorSubject } from '../access/operator-identity.js';
import { operatorSession } from '../access/operator-session.js';
import { markerDigest } from '../deployment/access.js';
import { createDocumentsClient } from './documents.service.js';
import { maintainDocumentsIntents } from './documents-intents.service.js';

const proof = {
  operatorUserId: peopleSubjectSchema,
  operatorCookie: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[^\r\n]+$/),
};
const reviewTarget = {
  ...proof,
  intentId: peopleIdSchema,
  digest: peopleDigestSchema,
  reason: z.string().trim().min(1).max(300),
};
const uploadTarget = {
  uploadId: peopleIdSchema,
  documentId: peopleIdSchema,
  versionId: peopleIdSchema,
};
const inputSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...proof, action: z.literal('prune') }),
  z.strictObject({
    ...proof,
    action: z.literal('dispose'),
    intentId: peopleIdSchema,
    digest: peopleDigestSchema,
    reason: z.string().trim().min(1).max(300),
    verifiedOutcome: z.enum(['no_effect', 'effect_already_accounted_for']),
  }),
  z.strictObject({ ...reviewTarget, ...uploadTarget, action: z.literal('attach') }),
  z.strictObject({ ...reviewTarget, batchId: peopleIdSchema, action: z.literal('attach-batch') }),
  z.strictObject({
    ...reviewTarget,
    ...uploadTarget,
    action: z.literal('attach-batch-item'),
    batchId: peopleIdSchema,
    itemId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  }),
]);

async function readBinding(command: z.infer<typeof inputSchema>) {
  if (command.action === 'prune' || command.action === 'dispose') return undefined;
  const config = new DmsConfigurationService().config;
  const client = createDocumentsClient(config);
  if (!config || !client) throw new Error('Fixed DMS client required');
  const actor = {
    userId: command.operatorUserId,
    requestId: randomUUID(),
    deadlineAt: Date.now() + 8000,
  };
  const capabilities = await client.documentsCapabilities(actor);
  if (
    capabilities.tenantId !== config.INSTALLATION_TENANT_ID ||
    capabilities.applicationId !== config.TURNSTILE_APPLICATION_ID
  )
    throw new Error('DMS binding mismatch');
  if (command.action === 'attach-batch') {
    const batch = await client.batch(command.batchId, {}, actor);
    if (batch.id !== command.batchId) throw new Error('Batch binding mismatch');
    return { kind: 'batch', id: batch.id, total: batch.total } as const;
  }
  const status = await client.uploadStatus(command.uploadId, actor);
  if (
    status.id !== command.uploadId ||
    status.documentId !== command.documentId ||
    status.versionId !== command.versionId
  )
    throw new Error('Upload binding mismatch');
  if (command.action === 'attach-batch-item') {
    let query: { limit: string; cursor?: string } = { limit: '50' };
    let matched = false;
    for (let page = 0; page < 2; page++) {
      const batch = await client.batch(command.batchId, query, actor);
      if (batch.id !== command.batchId) throw new Error('Batch binding mismatch');
      if (
        batch.items.some((item) => item.itemId === command.itemId && item.session?.id === status.id)
      ) {
        matched = true;
        break;
      }
      if (!batch.nextCursor) break;
      query = { ...query, cursor: batch.nextCursor };
    }
    if (!matched) throw new Error('Batch item binding mismatch');
  }
  return { kind: 'upload', status } as const;
}

let phase = 'input';
async function review(input: unknown) {
  const command = inputSchema.parse(input);
  phase = 'current_identity';
  const verified = await verifyOperatorSubject(
    command.operatorUserId,
    await operatorSession(command.operatorUserId, command.operatorCookie, process.env),
    process.env,
  );
  // The protected operator must independently verify that this DMS binding
  // corresponds to the original key and digest. Check live IDs with the same
  // fixed Turnstile machine registration before an owning transaction.
  phase = 'dms_binding';
  const binding = await readBinding(command);
  phase = 'owning_review';
  return withProductOperator(process.env, async (db, installed) => {
    const tenant = installed.tenant_id;
    if (!(await canonicalAccessReady(db, tenant, process.env)))
      throw new Error('Current product access release required');
    await lockAccess(db, tenant);
    if (
      verified.expiresAt <= Date.now() ||
      Date.now() - verified.checkedAt >= 10000 ||
      !(await readAccess(db, tenant, command.operatorUserId)).protectedAdministrator
    )
      throw new Error('Current protected administrator required');
    phase = 'retention';
    await maintainDocumentsIntents(db, tenant, await markerDigest());
    if (command.action === 'prune') return { maintained: true };
    phase = 'disposition';
    if (command.action === 'attach-batch' && binding?.kind === 'batch') {
      const row = (
        await db.query(
          `SELECT command FROM turnstile.documents_intent
         WHERE tenant_id=$1 AND id=$2 AND digest=$3 AND kind='batch.create'
           AND state='UNRESOLVED_REQUIRES_REVIEW'`,
          [tenant, command.intentId, command.digest],
        )
      ).rows[0];
      const saved = documentsWorkspaceCommandSchema.safeParse(row?.command);
      if (
        !row ||
        (row.command !== null &&
          (!saved.success ||
            saved.data.kind !== 'batch.create' ||
            saved.data.payload.items.length !== binding.total))
      )
        throw new Error('Saved batch does not match reviewed binding');
      await db.query(
        `UPDATE turnstile.documents_intent SET state='RESOLVED', batch_id=$3, resolved_at=statement_timestamp(),
           disposition=$4 WHERE tenant_id=$1 AND id=$2`,
        [
          tenant,
          command.intentId,
          binding.id,
          {
            action: command.action,
            operatorUserId: command.operatorUserId,
            reason: command.reason,
          },
        ],
      );
      return { attached: true, id: command.intentId };
    }
    if (
      (command.action === 'attach' || command.action === 'attach-batch-item') &&
      binding?.kind === 'upload'
    ) {
      const { status } = binding;
      const row = (
        await db.query(
          `SELECT command,kind,batch_id,subject_key FROM turnstile.documents_intent
         WHERE tenant_id=$1 AND id=$2 AND digest=$3
           AND kind IN ('upload.begin','version.begin','version.restore','batch.item')
           AND state='UNRESOLVED_REQUIRES_REVIEW'`,
          [tenant, command.intentId, command.digest],
        )
      ).rows[0];
      const descriptor = documentsWorkspaceCommandSchema.safeParse(row?.command);
      if (
        !row ||
        (command.action === 'attach-batch-item'
          ? row.kind !== 'batch.item' ||
            row.batch_id !== command.batchId ||
            row.subject_key !== commandDigest([command.batchId, command.itemId])
          : row.kind === 'batch.item') ||
        (row.command !== null &&
          (!descriptor.success ||
            ('documentId' in descriptor.data && descriptor.data.documentId !== status.documentId) ||
            ((descriptor.data.kind === 'upload.begin' ||
              descriptor.data.kind === 'version.begin') &&
              (descriptor.data.payload.size !== status.size ||
                descriptor.data.payload.contentType !== status.contentType))))
      )
        throw new Error('Saved upload does not match reviewed binding');
      const matched = await db.query(
        `SELECT 1 FROM turnstile.documents_intent WHERE tenant_id=$1 AND upload_id=$2
           AND kind IN ('upload.begin','version.begin','version.restore','batch.item') AND state='RESOLVED'`,
        [tenant, status.id],
      );
      if (matched.rowCount) throw new Error('Upload binding already recorded');
      await db.query(
        `UPDATE turnstile.documents_intent SET state='RESOLVED', upload_id=$3, resolved_at=statement_timestamp(),
           disposition=$4 WHERE tenant_id=$1 AND id=$2`,
        [
          tenant,
          command.intentId,
          status.id,
          {
            action: command.action,
            operatorUserId: command.operatorUserId,
            reason: command.reason,
            documentId: status.documentId,
            versionId: status.versionId,
          },
        ],
      );
      return { attached: true, id: command.intentId };
    }
    if (command.action !== 'dispose') throw new Error('Disposition required');
    const disposition = {
      operatorUserId: command.operatorUserId,
      reason: command.reason,
      verifiedOutcome: command.verifiedOutcome,
    };
    const updated = await db.query(
      `UPDATE turnstile.documents_intent SET state='DISPOSED', resolved_at=statement_timestamp(), disposition=$4
       WHERE tenant_id=$1 AND id=$2 AND digest=$3 AND state='UNRESOLVED_REQUIRES_REVIEW'`,
      [tenant, command.intentId, command.digest, disposition],
    );
    if (!updated.rowCount) {
      const prior = await db.query(
        `SELECT 1 FROM turnstile.documents_intent
         WHERE tenant_id=$1 AND id=$2 AND digest=$3 AND state='DISPOSED' AND disposition=$4`,
        [tenant, command.intentId, command.digest, disposition],
      );
      if (!prior.rowCount) throw new Error('Intent disposition conflict');
    }
    return { disposed: true, id: command.intentId };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    if (process.stdin.isTTY || process.argv.length !== 2)
      throw new Error('Protected stdin required');
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 16384) throw new Error('Input too large');
      chunks.push(chunk);
    }
    console.log(JSON.stringify(await review(JSON.parse(Buffer.concat(chunks).toString('utf8')))));
  } catch (error) {
    const code =
      error instanceof DmsClientError
        ? (error.domainCode ?? error.code)
        : error &&
            typeof error === 'object' &&
            'code' in error &&
            typeof error.code === 'string' &&
            /^[A-Z0-9]{5}$/.test(error.code)
          ? error.code
          : undefined;
    console.error(
      JSON.stringify({ code: 'DOCUMENTS_REVIEW_FAILED', phase, ...(code ? { detail: code } : {}) }),
    );
    process.exitCode = 1;
  }
}
