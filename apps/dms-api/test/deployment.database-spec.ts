import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { deploymentSummary, startDeploymentReporter } from '../src/modules/deployment/reporter.js';
import { DmsDeploymentStore } from '../src/modules/deployment/store.js';
import { createWorkApplication } from '../src/work-bootstrap.js';

describe('DMS-owned deployment persistence and private reporter', () => {
  const tenantId = process.env.INSTALLATION_TENANT_ID as string;
  const owner = new Pool({ connectionString: process.env.DMS_MIGRATION_DATABASE_URL, max: 2 });
  const coordinator = new Pool({
    connectionString: process.env.DMS_COORDINATOR_DATABASE_URL,
    max: 5,
  });
  afterAll(async () => {
    await Promise.all([owner.end(), coordinator.end()]);
  });
  it('recovers DB-before-file promotion, fences independent operators and reports from read-only credentials without storing secrets in SQL', async () => {
    const saved = await withTenant(
      owner,
      tenantId,
      async (db) => (await db.query('SELECT * FROM dms.deployment_control')).rows[0],
    );
    const material = JSON.parse(
      await readFile(process.env.DMS_DEPLOYMENT_FIXTURE_FILE as string, 'utf8'),
    );
    const key = await importPKCS8(material.privateKey, 'RS256');
    const folder = await mkdtemp(join(tmpdir(), 'thaarei-dms-private-'));
    const directory = join(folder, 'state');
    await mkdir(directory, { mode: 0o700 });
    const store = new DmsDeploymentStore(
      directory,
      process.env.CONTROL_PLANE_RECOVERY_MARKER_FILE as string,
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
      readProtectedTrust(process.env.CONTROL_PLANE_VERIFICATION_KEYS_FILE as string);
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
                await db.query('SELECT dms.deployment_read() AS snapshot')
              ).rows[0].snapshot,
          )
        ).quarantined,
      ).toBe(true);
      dropPairing = false;
      client = new DeploymentClient(
        new DmsDeploymentStore(
          directory,
          process.env.CONTROL_PLANE_RECOVERY_MARKER_FILE as string,
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
            (await db.query('SELECT dms.deployment_read() AS snapshot')).rows[0]?.snapshot,
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
      const readOnly = new DmsDeploymentStore(
        directory,
        process.env.CONTROL_PLANE_RECOVERY_MARKER_FILE as string,
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
      const peer = new DmsDeploymentStore(
        directory,
        process.env.CONTROL_PLANE_RECOVERY_MARKER_FILE as string,
        coordinator,
        tenantId,
      );
      await store.locked(async () => {
        await expect(peer.locked(async () => {})).rejects.toThrow('another process');
      });
      await peer.locked(async () => {});
      // A disconnected reporter can receive a valid response after its shared operation lease is lost.
      // Exercise the production store's fence before applying that response, then recover its journal.
      await withTenant(owner, tenantId, (db) =>
        db.query(
          "UPDATE dms.deployment_control SET credential_metadata=credential_metadata-'nextAttemptAt'",
        ),
      );
      const acceptedBefore = (await row()).decision.accepted.digest;
      const staleTransport: Transport = async (path, input, secret) => {
        const response = await transport(path, input, secret);
        if (path === 'sync') {
          await coordinator.query(
            "SELECT pg_terminate_backend(a.pid) FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.datname=current_database() AND a.usename=current_user AND l.locktype='advisory' AND l.granted AND a.pid<>pg_backend_pid()",
          );
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return response;
      };
      await expect(new DeploymentClient(readOnly, staleTransport, trust).sync()).rejects.toThrow(
        'lock lost',
      );
      expect((await row()).decision.accepted.digest).toBe(acceptedBefore);
      expect((await row()).credential_metadata.report).not.toBeNull();
      await withTenant(owner, tenantId, (db) =>
        db.query(
          "UPDATE dms.deployment_control SET credential_metadata=credential_metadata-'nextAttemptAt'",
        ),
      );
      await new DeploymentClient(readOnly, transport, trust).sync();
      expect((await row()).credential_metadata.report).toBeNull();
      const oldSecret = process.env.CONTROL_PLANE_MACHINE_SECRET_FILE;
      const oldIssuer = process.env.DMS_WORK_ISSUER_URL,
        oldHttp = process.env.DMS_WORK_ALLOW_HTTP;
      process.env.CONTROL_PLANE_MACHINE_SECRET_FILE = join(directory, 'product.json');
      process.env.DMS_WORK_ISSUER_URL = process.env.AUTH_ISSUER_URL;
      process.env.DMS_WORK_ALLOW_HTTP = 'true';
      await withTenant(owner, tenantId, (db) =>
        db.query(
          "UPDATE dms.deployment_control SET credential_metadata=credential_metadata-'nextAttemptAt'",
        ),
      );
      const stopReporter = startDeploymentReporter(coordinator, tenantId);
      const app = await createWorkApplication();
      try {
        await app.init();
        const health = await app.inject({ method: 'GET', url: '/health/live' });
        expect(health.statusCode).toBe(200);
        await stopReporter(); // Real bounded HTTPS/DNS failure cannot gate local liveness.
      } finally {
        await stopReporter();
        await app.close();
        if (oldSecret) process.env.CONTROL_PLANE_MACHINE_SECRET_FILE = oldSecret;
        else delete process.env.CONTROL_PLANE_MACHINE_SECRET_FILE;
        if (oldIssuer) process.env.DMS_WORK_ISSUER_URL = oldIssuer;
        else delete process.env.DMS_WORK_ISSUER_URL;
        if (oldHttp) process.env.DMS_WORK_ALLOW_HTTP = oldHttp;
        else delete process.env.DMS_WORK_ALLOW_HTTP;
      }
    } finally {
      await chmod(directory, 0o700);
      await rm(folder, { recursive: true, force: true });
      await withTenant(owner, tenantId, (db) =>
        db.query(
          'UPDATE dms.deployment_control SET binding=$1,decision=$2,marker_digest=$3,quarantined=$4,credential_metadata=$5',
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
  it('allocates durable ordered report sequences, resets epochs explicitly and keeps usage overflow unknown', async () => {
    const version = process.env.DMS_BUILD_VERSION;
    process.env.DMS_BUILD_VERSION = '0.20.0-fixture';
    const saved = (
      await withTenant(owner, tenantId, (db) =>
        db.query('SELECT credential_metadata,decision FROM dms.deployment_control'),
      )
    ).rows[0];
    const epoch = randomUUID();
    try {
      const a = await deploymentSummary(coordinator, tenantId, epoch),
        b = await deploymentSummary(coordinator, tenantId, epoch);
      expect(a?.sequence).toBe(1);
      expect(b?.sequence).toBe(2);
      expect(a?.reportEpoch).toBe(epoch);
      expect((await deploymentSummary(coordinator, tenantId, randomUUID()))?.sequence).toBe(1);
      await withTenant(owner, tenantId, async (db) => {
        await db.query('SELECT dms.ensure_deployment_usage()');
        await db.query('UPDATE dms.deployment_usage SET overflow=true');
      });
      const overflow = await deploymentSummary(coordinator, tenantId, epoch);
      expect(overflow?.product === 'dms' && overflow.counters?.publishedDocuments).toBeNull();
      await withTenant(owner, tenantId, (db) =>
        db.query(
          "UPDATE dms.deployment_control SET credential_metadata=credential_metadata||jsonb_build_object('lastReportEpoch',$1::text,'lastReportSequence',9007199254740991)",
          [epoch],
        ),
      );
      await expect(deploymentSummary(coordinator, tenantId, epoch)).rejects.toThrow('exhausted');
      // Rebinding a restored installation starts a named counter epoch; it cannot invent lifetime totals.
      const before = (
        await withTenant(owner, tenantId, (db) =>
          db.query('SELECT epoch FROM dms.deployment_usage'),
        )
      ).rows[0].epoch;
      await withTenant(owner, tenantId, (db) =>
        db.query(
          "UPDATE dms.deployment_control SET decision=jsonb_set(decision,'{epoch}',to_jsonb($1::text))",
          [randomUUID()],
        ),
      );
      const reset = await deploymentSummary(coordinator, tenantId, randomUUID());
      expect(reset?.product === 'dms' && reset.counters?.epoch).not.toBe(before);
      expect(reset?.product === 'dms' && reset.counters?.publishedDocuments).toBe(0);
    } finally {
      if (version) process.env.DMS_BUILD_VERSION = version;
      else delete process.env.DMS_BUILD_VERSION;
      await withTenant(owner, tenantId, (db) =>
        db.query('UPDATE dms.deployment_control SET credential_metadata=$1,decision=$2', [
          JSON.stringify(saved.credential_metadata),
          JSON.stringify(saved.decision),
        ]),
      );
    }
  });
  it('keeps cold-start reporter failure bounded and exports only approved DMS aggregates', async () => {
    const origin = process.env.CONTROL_PLANE_ORIGIN;
    const version = process.env.DMS_BUILD_VERSION;
    const customer = process.env.INSTALLATION_CUSTOMER_KEY;
    process.env.DMS_BUILD_VERSION = '0.20.0-fixture';
    try {
      const report = await deploymentSummary(coordinator, tenantId, randomUUID());
      expect(report?.product).toBe('dms');
      for (const table of ['deployment_usage', 'deployment_usage_event'])
        await expect(coordinator.query(`SELECT * FROM dms.${table}`)).rejects.toMatchObject({
          code: '42501',
        });
      expect(report).not.toHaveProperty('applications');
      expect(JSON.stringify(report)).not.toContain(tenantId);
      // No credentials yet: the first tick fails closed without blocking the caller/loop.
      delete process.env.CONTROL_PLANE_MACHINE_SECRET_FILE;
      const stop = startDeploymentReporter(coordinator, tenantId);
      await new Promise((done) => setTimeout(done, 15));
      await stop();
      expect((await coordinator.query('SELECT 1 AS alive')).rows[0].alive).toBe(1);
    } finally {
      if (origin) process.env.CONTROL_PLANE_ORIGIN = origin;
      if (version) process.env.DMS_BUILD_VERSION = version;
      else delete process.env.DMS_BUILD_VERSION;
      if (customer) process.env.INSTALLATION_CUSTOMER_KEY = customer;
    }
  });
});
