import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { binding, sameBinding } from '@thaarei/control-plane-contracts';
import {
  catalogue,
  createProfile,
  ModuleCatalogueError,
  type Profile,
  profileDigest,
  reviewedRestriction,
  sameActiveBasis,
  validateDeliveryRequest,
} from '@thaarei/module-catalog';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  type AssignmentEntry,
  type AssignmentMutation,
  assignmentCatalogueList,
  assignmentCatalogueQuery,
  assignmentDocument,
  assignmentEntry,
  assignmentMutation,
  assignmentView,
  deriveAssignmentStatuses,
} from '../contracts/module-assignments.ts';
import { catalogueReceipt } from '../contracts/module-catalogues.ts';
import {
  AccessError,
  identity,
  requireStaff,
  STAFF_LOCK,
  type StaffContext,
  staffContext,
  transaction,
} from './access.ts';
import { assertAuthority } from './machine-signing.ts';
import { moduleAuthorityDocument } from './module-decision-policy.ts';
import { findDelivery } from './module-delivery-service.ts';
import { moduleHandover } from './module-handover-service.ts';
import { runtime } from './runtime.ts';

type Db = Pick<PoolClient, 'query'>;
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
const productSelect = `SELECT p.*,i.local_installation_id,i.tenant_id,c.archived,
  EXISTS(SELECT 1 FROM control_plane.machine m WHERE m.product_id=p.id) AND NOT EXISTS(SELECT 1 FROM control_plane.module_authority a WHERE a.product_id=p.id) AS legacy
  FROM control_plane.registry_product p
  JOIN control_plane.registry_installation i ON i.id=p.installation_id AND i.client_id=p.client_id
  JOIN control_plane.registry_client c ON c.id=p.client_id`;
