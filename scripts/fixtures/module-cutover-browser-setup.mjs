// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: Uncached disposable orchestration; private fixture paths never enter Turbo task hashes.
// Disposable customer setup; only this initial fixture bridge replaces its earlier v1
// seed. Actual pairing, approval and every subsequent cutover use production commands.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import pg from 'pg';
export async function prepareCutoverBrowser(environment, network) {
  const control = JSON.parse(await readFile(process.env.MOD_I08_CONTROL_FILE, 'utf8'));
  const rpc = async (input) => {
    const r = await fetch(control.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(60000),
    });
    assert.equal(r.status, 200, 'Private central fixture operation failed');
    return r.json();
  };
  const fixture = JSON.parse(await readFile(process.env.MOD_I08_SELECTED_FIXTURE, 'utf8'));
  const pool = new pg.Pool({
    connectionString: environment.TURNSTILE_MIGRATION_DATABASE_URL,
    max: 1,
  });
  const db = await pool.connect();
  let local;
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.tenant_id',$1,true)", [
      environment.INSTALLATION_TENANT_ID,
    ]);
    local = (await db.query('SELECT local_installation_id FROM turnstile.deployment_control'))
      .rows[0].local_installation_id;
    await db.query(
      'UPDATE turnstile.deployment_control SET binding=NULL,decision=NULL,quarantined=false',
    );
    await db.query('UPDATE turnstile.deployment_clock_state SET quarantined=false');
    await db.query('COMMIT');
  } finally {
    db.release();
    await pool.end();
  }
  const setup = await rpc({
    action: 'initialize',
    network,
    localInstallationId: local,
    tenantId: environment.INSTALLATION_TENANT_ID,
    applicationId: environment.TURNSTILE_APPLICATION_ID,
  });
  const directory = dirname(environment.TURNSTILE_DEPLOYMENT_FIXTURE_FILE),
    privateDirectory = join(directory, 'paired');
  await mkdir(privateDirectory, { mode: 0o700 });
  const release = JSON.parse(
    await readFile(join(fixture.bundles[0].directory, 'delivery.json'), 'utf8'),
  );
  Object.assign(environment, {
    TURNSTILE_CONTROL_PLANE_ORIGIN: setup.pairing.origin,
    TURNSTILE_CONTROL_PLANE_MACHINE_SECRET_FILE: join(privateDirectory, 'product.json'),
    TURNSTILE_MODULE_RELEASE_FILE: join(directory, 'module-release.json'),
    TURNSTILE_MODULE_RELEASE_TRUST_FILE: join(directory, 'module-release-trust.json'),
  });
  await writeFile(
    environment.TURNSTILE_CONTROL_PLANE_VERIFICATION_KEYS_FILE,
    JSON.stringify(setup.publicTrust),
    { mode: 0o600 },
  );
  await writeFile(environment.TURNSTILE_MODULE_RELEASE_FILE, JSON.stringify(release), {
    mode: 0o600,
  });
  await writeFile(
    environment.TURNSTILE_MODULE_RELEASE_TRUST_FILE,
    JSON.stringify({
      version: 1,
      revision: 2,
      issuer: fixture.releaseTrust.issuer,
      keys: fixture.releaseTrust.keys.map((k) => ({
        kid: k.kid,
        pem: k.publicKey,
        status: 'active',
        lastIssuedAt: null,
      })),
    }),
    { mode: 0o600 },
  );
  const ca = join(directory, 'combined-ca.pem');
  await writeFile(ca, `${await readFile(environment.NODE_EXTRA_CA_CERTS, 'utf8')}\n${setup.ca}`, {
    mode: 0o600,
  });
  environment.NODE_EXTRA_CA_CERTS = ca;
  const pairingFile = join(directory, 'pairing.json');
  await writeFile(pairingFile, JSON.stringify(setup.pairing), { mode: 0o600 });
  return {
    fixture,
    rpc,
    privateDirectory,
    directory,
    pairingFile,
    marker: environment.TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE,
    centralIngress: setup.centralIngress,
    nonce: randomBytes(8).toString('hex'),
  };
}
