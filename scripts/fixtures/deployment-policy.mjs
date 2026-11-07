import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { exportSPKI, generateKeyPair, importPKCS8, SignJWT } from 'jose';
import pg from 'pg';
import {
  applyDecision,
  initialDecisionState,
} from '../../packages/deployment-control/dist/index.js';
// Owning migrators and genuine JOSE proofs only in an explicitly disposable harness.
export async function fixturePolicy(product, environment = process.env) {
  assert.equal(environment.INSTALLATION_CUSTOMER_KEY, 'auth-fixture');
  assert.ok(['dms', 'turnstile'].includes(product));
  const prefix = product.toUpperCase();
  const material = JSON.parse(
    await readFile(environment[`${prefix}_DEPLOYMENT_FIXTURE_FILE`], 'utf8'),
  );
  let key = await importPKCS8(material.privateKey, 'RS256');
  let kid = 'fixture';
  const trustFile =
    environment[
      product === 'dms'
        ? 'CONTROL_PLANE_VERIFICATION_KEYS_FILE'
        : 'TURNSTILE_CONTROL_PLANE_VERIFICATION_KEYS_FILE'
    ];
  const savedTrust = await readFile(trustFile, 'utf8');
  const pool = new pg.Pool({
    connectionString: environment[`${prefix}_MIGRATION_DATABASE_URL`],
    max: 1,
  });
  const run = async (work) => {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query("SELECT set_config('app.tenant_id',$1,true)", [
        environment.INSTALLATION_TENANT_ID,
      ]);
      const result = await work(db);
      await db.query('COMMIT');
      return result;
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    } finally {
      db.release();
    }
  };
  const saved = await run(
    async (db) => (await db.query(`SELECT * FROM ${product}.deployment_control`)).rows[0],
  );
  let state = saved.decision,
    revision = 100,
    sequence = 100;
  return {
    proof: () => state.accepted.token,
    async rollover() {
      const pair = await generateKeyPair('RS256', { extractable: true });
      key = pair.privateKey;
      kid = `browser-${randomUUID()}`;
      material.trust.revision++;
      material.trust.keys.push({
        kid,
        pem: await exportSPKI(pair.publicKey),
        status: 'active',
        lastIssuedAt: null,
      });
      await writeFile(trustFile, JSON.stringify(material.trust), { mode: 0o600 });
    },
    async revoke() {
      material.trust.revision++;
      material.trust.keys.find((value) => value.kid === kid).status = 'revoked';
      await writeFile(trustFile, JSON.stringify(material.trust), { mode: 0o600 });
    },
    async set(policy, { fresh = false, expired = false } = {}) {
      const now = Math.floor(Date.now() / 1000),
        iat = expired ? now - 604801 : now,
        epoch = fresh ? randomUUID() : state.epoch;
      const token = await new SignJWT({
        version: 1,
        iss: material.trust.issuer,
        aud: `urn:thaarei:deployment:${saved.binding.productId}`,
        binding: saved.binding,
        epoch,
        policyRevision: ++revision,
        decisionSequence: ++sequence,
        decisionId: randomUUID(),
        iat,
        nbf: iat,
        exp: iat + 604800,
        state: policy,
        ...(policy === 'approved' ? { entitlement: 'product-business' } : {}),
      })
        .setProtectedHeader({ alg: 'RS256', typ: 'thaarei-deployment+jwt', kid })
        .sign(key);
      state = await applyDecision(
        fresh ? initialDecisionState(epoch) : state,
        token,
        saved.binding,
        material.trust,
        expired ? iat + 1 : now,
      );
      await run(async (db) => {
        await db.query(
          `UPDATE ${product}.deployment_clock_state SET last_time=0,quarantined=false`,
        );
        await db.query(`UPDATE ${product}.deployment_control SET decision=$1,quarantined=false`, [
          JSON.stringify(state),
        ]);
      });
    },
    async restore() {
      try {
        await writeFile(trustFile, savedTrust, { mode: 0o600 });
        await run(async (db) => {
          await db.query(
            `UPDATE ${product}.deployment_clock_state SET last_time=0,quarantined=false`,
          );
          await db.query(`UPDATE ${product}.deployment_control SET decision=$1,quarantined=$2`, [
            JSON.stringify(saved.decision),
            saved.quarantined,
          ]);
        });
      } finally {
        await pool.end();
      }
    },
  };
}
