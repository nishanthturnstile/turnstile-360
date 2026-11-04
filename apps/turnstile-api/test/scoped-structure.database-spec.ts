import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  type ConfigurationSnapshotDto,
  peopleErrorSchema,
  scopedCommandResultSchema,
  scopedUnitDetailSchema,
  scopedUnitsResponseSchema,
} from '@thaarei/turnstile-contracts';
import type { FastifyRequest } from 'fastify';
import { Pool, type PoolClient } from 'pg';
import { createApplication } from '../src/bootstrap.js';
import { parseProductEnvironment } from '../src/infrastructure/auth-environment.js';
import { withTenant } from '../src/infrastructure/database/postgres.js';
import { ProductPersistenceService } from '../src/infrastructure/database/product-persistence.service.js';
import { readAccess, scopeKey } from '../src/modules/access/access-evaluator.js';
import { StructureInvitationPolicy } from '../src/modules/access/structure-invitations.js';
import { BrowserAuthService } from '../src/modules/auth/browser-auth/browser-auth.service.js';
import { setUserAccess } from '../src/modules/auth/set-user-access.js';
import { OrganizationService } from '../src/modules/organization/organization.service.js';
import { ScopedStructureService } from '../src/modules/organization/scoped-structure.service.js';
import { StructureCommandsService } from '../src/modules/organization/structure-commands.service.js';
import { openAccessFixture, resetAccessFixture } from './access-fixture.js';

const manager = 'structure-fixture-manager';
const member = 'structure-fixture-member';
const actor = (userId = manager) => ({ userId, requestId: randomUUID() });

