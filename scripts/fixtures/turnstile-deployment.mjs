import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportPKCS8, exportSPKI, generateKeyPair, SignJWT } from 'jose';
import pg from 'pg';
import {
  applyDecision,
  initialDecisionState,
} from '../../packages/deployment-control/dist/index.js';
// Disposable fixture only: seed a genuine signed decision through the owning DMS migrator.
// Public APIs still execute the production verifier and all local resource/consumer policy.
export async function seedTurnstileDeployment(env) {
  const directory = await mkdtemp(join(tmpdir(), 'thaarei-turnstile-trust-'));
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const epoch = randomUUID();
  const trust = {
    version: 1,
    revision: 1,
    issuer: 'https://central.fixture.test',
    keys: [
      { kid: 'fixture', pem: await exportSPKI(publicKey), status: 'active', lastIssuedAt: null },
    ],
  };
  const marker = randomBytes(36).toString('base64url');
  env.TURNSTILE_CONTROL_PLANE_ORIGIN = trust.issuer;
  env.TURNSTILE_CONTROL_PLANE_VERIFICATION_KEYS_FILE = join(directory, 'trust.json');
  env.TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE = join(directory, 'marker');
  await writeFile(env.TURNSTILE_CONTROL_PLANE_VERIFICATION_KEYS_FILE, JSON.stringify(trust), {
    mode: 0o600,
  });
  await writeFile(env.TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE, marker, { mode: 0o600 });
  const pool = new pg.Pool({ connectionString: env.TURNSTILE_MIGRATION_DATABASE_URL, max: 1 });
  try {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query("SELECT set_config('app.tenant_id',$1,true)", [env.INSTALLATION_TENANT_ID]);
      const row = (await db.query('SELECT local_installation_id FROM turnstile.deployment_control'))
        .rows[0];
      const binding = {
        clientId: randomUUID(),
        installationId: randomUUID(),
        productId: randomUUID(),
        localInstallationId: row.local_installation_id,
        tenantId: env.INSTALLATION_TENANT_ID,
        product: 'turnstile',
        applicationId: env.TURNSTILE_APPLICATION_ID,
      };
      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({
        version: 1,
        iss: trust.issuer,
        aud: `urn:thaarei:deployment:${binding.productId}`,
        binding,
        epoch,
        policyRevision: 1,
        decisionSequence: 1,
        decisionId: randomUUID(),
        iat: now,
        nbf: now,
        exp: now + 604800,
        state: 'approved',
        entitlement: 'product-business',
      })
        .setProtectedHeader({ alg: 'RS256', typ: 'thaarei-deployment+jwt', kid: 'fixture' })
        .sign(privateKey);
      const state = await applyDecision(initialDecisionState(epoch), token, binding, trust, now);
      await db.query(
        'UPDATE turnstile.deployment_control SET binding=$1,decision=$2,marker_digest=$3,quarantined=false',
        [
          JSON.stringify(binding),
          JSON.stringify(state),
          createHash('sha256').update(marker).digest('hex'),
        ],
      );
      await db.query('COMMIT');
    } finally {
      db.release();
    }
  } finally {
    await pool.end();
  }
  env.TURNSTILE_DEPLOYMENT_FIXTURE_FILE = join(directory, 'private-signer.json');
  await writeFile(
    env.TURNSTILE_DEPLOYMENT_FIXTURE_FILE,
    JSON.stringify({ privateKey: await exportPKCS8(privateKey), trust }),
    { mode: 0o600 },
  );
  return directory;
}
