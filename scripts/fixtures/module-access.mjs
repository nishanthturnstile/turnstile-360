// Private disposable fixture: signs real decisions; all image guards/verifiers remain production code.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { decodeJwt, importPKCS8, SignJWT } from 'jose';
import pg from 'pg';
import {
  applyDecision,
  verifyInstalledModuleRelease,
} from '../../packages/deployment-control/dist/index.js';

export async function prepareModuleAccess(env) {
  assert.equal(env.INSTALLATION_CUSTOMER_KEY, 'auth-fixture');
  const fixture = JSON.parse(await readFile(env.MOD_I07_MODULE_FIXTURE, 'utf8'));
  const descriptor = JSON.parse(
    await readFile(join(fixture.bundleDirectory, 'delivery.json'), 'utf8'),
  );
  const directory = dirname(env.TURNSTILE_DEPLOYMENT_FIXTURE_FILE);
  const trust = {
    version: 1,
    revision: 1,
    issuer: fixture.releaseTrust.issuer,
    keys: fixture.releaseTrust.keys.map((k) => ({
      kid: k.kid,
      pem: k.publicKey,
      status: 'active',
      lastIssuedAt: null,
    })),
  };
  env.TURNSTILE_MODULE_RELEASE_FILE = join(directory, 'module-release.json');
  env.TURNSTILE_MODULE_RELEASE_TRUST_FILE = join(directory, 'release-trust.json');
  await writeFile(env.TURNSTILE_MODULE_RELEASE_FILE, JSON.stringify(descriptor), { mode: 0o600 });
  await writeFile(env.TURNSTILE_MODULE_RELEASE_TRUST_FILE, JSON.stringify(trust), { mode: 0o600 });
  const release = await verifyInstalledModuleRelease(
    descriptor.attestation,
    descriptor.request,
    descriptor.request.profile,
    trust,
    Math.floor(Date.now() / 1000),
  );
  const change = async (product, state, ids, expiresIn = 604800) => {
    const material = JSON.parse(
      await readFile(
        env[
          product === 'turnstile'
            ? 'TURNSTILE_DEPLOYMENT_FIXTURE_FILE'
            : 'DMS_DEPLOYMENT_FIXTURE_FILE'
        ],
        'utf8',
      ),
    );
    const pool = new pg.Pool({
      connectionString:
        env[
          product === 'turnstile'
            ? 'TURNSTILE_MIGRATION_DATABASE_URL'
            : 'DMS_MIGRATION_DATABASE_URL'
        ],
      max: 1,
    });
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query("SELECT set_config('app.tenant_id',$1,true)", [env.INSTALLATION_TENANT_ID]);
      const row = (
        await db.query(`SELECT binding,decision FROM ${product}.deployment_control FOR UPDATE`)
      ).rows[0];
      const previous = decodeJwt(row.decision.accepted.token),
        now = Math.floor(Date.now() / 1000),
        revision = previous.policyRevision + 1;
      const active = {
        catalogueDigest: release.request.profile.catalogueDigest,
        profileDigest: release.request.profileDigest,
        releaseId: release.releaseId,
        assignmentRevision: 2,
        policyRevision: revision,
      };
      const claims = {
        version: product === 'turnstile' ? 2 : 1,
        iss: material.trust.issuer,
        aud: `urn:thaarei:deployment:${row.binding.productId}`,
        binding: row.binding,
        epoch: row.decision.epoch,
        policyRevision: revision,
        decisionSequence: previous.decisionSequence + 1,
        decisionId: randomUUID(),
        iat: now,
        nbf: now,
        exp: now + expiresIn,
        state,
        ...(state === 'approved' ? { entitlement: 'product-business' } : {}),
        ...(product === 'turnstile' && state === 'approved'
          ? {
              modulePolicy: {
                active,
                desired: {
                  catalogueDigest: active.catalogueDigest,
                  profileDigest: active.profileDigest,
                  assignmentRevision: 2,
                },
                changeAssignmentRevision: 2,
                allowedModuleIds: ids ?? release.request.profile.modules.map((m) => m.id),
              },
            }
          : {}),
      };
      const token = await new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', typ: 'thaarei-deployment+jwt', kid: 'fixture' })
        .sign(await importPKCS8(material.privateKey, 'RS256'));
      const next = await applyDecision(
        row.decision,
        token,
        row.binding,
        material.trust,
        now,
        product === 'turnstile' ? release : undefined,
      );
      await db.query(`UPDATE ${product}.deployment_control SET decision=$1`, [
        JSON.stringify(next),
      ]);
      await db.query('COMMIT');
    } finally {
      db.release();
      await pool.end();
    }
  };
  await change('turnstile', 'approved');
  return { request: release.request, releaseId: release.releaseId, change };
}
