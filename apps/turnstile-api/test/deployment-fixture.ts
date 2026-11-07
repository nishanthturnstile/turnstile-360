import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { applyDecision, initialDecisionState } from '@thaarei/deployment-control';
import { importPKCS8, SignJWT } from 'jose';
import type { Pool } from 'pg';
import { withTenant } from '../src/infrastructure/database/postgres.js';
import { markerDigest } from '../src/modules/deployment/access.js';

// Only historical synthetic upgrade databases use this deployed pre-control-plane contract.
export async function historicalInstallation(pool: Pool, environment: NodeJS.ProcessEnv) {
  if (
    environment.AUTH_PROFILE !== 'test' ||
    environment.INSTALLATION_CUSTOMER_KEY !== 'auth-fixture'
  )
    throw new Error('Disposable harness required');
  await pool.query(
    'INSERT INTO turnstile.installation(singleton,tenant_id,customer_key,application_id) VALUES(1,$1,$2,$3)',
    [
      environment.INSTALLATION_TENANT_ID,
      environment.INSTALLATION_CUSTOMER_KEY,
      environment.TURNSTILE_APPLICATION_ID,
    ],
  );
}
// Genuine signed proof via owning migrator; production admission/verifier still executes.
export async function approveUpgrade(pool: Pool, environment: NodeJS.ProcessEnv) {
  if (
    environment.AUTH_PROFILE !== 'test' ||
    environment.INSTALLATION_CUSTOMER_KEY !== 'auth-fixture'
  )
    throw new Error('Disposable harness required');
  const material = JSON.parse(
    await readFile(environment.TURNSTILE_DEPLOYMENT_FIXTURE_FILE as string, 'utf8'),
  );
  const key = await importPKCS8(material.privateKey, 'RS256');
  await withTenant(pool, environment.INSTALLATION_TENANT_ID as string, async (db) => {
    const row = (await db.query('SELECT local_installation_id FROM turnstile.deployment_control'))
      .rows[0];
    const binding = {
      clientId: randomUUID(),
      installationId: randomUUID(),
      productId: randomUUID(),
      localInstallationId: row.local_installation_id,
      tenantId: environment.INSTALLATION_TENANT_ID as string,
      product: 'turnstile' as const,
      applicationId: environment.TURNSTILE_APPLICATION_ID as string,
    };
    const epoch = randomUUID(),
      now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      version: 1,
      iss: material.trust.issuer,
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
      .sign(key);
    const state = await applyDecision(
      initialDecisionState(epoch),
      token,
      binding,
      material.trust,
      now,
    );
    await db.query(
      'UPDATE turnstile.deployment_control SET binding=$1,decision=$2,marker_digest=$3',
      [JSON.stringify(binding), JSON.stringify(state), await markerDigest()],
    );
  });
}