describe('scoped canonical structure reads and legacy access boundaries', () => {
  const config = parseProductEnvironment(process.env);
  const tenantId = config.INSTALLATION_TENANT_ID;
  const owner = new Pool({ connectionString: process.env.TURNSTILE_MIGRATION_DATABASE_URL });
  const owned = <T>(work: (client: PoolClient) => Promise<T>) => withTenant(owner, tenantId, work);
  let app: NestFastifyApplication;
  let organization: OrganizationService;
  let structure: ScopedStructureService;
  let commands: StructureCommandsService;
  let snapshot: ConfigurationSnapshotDto;
  let root: string;
  let a: string;
  let aChild: string;
  let aLeaf: string;
  let b: string;
  let bChild: string;
  let actingUser = member;

  beforeAll(async () => {
    app = await createApplication(false);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    organization = app.get(OrganizationService);
    structure = app.get(ScopedStructureService);
    commands = app.get(StructureCommandsService);
  });
  beforeEach(async () => {
    actingUser = member;
    await resetAccessFixture(owner, [
      { userId: manager, permissions: ['turnstile:access', 'turnstile:configuration:manage'] },
      { userId: member, permissions: ['turnstile:access'] },
    ]);
    snapshot = await organization.save(actor(), {
      expectedRevision: 0,
      name: 'Scoped fixture company',
      timeZone: 'UTC',
    });
    root = snapshot.organization.rootId as string;
    async function add(parentId: string, name: string, type: 'site' | 'department' = 'department') {
      const result = await organization.createUnit(
        actor(),
        { expectedRevision: snapshot.revision, parentId, name, type },
        randomUUID(),
      );
      snapshot = result.configuration;
      return result.unitId;
    }
    a = await add(root, 'Site A', 'site');
    aChild = await add(a, 'Alpha');
    aLeaf = await add(aChild, 'A leaf');
    b = await add(root, 'Site B', 'site');
    bChild = await add(b, 'Hidden B department');
    snapshot = await organization.complete(actor(), { expectedRevision: snapshot.revision });
    // Only live identity is stubbed. The real guards, current database evaluator,
    // transaction fencing, hierarchy, projections and HTTP filter all run.
    vi.spyOn(app.get(BrowserAuthService), 'authenticate').mockImplementation(
      async (request: FastifyRequest) => {
        const access = await owned((client) => readAccess(client, tenantId, actingUser));
        const current = {
          identity: {
            user: { id: actingUser, name: 'Fixture', email: 'fixture@example.test' },
            permissions: access.context.grants.flatMap((grant) => grant.permissions),
            access: access.context,
          },
          csrf: 'structure-fixture-csrf',
          access,
        } as unknown as NonNullable<FastifyRequest['productUser']>;
        request.productUser = current;
        return current;
      },
    );
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    await resetAccessFixture(owner);
    await owner.end();
  });

  async function assign(unitId: string, includeChildren: boolean, lockedClient?: PoolClient) {
    const assignmentId = randomUUID();
    const install = async (client: PoolClient) => {
      await client.query('SELECT turnstile.lock_access_context($1::uuid)', [tenantId]);
      await client.query(
        `INSERT INTO turnstile.access_assignment
          (tenant_id,id,member_id,role_id,scope_kind,include_children,scope_key)
          SELECT $1,$2,m.id,r.id,'units',$3,$4 FROM turnstile.access_member m
          JOIN turnstile.access_role r ON r.tenant_id = m.tenant_id AND r.system_key = 'unit_manager'
          WHERE m.tenant_id = $1 AND m.user_id = $5`,
        [
          tenantId,
          assignmentId,
          includeChildren,
          scopeKey({ kind: 'units', unitIds: [unitId], includeChildren }),
          member,
        ],
      );
      await client.query(
        'INSERT INTO turnstile.access_scope_anchor (tenant_id,assignment_id,unit_id) VALUES ($1,$2,$3)',
        [tenantId, assignmentId, unitId],
      );
      await client.query(
        'UPDATE turnstile.access_context SET revision = revision + 1 WHERE tenant_id = $1',
        [tenantId],
      );
    };
    if (lockedClient) await install(lockedClient);
    else await owned(install);
    return assignmentId;
  }

  async function list(query = '') {
    const response = await app.inject({ url: `/api/structure/units${query}` });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    return scopedUnitsResponseSchema.parse(response.json());
  }

  const headers = () => ({
    origin: config.AUTH_PUBLIC_ORIGIN,
    'x-csrf-token': 'structure-fixture-csrf',
    'idempotency-key': randomUUID(),
  });
  async function versions() {
    return {
      expectedOrganizationRevision: (await organization.read(actor())).revision,
      expectedAccessRevision: (await owned((client) => readAccess(client, tenantId, manager)))
        .context.accessRevision,
    };
  }
  async function openCommands() {
    await openAccessFixture(owner);
  }
  async function administrator() {
    await owned(async (client) => {
      await client.query('SELECT turnstile.lock_access_context($1::uuid)', [tenantId]);
      await client.query(
        `INSERT INTO turnstile.access_assignment (tenant_id,id,member_id,role_id,scope_kind,scope_key,include_children)
        SELECT $1,$2,m.id,r.id,'company','company',false FROM turnstile.access_member m JOIN turnstile.access_role r
        ON r.tenant_id=m.tenant_id AND r.system_key='workspace_administrator' WHERE m.tenant_id=$1 AND m.user_id=$3`,
        [tenantId, randomUUID(), manager],
      );
      await client.query(
        'UPDATE turnstile.access_context SET revision=revision+1 WHERE tenant_id=$1',
        [tenantId],
      );
    });
  }

  it('keeps public writers closed after CSRF and maps media/size/query errors without mutation', async () => {
    await assign(a, true);
    const value = { ...(await versions()), name: 'New child', parentId: a, type: 'department' };
    const denied = await app.inject({
      method: 'POST',
      url: '/api/structure/units',
      payload: value,
    });
    expect(denied.statusCode).toBe(403);
    const closed = await app.inject({
      method: 'POST',
      url: '/api/structure/units',
      headers: headers(),
      payload: value,
    });
    expect(closed.statusCode).toBe(503);
    expect(peopleErrorSchema.parse(closed.json())).toMatchObject({
      code: 'STRUCTURE_UNAVAILABLE',
      reason: 'readiness',
    });
    const media = await app.inject({
      method: 'POST',
      url: '/api/structure/units',
      headers: { ...headers(), 'content-type': 'text/plain' },
      payload: 'private input',
    });
    expect(media.statusCode).toBe(415);
    expect(media.json().code).toBe('STRUCTURE_MEDIA_TYPE_UNSUPPORTED');
    const large = await app.inject({
      method: 'POST',
      url: '/api/structure/units',
      headers: headers(),
      payload: { ...value, name: 'x'.repeat(17000) },
    });
    expect(large.statusCode).toBe(413);
    expect(large.json().code).toBe('STRUCTURE_TOO_LARGE');
    expect((await organization.read(actor())).revision).toBe(snapshot.revision);
  });

  it('permits exact rename but rejects child creation and parent-link deletion outside that exact scope', async () => {
    await openCommands();
    await assign(aChild, false);
    const renamed = await commands.rename(
      actor(member),
      aChild,
      { ...(await versions()), name: 'Exact rename' },
      randomUUID(),
    );
    expect(renamed).toMatchObject({
      kind: 'unit',
      changed: true,
      current: { unit: { id: aChild, name: 'Exact rename' } },
    });
    await expect(
      commands.create(
        actor(member),
        { ...(await versions()), name: 'Denied child', parentId: aChild, type: 'department' },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ response: { code: 'STRUCTURE_NOT_FOUND' } });
    await expect(
      commands.remove(actor(member), aChild, await versions(), randomUUID()),
    ).rejects.toMatchObject({ response: { code: 'STRUCTURE_NOT_FOUND' } });
    for (const id of [bChild, randomUUID()])
      await expect(
        commands.rename(actor(member), id, { ...(await versions()), name: 'Hidden' }, randomUUID()),
      ).rejects.toMatchObject({ response: { code: 'STRUCTURE_NOT_FOUND' } });
  });

  it('creates once under a subtree and replays/readbacks only current authorized scoped state', async () => {
    await openCommands();
    await assign(a, true);
    const key = randomUUID(),
      value = { ...(await versions()), name: 'Scoped child', parentId: aChild, type: 'department' };
    const responses = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: 'POST',
          url: '/api/structure/units',
          headers: { ...headers(), 'idempotency-key': key },
          payload: value,
        }),
      ),
    );
    expect(responses.some((r) => r.statusCode === 201)).toBe(true);
    for (let i = 0; i < responses.length; i++)
      if (responses[i]?.statusCode === 409) {
        expect(responses[i]?.json().code).toBe('ACCESS_CONTEXT_CHANGED');
        responses[i] = await app.inject({
          method: 'POST',
          url: '/api/structure/units',
          headers: { ...headers(), 'idempotency-key': key },
          payload: value,
        });
      }
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    const results = responses.map((r) => scopedCommandResultSchema.parse(r.json()));
    expect(new Set(results.map((r) => r.kind === 'unit' && r.current.unit.id)).size).toBe(1);
    const first = results[0];
    if (first?.kind !== 'unit') throw new Error('Expected created unit');
    expect(JSON.stringify(first)).not.toContain('Hidden B');
    expect(JSON.stringify(first)).not.toContain('completedBy');
    const id = first.current.unit.id;
    await organization.renameUnit(actor(), id, {
      expectedRevision: first.current.revision,
      name: 'Current saved name',
    });
    const repeated = await commands.create(actor(member), value, key);
    expect(repeated).toMatchObject({
      kind: 'unit',
      replayed: true,
      changed: false,
      current: { unit: { name: 'Current saved name' } },
    });
    expect(await commands.command(actor(member), key)).toMatchObject({
      kind: 'unit',
      current: { unit: { name: 'Current saved name' } },
    });
    await expect(
      commands.rename(actor(member), id, { ...(await versions()), name: 'Key reused' }, key),
    ).rejects.toMatchObject({ response: { reason: 'idempotency_mismatch' } });
    await expect(commands.command(actor(manager), key)).rejects.toMatchObject({
      response: { code: 'STRUCTURE_NOT_FOUND' },
    });
    await administrator();
    const moveCommand = { ...(await versions()), id, parentId: b },
      review = await commands.preview(actor(), moveCommand);
    await commands.move(
      actor(),
      id,
      { command: moveCommand, confirmation: review.confirmation },
      randomUUID(),
    );
    await expect(commands.command(actor(member), key)).rejects.toMatchObject({
      response: { code: 'STRUCTURE_NOT_FOUND' },
    });
    await organization.deleteUnit(actor(), id, {
      expectedRevision: (await versions()).expectedOrganizationRevision,
    });
    // The former parent remains readable, but a create receipt must not reveal
    // whether an out-of-scope unit was subsequently deleted elsewhere.
    await expect(commands.command(actor(member), key)).rejects.toMatchObject({
      response: { code: 'STRUCTURE_NOT_FOUND' },
    });
    await setUserAccess({
      operatorId: 'structure-fixture',
      userId: member,
      enabled: false,
      permissions: ['turnstile:access'],
    });
    await expect(commands.create(actor(member), value, key)).rejects.toMatchObject({
      response: { code: 'PRODUCT_ACCESS_DENIED' },
    });
  });

  it('returns safe stale-write conflicts and deleted tombstones without pinning terminal history', async () => {
    await openCommands();
    await assign(a, true);
    const stale = await versions();
    await commands.rename(actor(member), aChild, { ...stale, name: 'First change' }, randomUUID());
    await expect(
      commands.rename(actor(member), aChild, { ...stale, name: 'Stale draft' }, randomUUID()),
    ).rejects.toMatchObject({ response: { code: 'STRUCTURE_CONFLICT', reason: 'revision' } });
    const key = randomUUID(),
      value = await versions();
    const removed = await commands.remove(actor(member), aLeaf, value, key);
    expect(removed).toMatchObject({ kind: 'deleted_unit', id: aLeaf, changed: true });
    expect(await commands.remove(actor(member), aLeaf, value, key)).toMatchObject({
      kind: 'deleted_unit',
      id: aLeaf,
      replayed: true,
      changed: false,
    });
    expect(await commands.command(actor(member), key)).toMatchObject({
      kind: 'deleted_unit',
      id: aLeaf,
    });
  });

  it('allows local subtree moves and versioned no-ops but denies combining separate boundaries', async () => {
    await openCommands();
    await assign(a, true);
    const before = await versions(),
      key = randomUUID(),
      command = { ...before, id: aLeaf, parentId: a };
    const preview = await commands.preview(actor(member), command);
    expect(preview).toMatchObject({
      accessChanges: false,
      affectedMemberCount: 0,
      affectedInvitationCount: 0,
    });
    const moved = await commands.move(actor(member), aLeaf, { command, confirmation: null }, key);
    expect(moved).toMatchObject({
      changed: true,
      accessRevision: before.expectedAccessRevision,
      current: { unit: { parentId: a } },
    });
    const noop = { ...(await versions()), id: aLeaf, parentId: a };
    expect(
      await commands.move(
        actor(member),
        aLeaf,
        { command: noop, confirmation: null },
        randomUUID(),
      ),
    ).toMatchObject({ changed: false });
    await expect(
      commands.move(
        actor(member),
        aLeaf,
        { command: { ...noop, expectedOrganizationRevision: 0 }, confirmation: null },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ response: { reason: 'revision' } });
    await assign(b, true);
    await expect(
      commands.preview(actor(member), { ...(await versions()), id: aChild, parentId: b }),
    ).rejects.toMatchObject({ response: { code: 'ACCESS_COVERAGE_DENIED' } });
    // The member already covers both sides. Effective coverage does not change,
    // so the company legacy route can perform the structural move without a grant.
    const current = await versions();
    const legacy = await organization.moveUnit(actor(), aChild, {
      expectedRevision: current.expectedOrganizationRevision,
      parentId: b,
    });
    expect(legacy.units.find((row) => row.id === aChild)?.parentId).toBe(b);
    expect((await versions()).expectedAccessRevision).toBe(current.expectedAccessRevision);
  });

  it('requires people authority and confirmed impact, advances both revisions once and never restores an old move on replay', async () => {
    await openCommands();
    await assign(a, true);
    let command = { ...(await versions()), id: aChild, parentId: b };
    await expect(commands.preview(actor(), command)).rejects.toMatchObject({
      response: { code: 'ACCESS_COVERAGE_DENIED' },
    });
    await administrator();
    command = { ...(await versions()), id: aChild, parentId: b };
    const review = await commands.preview(actor(), command),
      key = randomUUID();
    expect(review).toMatchObject({
      accessChanges: true,
      affectedMemberCount: 1,
      affectedInvitationCount: 0,
    });
    expect(Object.keys(review).some((k) => k.endsWith('Ids'))).toBe(false);
    await expect(
      commands.move(actor(), aChild, { command, confirmation: null }, randomUUID()),
    ).rejects.toMatchObject({ response: { reason: 'impact_stale' } });
    const moved = await commands.move(
      actor(),
      aChild,
      { command, confirmation: review.confirmation },
      key,
    );
    expect(moved).toMatchObject({
      changed: true,
      accessRevision: command.expectedAccessRevision + 1,
      current: { revision: command.expectedOrganizationRevision + 1, unit: { parentId: b } },
    });
    const audit = await owned((client) =>
      client.query(
        "SELECT * FROM turnstile.access_audit WHERE tenant_id=$1 AND action='unit_coverage_changed'",
        [tenantId],
      ),
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      actor_kind: 'user',
      actor_id: manager,
      revision_before: command.expectedAccessRevision,
      revision_after: command.expectedAccessRevision + 1,
    });
    const back = { ...(await versions()), id: aChild, parentId: a },
      backReview = await commands.preview(actor(), back);
    await commands.move(
      actor(),
      aChild,
      { command: back, confirmation: backReview.confirmation },
      randomUUID(),
    );
    const replay = await commands.move(
      actor(),
      aChild,
      { command, confirmation: review.confirmation },
      key,
    );
    expect(replay).toMatchObject({
      changed: false,
      replayed: true,
      current: { unit: { parentId: a } },
    });
    const proof = await owned((client) =>
      client.query('SELECT token_hash FROM turnstile.access_impact_receipt WHERE tenant_id=$1', [
        tenantId,
      ]),
    );
    expect(proof.rows.every((row) => row.token_hash !== review.confirmation)).toBe(true);
  });

  it('invalidates impact on changed assignments, hierarchy, command or proof expiry', async () => {
    await openCommands();
    await assign(a, true);
    await administrator();
    const command = { ...(await versions()), id: aChild, parentId: b },
      review = await commands.preview(actor(), command);
    await assign(bChild, false);
    await expect(
      commands.move(actor(), aChild, { command, confirmation: review.confirmation }, randomUUID()),
    ).rejects.toMatchObject({ response: { reason: 'revision' } });
    const current = { ...(await versions()), id: aChild, parentId: b };
    await expect(
      commands.move(
        actor(),
        aChild,
        { command: current, confirmation: review.confirmation },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ response: { reason: 'impact_stale' } });
    const fresh = await commands.preview(actor(), current);
    await owned((client) =>
      client.query(
        `WITH old AS (DELETE FROM turnstile.access_impact_receipt WHERE tenant_id=$1 RETURNING *)
      INSERT INTO turnstile.access_impact_receipt (tenant_id,id,actor_id,token_hash,command_digest,actor_fingerprint,access_revision,organization_revision,created_at,expires_at)
      SELECT tenant_id,id,actor_id,token_hash,command_digest,actor_fingerprint,access_revision,organization_revision,created_at-interval '10 minutes',expires_at-interval '10 minutes' FROM old`,
        [tenantId],
      ),
    );
    await expect(
      commands.move(
        actor(),
        aChild,
        { command: current, confirmation: fresh.confirmation },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ response: { reason: 'impact_stale' } });
    const fresh2 = await commands.preview(actor(), current);
    await organization.renameUnit(actor(), bChild, {
      expectedRevision: current.expectedOrganizationRevision,
      name: 'Hierarchy revision changed',
    });
    await expect(
      commands.move(
        actor(),
        aChild,
        { command: current, confirmation: fresh2.confirmation },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ response: { reason: 'revision' } });
  });

  it('rolls back the tree, both revisions and command receipt if access audit insertion fails', async () => {
    await openCommands();
    await assign(a, true);
    await administrator();
    const command = { ...(await versions()), id: aChild, parentId: b },
      review = await commands.preview(actor(), command),
      key = randomUUID();
    await owner.query(
      `CREATE FUNCTION turnstile._structure_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fixture audit failure'; END $$`,
    );
    await owner.query(
      `CREATE TRIGGER _structure_fail_audit BEFORE INSERT ON turnstile.access_audit FOR EACH ROW WHEN (NEW.action='unit_coverage_changed') EXECUTE FUNCTION turnstile._structure_fail_audit()`,
    );
    try {
      await expect(
        commands.move(actor(), aChild, { command, confirmation: review.confirmation }, key),
      ).rejects.toMatchObject({ response: { code: 'STRUCTURE_UNAVAILABLE' } });
      expect(await versions()).toEqual({
        expectedAccessRevision: command.expectedAccessRevision,
        expectedOrganizationRevision: command.expectedOrganizationRevision,
      });
      expect(
        (await organization.read(actor())).units.find((row) => row.id === aChild)?.parentId,
      ).toBe(a);
      const receipts = await owned((client) =>
        client.query(
          'SELECT 1 FROM turnstile.access_command_receipt WHERE tenant_id=$1 AND key=$2',
          [tenantId, key],
        ),
      );
      expect(receipts.rowCount).toBe(0);
    } finally {
      await owner.query('DROP TRIGGER _structure_fail_audit ON turnstile.access_audit');
      await owner.query('DROP FUNCTION turnstile._structure_fail_audit()');
    }
  });

  it('enforces a database request deadline while waiting on locks without a late mutation', async () => {
    await openCommands();
    await assign(a, true);
    const value = { ...(await versions()), name: 'Deadline draft' },
      before = await organization.read(actor());
    await owned(async (client) => {
      await client.query('SELECT turnstile.lock_access_context($1::uuid)', [tenantId]);
      await expect(
        commands.rename(
          { ...actor(member), deadlineAt: Date.now() + 100 },
          aChild,
          value,
          randomUUID(),
        ),
      ).rejects.toMatchObject({ response: { code: 'STRUCTURE_UNAVAILABLE' } });
    });
    expect(await organization.read(actor())).toEqual(before);
  });

  it('binds approval generations to impact and invalidates them in the same transaction through the invitation policy', async () => {
    await openCommands();
    await administrator();
    const policy = app.get(StructureInvitationPolicy),
      approval = randomUUID();
    // Disposable stand-in for UM-I07's owning storage; no invitation feature
    // schema is added by I05. Runtime uses the same transaction and tenant RLS.
    await owner.query(
      'CREATE TABLE turnstile._structure_approval_fixture (tenant_id uuid NOT NULL,id uuid PRIMARY KEY,generation integer NOT NULL,state text NOT NULL)',
    );
    await owner.query(
      'ALTER TABLE turnstile._structure_approval_fixture ENABLE ROW LEVEL SECURITY',
    );
    await owner.query('ALTER TABLE turnstile._structure_approval_fixture FORCE ROW LEVEL SECURITY');
    await owner.query(
      `CREATE POLICY tenant ON turnstile._structure_approval_fixture USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)`,
    );
    await owner.query(
      'GRANT SELECT,UPDATE ON turnstile._structure_approval_fixture TO thaarei_turnstile_runtime',
    );
    try {
      await owned((client) =>
        client.query(
          "INSERT INTO turnstile._structure_approval_fixture VALUES($1,$2,1,'pending')",
          [tenantId, approval],
        ),
      );
      vi.spyOn(policy, 'references').mockImplementation(
        async (client, tenant, unit) =>
          unit === aLeaf &&
          (
            await client.query(
              "SELECT 1 FROM turnstile._structure_approval_fixture WHERE tenant_id=$1 AND state IN ('pending','needs_reapproval')",
              [tenant],
            )
          ).rowCount !== 0,
      );
      vi.spyOn(policy, 'impact').mockImplementation(async (client, tenant) => {
        const rows = (
          await client.query(
            'SELECT id,generation,state FROM turnstile._structure_approval_fixture WHERE tenant_id=$1 ORDER BY id',
            [tenant],
          )
        ).rows;
        return { ids: rows.map((row) => row.id), grants: [], digest: JSON.stringify(rows) };
      });
      const invalidation = vi
        .spyOn(policy, 'invalidate')
        .mockImplementation(async (client, tenant, impact) => {
          await client.query(
            "UPDATE turnstile._structure_approval_fixture SET generation=generation+1,state='needs_reapproval' WHERE tenant_id=$1 AND id=ANY($2::uuid[])",
            [tenant, impact.ids],
          );
        });
      await expect(
        commands.remove(actor(), aLeaf, await versions(), randomUUID()),
      ).rejects.toMatchObject({ response: { reason: 'reference_in_use' } });
      const command = { ...(await versions()), id: aChild, parentId: b },
        old = await commands.preview(actor(), command);
      expect(old).toMatchObject({ affectedInvitationCount: 1, accessChanges: true });
      await owned((client) =>
        client.query(
          'UPDATE turnstile._structure_approval_fixture SET generation=2 WHERE tenant_id=$1',
          [tenantId],
        ),
      );
      await expect(
        commands.move(actor(), aChild, { command, confirmation: old.confirmation }, randomUUID()),
      ).rejects.toMatchObject({ response: { reason: 'impact_stale' } });
      expect(invalidation).not.toHaveBeenCalled();
      const current = await commands.preview(actor(), command),
        key = randomUUID();
      invalidation.mockImplementationOnce(async (client, tenant, impact) => {
        await client.query(
          "UPDATE turnstile._structure_approval_fixture SET generation=generation+1,state='needs_reapproval' WHERE tenant_id=$1 AND id=ANY($2::uuid[])",
          [tenant, impact.ids],
        );
        throw new Error('Fixture approval transaction failure');
      });
      await expect(
        commands.move(actor(), aChild, { command, confirmation: current.confirmation }, key),
      ).rejects.toMatchObject({ response: { code: 'STRUCTURE_UNAVAILABLE' } });
      expect(
        (
          await owned((client) =>
            client.query(
              'SELECT generation FROM turnstile._structure_approval_fixture WHERE tenant_id=$1',
              [tenantId],
            ),
          )
        ).rows[0]?.generation,
      ).toBe(2);
      expect(
        (await organization.read(actor())).units.find((row) => row.id === aChild)?.parentId,
      ).toBe(a);
      await commands.move(actor(), aChild, { command, confirmation: current.confirmation }, key);
      expect(
        (
          await owned((client) =>
            client.query(
              'SELECT generation,state FROM turnstile._structure_approval_fixture WHERE tenant_id=$1',
              [tenantId],
            ),
          )
        ).rows[0],
      ).toEqual({ generation: 3, state: 'needs_reapproval' });
      await commands.move(actor(), aChild, { command, confirmation: current.confirmation }, key);
      expect(invalidation).toHaveBeenCalledTimes(2);
    } finally {
      await owner.query('DROP TABLE turnstile._structure_approval_fixture');
    }
  });

  it('fails closed if the owning invitation policy storage loses forced RLS', async () => {
    await openCommands();
    const before = await organization.read(actor());
    const currentVersions = await versions();
    await owner.query('ALTER TABLE turnstile.invitation NO FORCE ROW LEVEL SECURITY');
    try {
      await expect(
        commands.preview(actor(), { ...currentVersions, id: aChild, parentId: b }),
      ).rejects.toMatchObject({ response: { code: 'STRUCTURE_UNAVAILABLE' } });
      await expect(
        organization.moveUnit(actor(), aChild, { expectedRevision: before.revision, parentId: b }),
      ).rejects.toMatchObject({ response: { code: 'CONFIGURATION_UNAVAILABLE' } });
      await expect(
        commands.remove(actor(), aLeaf, currentVersions, randomUUID()),
      ).rejects.toMatchObject({ response: { code: 'STRUCTURE_UNAVAILABLE' } });
    } finally {
      await owner.query('ALTER TABLE turnstile.invitation FORCE ROW LEVEL SECURITY');
    }
    expect(await organization.read(actor())).toEqual(before);
  });

  it('preserves strict command identity across private/public operations and rejects canonical tree violations', async () => {
    await openCommands();
    await assign(a, true);
    const legacyKey = (
      await owned((client) =>
        client.query(
          'SELECT key FROM turnstile.configuration_create_receipt WHERE tenant_id=$1 AND unit_id=$2',
          [tenantId, a],
        ),
      )
    ).rows[0]?.key;
    await expect(
      commands.create(
        actor(),
        { ...(await versions()), name: 'Legacy key reused', parentId: a, type: 'department' },
        legacyKey,
      ),
    ).rejects.toMatchObject({ response: { reason: 'idempotency_mismatch' } });
    const scopedKey = randomUUID();
    await commands.rename(
      actor(),
      aChild,
      { ...(await versions()), name: 'Shared receipt namespace' },
      scopedKey,
    );
    await expect(
      organization.createUnit(
        actor(),
        {
          expectedRevision: (await versions()).expectedOrganizationRevision,
          name: 'Scoped key reused',
          parentId: a,
          type: 'department',
        },
        scopedKey,
      ),
    ).rejects.toMatchObject({ response: { reason: 'idempotency_mismatch' } });
    const key = randomUUID();
    await owned((client) =>
      client.query(
        `INSERT INTO turnstile.access_command_receipt (tenant_id,actor_id,key,operation,digest) VALUES($1,$2,$3,'legacy.retire',$4)`,
        [tenantId, member, key, '0'.repeat(64)],
      ),
    );
    await expect(
      commands.create(
        actor(member),
        { ...(await versions()), name: 'Must not create', parentId: a, type: 'department' },
        key,
      ),
    ).rejects.toMatchObject({ response: { reason: 'idempotency_mismatch' } });
    await expect(
      commands.create(
        actor(member),
        { ...(await versions()), name: 'Wrong site', parentId: aChild, type: 'site' },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ response: { code: 'STRUCTURE_INVALID' } });
    await expect(
      commands.move(
        actor(member),
        aChild,
        { command: { ...(await versions()), id: aChild, parentId: aLeaf }, confirmation: null },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ response: { code: 'STRUCTURE_INVALID' } });
    actingUser = manager;
    const query = await app.inject({
      method: 'PATCH',
      url: `/api/structure/units/${aChild}?tenantId=secret`,
      headers: headers(),
      payload: { ...(await versions()), name: 'Bad query' },
    });
    expect(query.statusCode).toBe(400);
    expect(query.body).not.toContain('secret');
  });

  it('checks the narrow structure functions in readiness while retaining read-only Access privileges', async () => {
    const persistence = app.get(ProductPersistenceService),
      runtime = persistence.pool;
    if (!runtime) throw new Error('Runtime fixture required');
    await expect(
      runtime.query('SELECT turnstile.save_structure_impact($1,$2,$3,$4,$4,$4,1,1)', [
        tenantId,
        manager,
        randomUUID(),
        '0'.repeat(64),
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withTenant(runtime, tenantId, (client) =>
        client.query('UPDATE turnstile.access_context SET revision=revision+1 WHERE tenant_id=$1', [
          tenantId,
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withTenant(runtime, tenantId, (client) =>
        client.query(
          'INSERT INTO turnstile.access_impact_receipt (tenant_id,id,actor_id,token_hash,command_digest,actor_fingerprint,access_revision,organization_revision) VALUES($1,$2,$3,$4,$4,$4,1,1)',
          [tenantId, randomUUID(), manager, '0'.repeat(64)],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await owner.query(
      'ALTER FUNCTION turnstile.save_structure_impact(uuid,text,uuid,text,text,text,integer,integer) RESET ALL',
    );
    try {
      expect(await persistence.ready()).toBe(false);
    } finally {
      await owner.query(
        'ALTER FUNCTION turnstile.save_structure_impact(uuid,text,uuid,text,text,text,integer,integer) SET search_path = pg_catalog, pg_temp',
      );
    }
    expect(await persistence.ready()).toBe(true);
  });

  it('returns finite capacity failure without partially issuing a move review', async () => {
    await openCommands();
    await owned((client) =>
      client.query(
        `INSERT INTO turnstile.access_impact_receipt
      (tenant_id,id,actor_id,token_hash,command_digest,actor_fingerprint,access_revision,organization_revision)
      SELECT $1,gen_random_uuid(),$2,lpad(g::text,64,'0'),repeat('0',64),repeat('0',64),1,1 FROM generate_series(1,1000) g`,
        [tenantId, manager],
      ),
    );
    await expect(
      commands.preview(actor(), { ...(await versions()), id: aChild, parentId: b }),
    ).rejects.toMatchObject({ response: { code: 'STRUCTURE_UNAVAILABLE', reason: 'capacity' } });
    expect(
      (
        await owned((client) =>
          client.query(
            'SELECT count(*)::int AS total FROM turnstile.access_impact_receipt WHERE tenant_id=$1',
            [tenantId],
          ),
        )
      ).rows[0]?.total,
    ).toBe(1000);
  });

  it('filters mixed scopes before search, totals and pagination, returning only minimal path labels', async () => {
    await assign(a, true);
    await assign(bChild, false);
    const result = await list();
    expect(new Set(result.units.map((row) => row.id))).toEqual(new Set([a, aChild, aLeaf, bChild]));
    expect(result.total).toBe(4);
    expect(result.ancestors).toEqual([
      { id: root, type: 'organization', name: 'Scoped fixture company', actionable: false },
      { id: b, type: 'site', name: 'Site B', actionable: false },
    ]);
    expect(Object.keys(result).sort()).toEqual([
      'accessRevision',
      'ancestors',
      'nextCursor',
      'revision',
      'total',
      'units',
    ]);
    // A breadcrumb permits no action or detail read, even though its label is shown.
    const hidden = await app.inject({ url: `/api/structure/units/${b}` });
    const missing = await app.inject({ url: `/api/structure/units/${randomUUID()}` });
    for (const response of [hidden, missing]) {
      expect(response.statusCode).toBe(404);
      expect(peopleErrorSchema.parse(response.json())).toEqual({
        code: 'STRUCTURE_NOT_FOUND',
        requestId: expect.any(String),
      });
    }
    expect(await list('?search=Site%20B')).toMatchObject({
      units: [],
      ancestors: [],
      total: 0,
      nextCursor: null,
    });
    const first = await list('?limit=1');
    expect(first.total).toBe(4);
    expect(first.units[0]?.id).toBe(aLeaf);
    expect(first.ancestors.map((row) => row.id)).toEqual([root, a, aChild]);
    const second = await list(`?limit=1&cursor=${first.nextCursor}`);
    expect(second.total).toBe(4);
    expect(second.units[0]?.id).toBe(aChild);
    expect((await app.inject({ url: '/api/organization/units' })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/organization' })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/setup' })).statusCode).toBe(403);
  });

  it('keeps exact anchors narrow and company shell access resource-neutral', async () => {
    expect(await list()).toMatchObject({ units: [], ancestors: [], total: 0 });
    await assign(aChild, false);
    const result = await list();
    expect(result.units.map((unit) => unit.id)).toEqual([aChild]);
    const detail = await app.inject({ url: `/api/structure/units/${aChild}` });
    expect(detail.statusCode).toBe(200);
    const current = scopedUnitDetailSchema.parse(detail.json());
    expect(current.ancestors).toEqual([
      { id: root, type: 'organization', name: 'Scoped fixture company', actionable: false },
      { id: a, type: 'site', name: 'Site A', actionable: false },
    ]);
    for (const id of [root, a, aLeaf, b, bChild])
      expect((await app.inject({ url: `/api/structure/units/${id}` })).statusCode).toBe(404);
    actingUser = manager;
    expect((await list()).total).toBe(5);
  });

  it('rejects stale and cross-actor cursors without returning hidden rows or a full snapshot', async () => {
    await assign(a, true);
    const first = await list('?limit=1');
    actingUser = manager;
    const other = await app.inject({ url: `/api/structure/units?cursor=${first.nextCursor}` });
    expect(other.statusCode).toBe(409);
    expect(peopleErrorSchema.parse(other.json())).toMatchObject({
      code: 'STRUCTURE_CONFLICT',
      reason: 'revision',
    });
    actingUser = member;
    snapshot = await organization.renameUnit(actor(), bChild, {
      expectedRevision: snapshot.revision,
      name: 'Still hidden',
    });
    const stale = await app.inject({ url: `/api/structure/units?cursor=${first.nextCursor}` });
    expect(stale.statusCode).toBe(409);
    expect(Object.keys(stale.json()).sort()).toEqual([
      'accessRevision',
      'code',
      'organizationRevision',
      'reason',
      'requestId',
    ]);
    const forged = Buffer.from(
      JSON.stringify({
        revision: snapshot.revision,
        accessRevision: first.accessRevision,
        fingerprint: (await owned((client) => readAccess(client, tenantId, member))).context
          .fingerprint,
        search: '',
        after: bChild,
      }),
    ).toString('base64url');
    const invalid = await app.inject({ url: `/api/structure/units?cursor=${forged}` });
    expect(invalid.statusCode).toBe(400);
    expect(peopleErrorSchema.parse(invalid.json())).toMatchObject({
      code: 'STRUCTURE_INVALID',
      fieldErrors: [{ field: 'cursor', reason: 'invalid' }],
    });
  });

  it('rechecks the actor context inside the transaction after the guard read', async () => {
    await assign(a, true);
    const access = await owned((client) => readAccess(client, tenantId, member));
    await assign(b, true);
    await expect(
      structure.list({ ...actor(member), accessFingerprint: access.context.fingerprint }, {}),
    ).rejects.toMatchObject({
      response: { code: 'ACCESS_CONTEXT_CHANGED' },
    });
    await setUserAccess({
      operatorId: 'structure-fixture',
      userId: member,
      enabled: false,
      permissions: ['turnstile:access'],
    });
    await expect(structure.list(actor(member), {})).rejects.toMatchObject({
      response: { code: 'PRODUCT_ACCESS_DENIED' },
    });
  });

  it('uses finite errors for invalid queries, paths and unavailable canonical data', async () => {
    for (const url of [
      '/api/structure/units?tenantId=secret-value',
      '/api/structure/units?limit=101',
      '/api/structure/units?cursor=garbage',
      '/api/structure/units/not-a-uuid',
      `/api/structure/units/${a}?extra=secret-value`,
    ]) {
      const response = await app.inject({ url });
      expect(response.statusCode).toBe(400);
      expect(peopleErrorSchema.parse(response.json()).code).toBe('STRUCTURE_INVALID');
      expect(response.body).not.toContain('secret-value');
    }
    vi.spyOn(app.get(ScopedStructureService), 'list').mockRejectedValueOnce(
      new Error('private SQL fixture failure'),
    );
    const unavailable = await app.inject({ url: '/api/structure/units' });
    expect(unavailable.statusCode).toBe(503);
    expect(peopleErrorSchema.parse(unavailable.json())).toMatchObject({
      code: 'STRUCTURE_UNAVAILABLE',
      reason: 'dependency',
    });
    expect(unavailable.body).not.toContain('SQL');
  });

  it('blocks legacy moves entering or leaving a subtree anchor without an access-impact confirmation', async () => {
    await assign(a, true);
    const before = await organization.read(actor());
    for (const [id, parentId] of [
      [aChild, b],
      [bChild, a],
    ]) {
      await expect(
        organization.moveUnit(actor(), id, { expectedRevision: before.revision, parentId }),
      ).rejects.toMatchObject({
        response: {
          code: 'CONFIGURATION_CONFLICT',
          reason: 'unit_in_use',
          revision: before.revision,
        },
      });
    }
    expect(await organization.read(actor())).toEqual(before);
    actingUser = manager;
    const http = await app.inject({
      method: 'PATCH',
      url: `/api/organization/units/${aChild}/parent`,
      headers: { origin: config.AUTH_PUBLIC_ORIGIN, 'x-csrf-token': 'structure-fixture-csrf' },
      payload: { expectedRevision: before.revision, parentId: b },
    });
    expect(http.statusCode).toBe(409);
    expect(http.json()).toEqual({
      code: 'CONFIGURATION_CONFLICT',
      reason: 'unit_in_use',
      revision: before.revision,
    });
    const audit = await owned((client) =>
      client.query(
        "SELECT count(*)::int AS total FROM turnstile.configuration_audit WHERE tenant_id = $1 AND action = 'unit_moved'",
        [tenantId],
      ),
    );
    expect(audit.rows[0].total).toBe(0);
    // Explicit anchors remain attached to their ID; moving the whole anchored
    // department preserves its own coverage and is not an inherited grant.
    const stable = await organization.moveUnit(actor(), a, {
      expectedRevision: before.revision,
      parentId: root,
    });
    expect(stable).toEqual(before);
    await expect(
      organization.moveUnit(actor(), aChild, {
        expectedRevision: before.revision - 1,
        parentId: a,
      }),
    ).rejects.toMatchObject({ response: { reason: 'revision' } });
  });

  it('sees an assignment committed while a legacy move waits for the shared locks', async () => {
    let moving: Promise<unknown> | undefined;
    await owned(async (client) => {
      await client.query('SELECT turnstile.lock_access_context($1::uuid)', [tenantId]);
      moving = organization
        .moveUnit(actor(), aChild, { expectedRevision: snapshot.revision, parentId: b })
        .catch((error: unknown) => error);
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await owner.query(
          `SELECT EXISTS (SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
            WHERE a.datname = current_database() AND a.usename = 'thaarei_turnstile_runtime'
              AND NOT l.granted) AS waiting`,
        );
        if (result.rows[0]?.waiting) {
          waiting = true;
          break;
        }
        await delay(10);
      }
      expect(waiting).toBe(true);
      await assign(a, true, client);
    });
    expect(await moving).toMatchObject({
      response: { code: 'CONFIGURATION_CONFLICT', reason: 'unit_in_use' },
    });
    expect(
      (await organization.read(actor())).units.find((unit) => unit.id === aChild)?.parentId,
    ).toBe(a);
  });

  it('preserves exact anchors across harmless moves and blocks deletion for suspended references', async () => {
    const assignment = await assign(aLeaf, false);
    snapshot = await organization.moveUnit(actor(), aLeaf, {
      expectedRevision: snapshot.revision,
      parentId: b,
    });
    expect((await list()).units.map((unit) => unit.id)).toEqual([aLeaf]);
    await setUserAccess({
      operatorId: 'structure-fixture',
      userId: member,
      enabled: false,
      permissions: ['turnstile:access'],
    });
    await expect(
      organization.deleteUnit(actor(), aLeaf, { expectedRevision: snapshot.revision }),
    ).rejects.toMatchObject({ response: { reason: 'unit_in_use' } });
    await owned(async (client) => {
      await client.query('SELECT turnstile.lock_access_context($1::uuid)', [tenantId]);
      await client.query(
        'DELETE FROM turnstile.access_scope_anchor WHERE tenant_id = $1 AND assignment_id = $2',
        [tenantId, assignment],
      );
      await client.query(
        'DELETE FROM turnstile.access_assignment WHERE tenant_id = $1 AND id = $2',
        [tenantId, assignment],
      );
    });
    const removed = await organization.deleteUnit(actor(), aLeaf, {
      expectedRevision: snapshot.revision,
    });
    expect(removed.units.some((unit) => unit.id === aLeaf)).toBe(false);
    const history = await owned((client) =>
      client.query(
        'SELECT count(*)::int AS total FROM turnstile.configuration_audit WHERE tenant_id = $1 AND subject_id = $2',
        [tenantId, aLeaf],
      ),
    );
    expect(history.rows[0].total).toBeGreaterThan(1);
  });
});
