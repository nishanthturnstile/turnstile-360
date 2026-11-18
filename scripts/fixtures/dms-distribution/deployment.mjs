import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { applyDecision, initialDecisionState } from '@thaarei/deployment-control';
import { exportSPKI, generateKeyPair, SignJWT } from 'jose';
import pg from 'pg';

// Disposable fixture only: seed a genuine signed decision through the owning DMS migrator.
// Public APIs still execute the production verifier and all local resource/consumer policy.
async function approve(env) {
  if (!env.INSTALLATION_CUSTOMER_KEY?.startsWith('qualification-'))
    throw new Error('Disposable distribution fixture required');
  const directory = '/configuration/deploy/qualification/policy';
  await mkdir(directory, { recursive: true, mode: 0o700 });
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
  env.CONTROL_PLANE_ORIGIN = trust.issuer;
  env.CONTROL_PLANE_VERIFICATION_KEYS_FILE = join(directory, 'trust.json');
  env.CONTROL_PLANE_RECOVERY_MARKER_FILE = join(directory, 'marker');
  await writeFile(env.CONTROL_PLANE_VERIFICATION_KEYS_FILE, JSON.stringify(trust), { mode: 0o600 });
  await writeFile(env.CONTROL_PLANE_RECOVERY_MARKER_FILE, marker, { mode: 0o600 });
  const pool = new pg.Pool({ connectionString: env.DMS_MIGRATION_DATABASE_URL, max: 1 });
  try {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query("SELECT set_config('app.tenant_id',$1,true)", [env.INSTALLATION_TENANT_ID]);
      const row = (await db.query('SELECT local_installation_id FROM dms.deployment_control'))
        .rows[0];
      const binding = {
        clientId: randomUUID(),
        installationId: randomUUID(),
        productId: randomUUID(),
        localInstallationId: row.local_installation_id,
        tenantId: env.INSTALLATION_TENANT_ID,
        product: 'dms',
        applicationId: null,
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
        'UPDATE dms.deployment_control SET binding=$1,decision=$2,marker_digest=$3,quarantined=false',
        [
          JSON.stringify(binding),
          JSON.stringify(state),
          createHash('sha256').update(marker).digest('hex'),
        ],
      );
      await db.query('UPDATE dms.deployment_clock_state SET last_time=0,quarantined=false');
      await db.query('COMMIT');
    } finally {
      db.release();
    }
  } finally {
    await pool.end();
  }
  return directory;
}

process.loadEnvFile('/configuration/.env.dms-maintenance');
await approve(process.env);
console.log('Disposable signed deployment approval installed through owning migrator');