function writer(actor: StaffContext) {
  if (actor.role !== 'admin' && actor.role !== 'operator')
    throw new AccessError(403, 'Module assignments require Admin or Operator');
  if (!actor.recent) throw new AccessError(403, 'Verify MFA again to continue');
}
async function product(db: Db, id: string, lock = false) {
  const row = (
    await db.query(`${productSelect} WHERE p.id=$1${lock ? ' FOR UPDATE OF p' : ''}`, [id])
  ).rows[0];
  if (!row) throw new AccessError(404, 'Product not found');
  if (row.product !== 'turnstile')
    throw new AccessError(409, 'Modules belong to a Turnstile product');
  return {
    row,
    binding: binding.parse({
      clientId: row.client_id,
      installationId: row.installation_id,
      productId: row.id,
      localInstallationId: row.local_installation_id,
      tenantId: row.tenant_id,
      product: row.product,
      applicationId: row.application_id,
    }),
  };
}
function entry(row: Record<string, unknown> | undefined): AssignmentEntry | null {
  if (!row) return null;
  return assignmentEntry.parse({
    id: row.id,
    kind: row.kind,
    revision: row.revision,
    document: row.document,
    actorId: row.actor_id,
    createdAt: iso(row.created_at),
  });
}
async function state(db: Db, id: string) {
  const rows = (
    await db.query(
      `SELECT e.* FROM control_plane.module_assignment_state s
    JOIN control_plane.module_assignment_entry e ON e.product_id=s.product_id AND (e.id=s.draft_id OR e.id=s.desired_id)
    WHERE s.product_id=$1`,
      [id],
    )
  ).rows;
  return {
    draft: entry(rows.find((r) => r.kind === 'draft')),
    desired: entry(rows.find((r) => r.kind === 'approved')),
  };
}
async function receipt(db: Db, input: AssignmentMutation, actorId: string, digest: string) {
  const row = (
    await db.query(
      'SELECT actor_id,digest,result FROM control_plane.module_receipt WHERE request_id=$1',
      [input.command.operationId],
    )
  ).rows[0];
  if (!row) return null;
  if (row.actor_id !== actorId || row.digest !== digest)
    throw new AccessError(409, 'Request identifier already used with different inputs');
  return catalogueReceipt.parse(row.result);
}
function reviewed(document: z.infer<typeof assignmentDocument>) {
  // Operation, expected revision and audit reason differ between save and approval.
  // Every reviewed selection/profile/basis fact must remain identical.
  const c = document.command;
  return JSON.stringify({
    profileDigest: document.profileDigest,
    requested: [...c.requestedIndividualIds].sort(),
    resolved: [...c.confirmedResolvedIds].sort(),
    removed: [...c.explicitlyRemovedIds].sort(),
    closure: [...c.confirmedRemovalClosureIds].sort(),
    active: c.activeBasis && { ...c.activeBasis, policyRevision: undefined },
  });
}
export async function executeAssignment(headers: Headers, rawProductId: string, raw: unknown) {
  const id = z.uuid().parse(rawProductId);
  const input = assignmentMutation.parse(raw);
  const command = input.command;
  if (command.binding.productId !== id) throw new AccessError(409, 'Product binding mismatch');
  const actor = await requireStaff(headers);
  writer(actor);
  const digest = hash(JSON.stringify({ productId: id, ...input }));
  // An old success is historical outcome only; recover it before current-state checks.
  const prior = await receipt(runtime().pool, input, actor.id, digest);
  if (prior) return prior;
  const session = await identity(headers);
  if (!session) throw new AccessError(401, 'Sign in required');
  const source = (
    await runtime().pool.query(
      "SELECT id,document FROM control_plane.module_catalogue WHERE digest=$1 AND status='released'",
      [command.catalogueDigest],
    )
  ).rows[0];
  if (!source) throw new AccessError(409, 'Choose a published catalogue');
  let selectedProfile: Profile;
  try {
    selectedProfile = await createProfile(
      source.document,
      { requestedIndividualIds: command.requestedIndividualIds },
      command.confirmedResolvedIds,
    );
  } catch (error) {
    if (error instanceof ModuleCatalogueError) throw new AccessError(400, error.code);
    throw error;
  }
  const prepared = assignmentDocument.parse({
    command,
    profile: selectedProfile,
    profileDigest: await profileDigest(selectedProfile),
  });
  return transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock($1)', [STAFF_LOCK]);
    const current = await staffContext(session.session.id, db);
    writer(current);
    const saved = await receipt(db, input, current.id, digest);
    if (saved) return saved;
    const p = await product(db, id, true);
    const authorityRow = (
      await db.query(
        'SELECT document,minimum_version FROM control_plane.module_authority WHERE product_id=$1',
        [id],
      )
    ).rows[0];
    const authority = authorityRow?.document
      ? moduleAuthorityDocument.parse(authorityRow.document)
      : null;
    const activeBasis = authority
      ? { ...authority.policy.active, policyRevision: p.row.revision }
      : null;
    if (
      (activeBasis === null) !== (command.activeBasis === null) ||
      (activeBasis && !sameActiveBasis(activeBasis, command.activeBasis))
    )
      throw new AccessError(409, 'Active basis changed; reload and review');
    let allowed: string[] = [];
    if (authority) {
      try {
        allowed = reviewedRestriction({
          catalogue: authority.request.catalogue,
          allowedIds: authority.policy.allowedModuleIds,
          targetIds: prepared.profile.modules.map((m) => m.id),
          explicitlyRemovedIds: command.explicitlyRemovedIds,
          confirmedRemovalClosureIds: command.confirmedRemovalClosureIds,
        });
      } catch (error) {
        if (error instanceof ModuleCatalogueError) throw new AccessError(409, error.code);
        throw error;
      }
    } else if (command.explicitlyRemovedIds.length || command.confirmedRemovalClosureIds.length)
      throw new AccessError(409, 'Active authority required for removals');

    if (!sameBinding(p.binding, command.binding))
      throw new AccessError(409, 'Product binding mismatch');
    if (p.row.revision !== command.expectedRevision || command.expectedRevision >= 2147483647)
      throw new AccessError(409, 'Product or assignment changed; reload and review');
    if (p.row.archived)
      throw new AccessError(409, 'Unarchive the client before changing assignments');
    const before = await state(db, id);
    const kind = input.type === 'assignment.approve' ? 'approved' : 'draft';
    if (kind === 'approved') {
      await assertAuthority(db);
      if (
        !before.draft ||
        before.draft.revision !== p.row.revision ||
        reviewed(before.draft.document) !== reviewed(prepared)
      )
        throw new AccessError(409, 'Save and review the current selection before approval');
    }
    const revision = command.expectedRevision + 1;
    const createdAt = iso((await db.query('SELECT clock_timestamp() AS time')).rows[0].time);
    await db.query(
      'INSERT INTO control_plane.module_assignment_entry(id,product_id,catalogue_id,kind,revision,document,actor_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        command.operationId,
        id,
        source.id,
        kind,
        revision,
        JSON.stringify(prepared),
        current.id,
        createdAt,
      ],
    );
    if (kind === 'draft')
      await db.query(
        `INSERT INTO control_plane.module_assignment_state(product_id,draft_id) VALUES($1,$2)
      ON CONFLICT(product_id) DO UPDATE SET draft_id=EXCLUDED.draft_id`,
        [id, command.operationId],
      );
    else
      await db.query(
        'UPDATE control_plane.module_assignment_state SET desired_id=$2,draft_id=NULL WHERE product_id=$1',
        [id, command.operationId],
      );
    if (kind === 'approved' && authority) {
      const next = moduleAuthorityDocument.parse({
        ...authority,
        policy: {
          ...authority.policy,
          active: { ...authority.policy.active, policyRevision: revision },
          desired: {
            catalogueDigest: prepared.profile.catalogueDigest,
            profileDigest: prepared.profileDigest,
            assignmentRevision: revision,
          },
          changeAssignmentRevision: revision,
          allowedModuleIds: allowed,
        },
      });
      await db.query('SELECT control_plane.commit_module_authority($1,$2,$3,$4,$5)', [
        session.session.id,
        id,
        p.row.revision,
        'restrict',
        JSON.stringify(next),
      ]);
    }
    // One registry revision fences assignments against staff policy/pairing changes.
    // Approving desired state can restrict active rights but never adds or activates code.
    await db.query('UPDATE control_plane.registry_product SET revision=revision+1 WHERE id=$1', [
      id,
    ]);
    const summary = (e: AssignmentEntry | null) =>
      e && {
        id: e.id,
        revision: e.revision,
        catalogueDigest: e.document.command.catalogueDigest,
        profileDigest: e.document.profileDigest,
        requestedIds: e.document.command.requestedIndividualIds,
        resolvedIds: e.document.command.confirmedResolvedIds,
      };
    const next = assignmentEntry.parse({
      id: command.operationId,
      kind,
      revision,
      document: prepared,
      actorId: current.id,
      createdAt,
    });
    await db.query(
      `INSERT INTO control_plane.registry_audit(id,client_id,resource_id,actor_id,actor_role,action,reason,"before","after",committed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        randomUUID(),
        p.binding.clientId,
        id,
        current.id,
        current.role,
        input.type,
        command.reason,
        JSON.stringify({
          draft: summary(before.draft),
          desired: summary(before.desired),
          activeBasis,
          allowedIds: authority?.policy.allowedModuleIds ?? null,
        }),
        JSON.stringify({
          draft: kind === 'draft' ? summary(next) : null,
          desired: kind === 'approved' ? summary(next) : summary(before.desired),
          activeBasis,
          allowedIds: authority
            ? kind === 'approved'
              ? allowed
              : authority.policy.allowedModuleIds
            : null,
        }),
        createdAt,
      ],
    );
    const result = catalogueReceipt.parse({
      requestId: command.operationId,
      resourceId: id,
      revision,
      committedAt: createdAt,
    });
    await db.query(
      'INSERT INTO control_plane.module_receipt(request_id,actor_id,digest,result,committed_at) VALUES($1,$2,$3,$4,$5)',
      [command.operationId, current.id, digest, JSON.stringify(result), createdAt],
    );
    return result;
  });
}
export async function readAssignment(headers: Headers, rawId: string) {
  await requireStaff(headers);
  const id = z.uuid().parse(rawId);
  const db = await runtime().pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const p = await product(db, id);
    const saved = await state(db, id);
    const desired = saved.desired;
    const authorityRow = (
      await db.query(
        'SELECT document,minimum_version FROM control_plane.module_authority WHERE product_id=$1',
        [id],
      )
    ).rows[0];
    const authority = authorityRow?.document
      ? moduleAuthorityDocument.parse(authorityRow.document)
      : null;
    const machine = (
      await db.query('SELECT epoch,revoked_at FROM control_plane.machine WHERE product_id=$1', [id])
    ).rows[0];
    const observation = (
      await db.query('SELECT * FROM control_plane.module_observation WHERE product_id=$1', [id])
    ).rows[0];
    const inventory =
      observation && machine && !machine.revoked_at && observation.epoch === machine.epoch
        ? {
            epoch: observation.epoch,
            installed: observation.installed,
            observedAt: iso(observation.observed_at),
          }
        : null;

    const delivery = desired ? await findDelivery(desired.document) : null;
    const { handover, effective } = await moduleHandover(db, p.binding.installationId);
    const statuses = deriveAssignmentStatuses(
      {
        desired: desired
          ? {
              catalogueDigest: desired.document.command.catalogueDigest,
              profileDigest: desired.document.profileDigest,
              revision: desired.revision,
              resolvedIds: desired.document.command.confirmedResolvedIds,
            }
          : null,
        legacy: p.row.legacy,
        policyState: p.row.policy_state,
        packageProfileDigest: delivery?.inventory.profileDigest ?? null,
        observed: inventory?.installed ?? null,
        effective: effective
          ? { ...effective, expiresAt: new Date(effective.expiresAt).getTime() }
          : null,
        awaitingAcknowledgement:
          !!authority &&
          authority.epoch === machine?.epoch &&
          handover.authorityReady &&
          authority.policy.active.assignmentRevision === desired?.revision &&
          authority.policy.active.profileDigest === desired.document.profileDigest &&
          authority.policy.allowedModuleIds.length === desired.document.profile.modules.length,
        restricted: !handover.authorityReady || p.row.archived || !!machine?.revoked_at,
      },
      Date.now(),
    );
    const view = assignmentView.parse({
      binding: p.binding,
      productRevision: p.row.revision,
      policyState: p.row.policy_state,
      archived: p.row.archived,
      legacy: p.row.legacy,
      minimumDecisionVersion: authorityRow?.minimum_version ?? 1,
      ...saved,
      delivery,
      observed: inventory,
      effective,
      handover,
      activeCatalogue: authority?.request.catalogue ?? null,
      authority: authority
        ? {
            epoch: authority.epoch,
            active: { ...authority.policy.active, policyRevision: p.row.revision },
            desired: authority.policy.desired,
            allowedIds: authority.policy.allowedModuleIds,
          }
        : null,
      inventory,
      statuses,
    });
    await db.query('COMMIT');
    return view;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
export async function listAssignmentCatalogues(headers: Headers, raw: unknown) {
  await requireStaff(headers);
  const query = assignmentCatalogueQuery.parse(raw);
  const rows = (
    await runtime().pool.query(
      "SELECT id,digest,document FROM control_plane.module_catalogue WHERE status='released' AND ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT 51",
      [query.after ?? null],
    )
  ).rows;
  return assignmentCatalogueList.parse({
    catalogues: rows.slice(0, 50).map((row) => {
      const c = catalogue.parse(row.document);
      return {
        id: row.id,
        digest: row.digest,
        platform: c.platform,
        moduleCount: c.modules.length,
      };
    }),
    nextCursor: rows.length > 50 ? rows[49].id : null,
  });
}

export async function exportDeliveryRequest(headers: Headers, rawId: string) {
  await requireStaff(headers);
  const id = z.uuid().parse(rawId);
  await product(runtime().pool, id);
  const desired = (await state(runtime().pool, id)).desired;
  if (!desired) throw new AccessError(409, 'Approve a desired assignment first');
  const source = (
    await runtime().pool.query(
      "SELECT document FROM control_plane.module_catalogue WHERE digest=$1 AND status='released'",
      [desired.document.profile.catalogueDigest],
    )
  ).rows[0];
  if (!source) throw new AccessError(409, 'Published catalogue unavailable');
  return validateDeliveryRequest({
    version: 1,
    catalogue: source.document,
    profile: desired.document.profile,
    profileDigest: desired.document.profileDigest,
  });
}
