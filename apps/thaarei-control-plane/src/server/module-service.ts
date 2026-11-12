import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { type Catalogue, catalogue, catalogueDigest } from '@thaarei/module-catalog';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  type CatalogueCommand,
  catalogueCommand,
  catalogueList,
  catalogueQuery,
  catalogueReceipt,
  catalogueRecord,
} from '../contracts/module-catalogues.ts';
import {
  AccessError,
  identity,
  requireAdmin,
  requireStaff,
  STAFF_LOCK,
  staffContext,
  transaction,
} from './access.ts';
import { assertAuthority } from './machine-signing.ts';
import { verifyModuleEvidence } from './module-evidence.ts';
import { runtime } from './runtime.ts';

const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
function dto(row: Record<string, unknown>) {
  return catalogueRecord.parse({
    id: row.id,
    sourceId: row.source_id,
    digest: row.digest,
    revision: row.revision,
    status: row.status,
    catalogue: row.document,
    publishedAt: row.published_at == null ? null : iso(row.published_at),
  });
}
async function receipt(
  db: Pick<PoolClient, 'query'>,
  command: CatalogueCommand,
  actorId: string,
  digest: string,
) {
  const row = (
    await db.query(
      'SELECT actor_id,digest,result FROM control_plane.module_receipt WHERE request_id=$1',
      [command.requestId],
    )
  ).rows[0];
  if (!row) return null;
  if (row.actor_id !== actorId || row.digest !== digest)
    throw new AccessError(409, 'Request identifier already used with different inputs');
  return catalogueReceipt.parse(row.result);
}
function classified(
  source: unknown,
  id: string,
  changes: { id: string; category: 'core' | 'individual' }[],
): Catalogue {
  const code = catalogue.parse(source);
  if (
    changes.length !== code.modules.length ||
    changes.some((c) => !code.modules.some((m) => m.id === c.id))
  )
    throw new AccessError(400, 'Classification must cover exactly the known modules');
  return catalogue.parse({
    ...code,
    id,
    modules: code.modules.map((m) => ({
      ...m,
      category: changes.find((c) => c.id === m.id)?.category,
    })),
  });
}
export async function executeCatalogue(headers: Headers, raw: unknown) {
  const command = catalogueCommand.parse(raw);
  const actor = await requireStaff(headers);
  requireAdmin(actor);
  const inputDigest = hash(JSON.stringify(command));
  // Recover a committed exact operation before revalidating transient evidence expiry.
  // This returns historical receipt only, not current publication/assignment authority.
  const saved = await receipt(runtime().pool, command, actor.id, inputDigest);
  if (saved) return saved;
  const session = await identity(headers);
  if (!session) throw new AccessError(401, 'Sign in required');
  const proof = 'attestation' in command ? await verifyModuleEvidence(command.attestation) : null;
  // Hash/validate immutable metadata before acquiring SQL/staff locks.
  let prepared: Catalogue;
  let expectedSourceDigest: string;
  if (command.type === 'code.import') {
    if (proof?.evidence.kind !== 'code') throw new AccessError(400, 'Code evidence required');
    prepared = proof.evidence.catalogue;
    expectedSourceDigest = await catalogueDigest(prepared);
  } else {
    let sourceId: string;
    if (command.type === 'draft.create') sourceId = command.sourceId;
    else {
      const row = (
        await runtime().pool.query(
          'SELECT source_id FROM control_plane.module_catalogue WHERE id=$1',
          [command.id],
        )
      ).rows[0];
      if (!row) throw new AccessError(404, 'Catalogue not found');
      sourceId = row.source_id;
    }
    const source = (
      await runtime().pool.query(
        'SELECT document,digest FROM control_plane.module_code WHERE id=$1',
        [sourceId],
      )
    ).rows[0];
    if (!source) throw new AccessError(404, 'Code catalogue not found');
    expectedSourceDigest = source.digest;
    if (command.type === 'catalogue.publish') {
      const row = (
        await runtime().pool.query(
          'SELECT document FROM control_plane.module_catalogue WHERE id=$1',
          [command.id],
        )
      ).rows[0];
      prepared = catalogue.parse(row.document);
    } else prepared = classified(source.document, command.id, command.categories);
  }
  const preparedDigest = await catalogueDigest(prepared);
  if (
    command.type === 'catalogue.publish' &&
    (proof?.evidence.kind !== 'classification' ||
      proof.evidence.catalogueId !== command.id ||
      proof.evidence.catalogueDigest !== preparedDigest ||
      proof.evidence.codeCatalogueDigest !== expectedSourceDigest ||
      proof.evidence.draftRevision !== command.revision)
  )
    throw new AccessError(400, 'Release evidence does not match this draft');
  try {
    return await transaction(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock($1)', [STAFF_LOCK]);
      const current = await staffContext(session.session.id, db);
      requireAdmin(current);
      const prior = await receipt(db, command, current.id, inputDigest);
      if (prior) return prior;
      let before: unknown = null;
      let resourceId: string;
      let nextRevision = 1;
      if (command.type === 'code.import') {
        resourceId = prepared.id;
        await db.query(
          'INSERT INTO control_plane.module_code(id,digest,document,proof_digest,key_id,actor_id) VALUES($1,$2,$3,$4,$5,$6)',
          [
            resourceId,
            preparedDigest,
            JSON.stringify(prepared),
            hash(command.attestation),
            proof?.keyId,
            current.id,
          ],
        );
      } else if (command.type === 'draft.create') {
        resourceId = command.id;
        await db.query(
          'INSERT INTO control_plane.module_catalogue(id,source_id,digest,document) VALUES($1,$2,$3,$4)',
          [resourceId, command.sourceId, preparedDigest, JSON.stringify(prepared)],
        );
      } else {
        resourceId = command.id;
        const row = (
          await db.query('SELECT * FROM control_plane.module_catalogue WHERE id=$1 FOR UPDATE', [
            resourceId,
          ])
        ).rows[0];
        if (!row) throw new AccessError(404, 'Catalogue not found');
        if (row.status !== 'draft' || row.revision !== command.revision)
          throw new AccessError(409, 'Catalogue changed or is already released; reload');
        before = {
          digest: row.digest,
          revision: row.revision,
          status: row.status,
          categories: catalogue
            .parse(row.document)
            .modules.map(({ id, category }) => ({ id, category })),
        };
        nextRevision = command.revision + 1;
        if (command.type === 'catalogue.publish') {
          await assertAuthority(db);
          if (row.digest !== preparedDigest)
            throw new AccessError(409, 'Draft changed during verification');
          await db.query(
            "UPDATE control_plane.module_catalogue SET revision=revision+1,status='released',proof_digest=$2,key_id=$3,published_at=clock_timestamp() WHERE id=$1",
            [resourceId, hash(command.attestation), proof?.keyId],
          );
        } else
          await db.query(
            'UPDATE control_plane.module_catalogue SET revision=revision+1,digest=$2,document=$3 WHERE id=$1',
            [resourceId, preparedDigest, JSON.stringify(prepared)],
          );
      }
      const committedAt = iso((await db.query('SELECT clock_timestamp() AS time')).rows[0].time);
      const result = catalogueReceipt.parse({
        requestId: command.requestId,
        resourceId,
        revision: nextRevision,
        committedAt,
      });
      const after = {
        digest: preparedDigest,
        revision: nextRevision,
        categories: prepared.modules.map(({ id, category }) => ({ id, category })),
        status:
          command.type === 'catalogue.publish'
            ? 'released'
            : command.type === 'code.import'
              ? 'code'
              : 'draft',
      };
      await db.query(
        'INSERT INTO control_plane.module_audit(id,resource_id,actor_id,action,reason,"before","after",committed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          randomUUID(),
          resourceId,
          current.id,
          command.type,
          command.reason,
          before === null ? null : JSON.stringify(before),
          JSON.stringify(after),
          committedAt,
        ],
      );
      await db.query(
        'INSERT INTO control_plane.module_receipt(request_id,actor_id,digest,result,committed_at) VALUES($1,$2,$3,$4,$5)',
        [command.requestId, current.id, inputDigest, JSON.stringify(result), committedAt],
      );
      return result;
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
      throw new AccessError(409, 'Catalogue identity or digest already exists');
    throw error;
  }
}
export async function listCatalogues(headers: Headers, raw: unknown) {
  await requireStaff(headers);
  const input = catalogueQuery.parse(raw);
  const codes = (
    await runtime().pool.query(
      'SELECT id,digest,document FROM control_plane.module_code WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT 51',
      [input.codeAfter ?? null],
    )
  ).rows;
  const drafts = (
    await runtime().pool.query(
      'SELECT id,digest,revision,status,document FROM control_plane.module_catalogue WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT 51',
      [input.after ?? null],
    )
  ).rows;
  const summary = (r: Record<string, unknown>, code = false) => {
    const c = catalogue.parse(r.document);
    return {
      id: r.id,
      digest: r.digest,
      revision: code ? 1 : r.revision,
      status: code ? 'code' : r.status,
      sourceDigest: c.sourceDigest,
      platform: c.platform,
      moduleCount: c.modules.length,
    };
  };
  return catalogueList.parse({
    codes: codes.slice(0, 50).map((r) => summary(r, true)),
    catalogues: drafts.slice(0, 50).map((r) => summary(r)),
    nextCodeCursor: codes.length > 50 ? codes[49].id : null,
    nextCursor: drafts.length > 50 ? drafts[49].id : null,
  });
}
export async function readCode(headers: Headers, rawId: string) {
  await requireStaff(headers);
  const id = z.uuid().parse(rawId);
  const row = (
    await runtime().pool.query('SELECT document FROM control_plane.module_code WHERE id=$1', [id])
  ).rows[0];
  if (!row) throw new AccessError(404, 'Code catalogue not found');
  return catalogue.parse(row.document);
}
export async function readCatalogue(headers: Headers, rawId: string) {
  await requireStaff(headers);
  const id = z.uuid().parse(rawId);
  const row = (
    await runtime().pool.query('SELECT * FROM control_plane.module_catalogue WHERE id=$1', [id])
  ).rows[0];
  if (!row) throw new AccessError(404, 'Catalogue not found');
  return dto(row);
}
export async function exportBuildPlan(headers: Headers, rawId: string) {
  const record = await readCatalogue(headers, rawId);
  const source = await readCode(headers, record.sourceId);
  return {
    version: 1,
    kind: 'module-build-plan',
    sourceId: record.sourceId,
    codeCatalogueDigest: await catalogueDigest(source),
    catalogueDigest: record.digest,
    draftRevision: record.revision,
    catalogue: record.catalogue,
  };
}
