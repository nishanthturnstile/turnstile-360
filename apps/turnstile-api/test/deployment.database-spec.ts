import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  DeploymentClient,
  ProtectedFileStore,
  readProtectedTrust,
  type Transport,
} from '@thaarei/deployment-control';
import { importPKCS8, SignJWT } from 'jose';
import { Pool } from 'pg';
import { withTenant } from '../src/infrastructure/database/postgres.js';
import { evaluateStored } from '../src/modules/deployment/access.js';
import { TurnstileDeploymentStore } from '../src/modules/deployment/store.js';

describe('Turnstile-owned deployment persistence and private reporter', () => {
  const tenantId = process.env.INSTALLATION_TENANT_ID as string;
  const owner = new Pool({
    connectionString: process.env.TURNSTILE_MIGRATION_DATABASE_URL,
    max: 2,
  });
  const coordinator = new Pool({
    connectionString: process.env.TURNSTILE_REPORTER_DATABASE_URL,
    max: 5,
  });
  afterAll(async () => {
    await Promise.all([owner.end(), coordinator.end()]);
  });
  it('samples the deployment clock after a blocked writer and still quarantines a future durable clock floor', async () => {
    const runtime = new Pool({ connectionString: process.env.TURNSTILE_DATABASE_URL, max: 1 });
    const held = await owner.connect();
    const waiter = await runtime.connect();
    const savedClock = await withTenant(
      owner,
      tenantId,
      async (db) => (await db.query('SELECT * FROM turnstile.deployment_clock_state')).rows[0],
    );
    await withTenant(owner, tenantId, (db) =>
      db.query(
        'INSERT INTO turnstile.deployment_clock_state(tenant_id) VALUES($1) ON CONFLICT DO NOTHING',
        [tenantId],
      ),
    );
    let waiting: Promise<unknown> | undefined;
    try {
      await held.query('BEGIN');
      await held.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
      await held.query('SELECT * FROM turnstile.deployment_clock_state FOR UPDATE');
      const holderPid = (await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await waiter.query('BEGIN');
      await waiter.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
      const waiterPid = (await waiter.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      waiting = waiter.query('SELECT turnstile.deployment_clock() AS value');
      let blocked = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        const pids = (await owner.query('SELECT pg_blocking_pids($1) AS pids', [waiterPid])).rows[0]
          .pids;
        if (pids.includes(holderPid)) {
          blocked = true;
          break;
        }
        await delay(20);
      }
      expect(blocked).toBe(true);
      await delay(1200);
      await held.query(
        'UPDATE turnstile.deployment_clock_state SET last_time=floor(extract(epoch FROM clock_timestamp())),quarantined=false',
      );
      await held.query('COMMIT');
      const result = (await waiting) as { rows: { value: { quarantined: boolean } }[] };
      await waiter.query('COMMIT');
      expect(result.rows[0]?.value.quarantined).toBe(false);
      await withTenant(owner, tenantId, (db) =>
        db.query(
          'UPDATE turnstile.deployment_clock_state SET last_time=floor(extract(epoch FROM clock_timestamp()))+30,quarantined=false',
        ),
      );
      await waiter.query('BEGIN');
      await waiter.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
      const backward = (await waiter.query('SELECT turnstile.deployment_clock() AS value')).rows[0]
        .value;
      await waiter.query('COMMIT');
      expect(backward.quarantined).toBe(true);
    } finally {
      await held.query('ROLLBACK').catch(() => {});
      await waiting?.catch(() => {});
      await waiter.query('ROLLBACK').catch(() => {});
      held.release();
      waiter.release();
      await withTenant(owner, tenantId, (db) =>
        db.query('UPDATE turnstile.deployment_clock_state SET last_time=$1,quarantined=$2', [
          savedClock?.last_time ?? 0,
          savedClock?.quarantined ?? false,
        ]),
      );
      await runtime.end();
    }
  });
  it('recovers DB-before-file promotion, fences independent operators and reports from read-only credentials without storing secrets in SQL', async () => {
    const saved = await withTenant(
      owner,
      tenantId,
      async (db) => (await db.query('SELECT * FROM turnstile.deployment_control')).rows[0],
    );
    const material = JSON.parse(
      await readFile(process.env.TURNSTILE_DEPLOYMENT_FIXTURE_FILE as string, 'utf8'),
    );
    const key = await importPKCS8(material.privateKey, 'RS256');
    const folder = await mkdtemp(join(tmpdir(), 'thaarei-dms-private-'));
    const directory = join(folder, 'state');
    await mkdir(directory, { mode: 0o700 });
    const store = new TurnstileDeploymentStore(
      directory,
      process.env.TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE as string,
      coordinator,
      tenantId,
      true,
    );
    const epoch = randomUUID();
    let live: { secret: string; generation: number; operationId: string } | null = null;
    let policy: 'pending' | 'approved' = 'pending',
      revision = 1,
      sequence = 0,
      dropRotation = false,
      dropPairing = true;
    const transport: Transport = async (path, raw, secret) => {
      const input = raw as Record<string, unknown>;
      if (path === 'activate') {
        live = {
          secret: String(input.candidateSecret),
          generation: 1,
          operationId: String(input.requestId),
        };
        if (dropPairing) throw new Error('Lost committed pairing response');
      } else if (!live || secret !== live.secret) throw new Error('Unrecognized candidate');
      if (path === 'rotate') {
        if (input.expectedGeneration !== live?.generation) throw new Error('Generation mismatch');
        live = {
          secret: String(input.candidateSecret),
          generation: (live?.generation ?? 0) + 1,
          operationId: String(input.operationId),
        };
        if (dropRotation) throw new Error('Lost committed rotation response');
      }
      if (!live) throw new Error('Pair first');
      if (path !== 'sync')
        return {
          version: 1,
          requestId: live.operationId,
          binding: saved.binding,
          epoch,
          generation: live.generation,
          operationId: live.operationId,
        };
      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({
        version: 1,
        iss: material.trust.issuer,
        aud: `urn:thaarei:deployment:${saved.binding.productId}`,
        binding: saved.binding,
        epoch,
        policyRevision: revision,
        decisionSequence: ++sequence,
        decisionId: randomUUID(),
        iat: now,
        nbf: now,
        exp: now + 604800,
        state: policy,
        ...(policy === 'approved' ? { entitlement: 'product-business' } : {}),
      })
        .setProtectedHeader({ alg: 'RS256', typ: 'thaarei-deployment+jwt', kid: 'fixture' })
        .sign(key);
      return {
        version: 1,
        receiptId: input.reportId,
        binding: saved.binding,
        epoch,
        generation: live.generation,
        operationId: live.operationId,
        decision: token,
      };
    };
    const trust = () =>
      readProtectedTrust(process.env.TURNSTILE_CONTROL_PLANE_VERIFICATION_KEYS_FILE as string);
    let client = new DeploymentClient(store, transport, trust);
    try {
      const pairing = {
        version: 1,
        origin: material.trust.issuer,
        binding: saved.binding,
        pairingId: randomUUID(),
        code: randomBytes(32).toString('base64url'),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      };
      await expect(client.setup(pairing, true)).rejects.toThrow('Lost committed pairing response');
      const pending = await store.load();
      expect(
        (
          await withTenant(
            owner,
            tenantId,
            async (db) =>
              (
                await db.query('SELECT turnstile.deployment_read() AS snapshot')
              ).rows[0].snapshot,
          )
        ).quarantined,
      ).toBe(true);
      dropPairing = false;
      client = new DeploymentClient(
        new TurnstileDeploymentStore(
          directory,
          process.env.TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE as string,
          coordinator,
          tenantId,
        ),
        transport,
        trust,
      );
      await client.sync();
      expect((await store.load())?.current?.secret).toBe(
        pending?.operation?.kind === 'activate' ? pending.operation.request.candidateSecret : null,
      );
      const row = () =>
        withTenant(
          owner,
          tenantId,
          async (db) =>
            (await db.query('SELECT turnstile.deployment_read() AS snapshot')).rows[0]?.snapshot,
        );
      expect((await evaluateStored(await row())).access).toBe('closed');
      policy = 'approved';
      revision++;
      await client.sync();
      expect((await evaluateStored(await row())).access).toBe('full');
      dropRotation = true;
      await expect(client.rotate()).rejects.toThrow('Lost committed');
      dropRotation = false;
      client = new DeploymentClient(store, transport, trust);
      await client.sync();
      expect((await store.load())?.current?.generation).toBe(2);
      const originalSave = ProtectedFileStore.prototype.save;
      let fail = true;
      const spy = vi.spyOn(ProtectedFileStore.prototype, 'save').mockImplementation(async function (
        this: ProtectedFileStore,
        value,
      ) {
        if (fail && value.current?.generation === 3 && !value.operation) {
          fail = false;
          throw new Error('Process died before filesystem promotion');
        }
        return originalSave.call(this, value);
      });
      try {
        await expect(client.rotate()).rejects.toThrow();
      } finally {
        spy.mockRestore();
      }
      expect((await row()).credential_metadata.generation).toBe(3);
      client = new DeploymentClient(store, transport, trust);
      await client.sync();
      expect((await store.load())?.current?.generation).toBe(3);
      const current = await store.load();
      expect(JSON.stringify(await row())).not.toContain(current?.current?.secret);
      // The reporter's mount is read-only. SQL carries only the safe report journal and proofs.
      await chmod(join(directory, 'product.json'), 0o400);
      await chmod(directory, 0o500);
      const readOnly = new TurnstileDeploymentStore(
        directory,
        process.env.TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE as string,
        coordinator,
        tenantId,
        false,
        true,
      );
      const before = await readFile(join(directory, 'product.json'), 'utf8');
      await new DeploymentClient(readOnly, transport, trust).sync();
      await expect(new DeploymentClient(readOnly, transport, trust).sync()).rejects.toThrow(
        'elected reporter',
      );
      expect(await readFile(join(directory, 'product.json'), 'utf8')).toBe(before);
      await chmod(directory, 0o700);
      await chmod(join(directory, 'product.json'), 0o600);
      // Explicitly hold the shared PG operation lock; an independent command must not write.
      const peer = new TurnstileDeploymentStore(
        directory,
        process.env.TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE as string,
        coordinator,
        tenantId,
      );
      await store.locked(async () => {
        await expect(peer.locked(async () => {})).rejects.toThrow('another process');
      });
      await peer.locked(async () => {});
    } finally {
      await chmod(directory, 0o700);
      await rm(folder, { recursive: true, force: true });
      await withTenant(owner, tenantId, (db) =>
        db.query(
          'UPDATE turnstile.deployment_control SET binding=$1,decision=$2,marker_digest=$3,quarantined=$4,credential_metadata=$5',
          [
            JSON.stringify(saved.binding),
            JSON.stringify(saved.decision),
            saved.marker_digest,
            saved.quarantined,
            JSON.stringify(saved.credential_metadata),
          ],
        ),
      );
    }
  });
});

describe('Turnstile deployment role isolation and reporter lifecycle', () => {
  it('keeps runtime decisions read-only and summaries private, with bounded missing-key startup', async () => {
    const runtime = new Pool({ connectionString: process.env.TURNSTILE_DATABASE_URL, max: 1 });
    const reporter = new Pool({
      connectionString: process.env.TURNSTILE_REPORTER_DATABASE_URL,
      max: 2,
    });
    const tenant = process.env.INSTALLATION_TENANT_ID as string;
    try {
      await expect(
        withTenant(runtime, tenant, (db) =>
          db.query('UPDATE turnstile.deployment_control SET decision=NULL'),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        withTenant(reporter, tenant, (db) =>
          db.query(
            'UPDATE turnstile.deployment_control SET local_installation_id=gen_random_uuid()',
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        withTenant(reporter, tenant, (db) => db.query('SELECT * FROM turnstile.access_member')),
      ).rejects.toMatchObject({ code: '42501' });
      const snapshot = await withTenant(
        reporter,
        tenant,
        async (db) =>
          (await db.query('SELECT turnstile.deployment_summary() AS summary')).rows[0].summary,
      );
      expect(Object.keys(snapshot)).toEqual(['activeMembers']);
      expect(snapshot.activeMembers).toBeGreaterThanOrEqual(0);
      const { startReporter } = await import('../src/modules/deployment/reporter.js');
      const secret = process.env.TURNSTILE_CONTROL_PLANE_MACHINE_SECRET_FILE;
      delete process.env.TURNSTILE_CONTROL_PLANE_MACHINE_SECRET_FILE;
      try {
        const stop = startReporter();
        await new Promise((done) => setTimeout(done, 20));
        await stop();
      } finally {
        if (secret) process.env.TURNSTILE_CONTROL_PLANE_MACHINE_SECRET_FILE = secret;
      }
    } finally {
      await runtime.end();
      await reporter.end();
    }
  });
});
