import type { Pool, PoolClient } from 'pg';
import {
  assertDatabaseRole,
  assertRuntimeRole,
  createPool,
  withTenant,
} from '../../infrastructure/database/postgres.js';
import {
  type DeploymentMode,
  deploymentPreflight,
  requireDeployment,
} from '../deployment/access.js';
import { parseAuthorityEnvironment } from '../platform-auth/authority-configuration.js';
import { createAuthority } from '../platform-auth/authority-instance.js';
import { createRecoveryDelivery } from '../platform-auth/recovery-delivery.js';
import { bindPrincipal, type DmsTransaction, type OperatorContext } from './resource-policy.js';

// Proof stays within this callback and expires with the command; cookies are never accepted input.
export async function withFreshOperatorIdentity<T>(
  environment: NodeJS.ProcessEnv,
  credentials: { operatorEmail: string; operatorPassword: string },
  work: (identity: {
    subjectId: string;
    admin: boolean;
    authPool: Pool;
    config: ReturnType<typeof parseAuthorityEnvironment>;
  }) => Promise<T>,
) {
  const config = parseAuthorityEnvironment(environment);
  const authPool = createPool(config.AUTH_DATABASE_URL, 1);
  const auth = createAuthority(config, authPool, createRecoveryDelivery(config));
  let headers: Headers | undefined;
  try {
    await assertRuntimeRole(authPool, 'auth');
    const login = await auth.api.signInEmail({
      body: { email: credentials.operatorEmail, password: credentials.operatorPassword },
      headers: new Headers({ origin: config.AUTH_PUBLIC_ORIGIN }),
      returnHeaders: true,
    });
    headers = new Headers({
      origin: config.AUTH_PUBLIC_ORIGIN,
      cookie: login.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; '),
    });
    const session = await auth.api.getSession({ headers });
    if (
      !session?.user.emailVerified ||
      session.user.banned ||
      Date.now() - new Date(session.session.createdAt).getTime() > 60000
    )
      throw new Error('Fresh verified authority proof required');
    return await work({
      subjectId: session.user.id,
      admin: session.user.role === 'admin',
      authPool,
      config,
    });
  } finally {
    try {
      if (headers) await auth.api.signOut({ headers });
    } finally {
      await authPool.end();
    }
  }
}

export async function withOperatorRead<T>(
  environment: NodeJS.ProcessEnv,
  tenantId: string,
  customerKey: string,
  subjectId: string,
  work: (transaction: DmsTransaction<OperatorContext>) => Promise<T>,
  deployment: DeploymentMode = 'read',
) {
  const url = environment.DMS_OPERATOR_DATABASE_URL;
  if (!url) throw new Error('Private operator database authority required');
  const pool = createPool(url, 1);
  try {
    await assertDatabaseRole(pool, 'thaarei_dms_operator', 'dms');
    const installation = (
      await pool.query('SELECT tenant_id,customer_key FROM dms.installation WHERE singleton=1')
    ).rows[0];
    if (installation?.tenant_id !== tenantId || installation.customer_key !== customerKey)
      throw new Error('Installation mismatch');
    await deploymentPreflight(pool, tenantId, deployment);
    return await withTenant(pool, tenantId, async (client) => {
      // Shared command fence serializes inspection with supported grant/revoke commands.
      await client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [
        `dms-operator:${tenantId}`,
      ]);
      const { rows } = await client.query(
        'SELECT tenant_id,customer_key FROM dms.installation WHERE singleton=1',
      );
      if (rows[0]?.tenant_id !== tenantId || rows[0]?.customer_key !== customerKey)
        throw new Error('Installation mismatch');
      const context: OperatorContext = { kind: 'operator', tenantId, subjectId };
      await bindPrincipal(client, context);
      await requireOperatorGrant(client, subjectId);
      await requireDeployment(client, deployment);
      return work({ client, context });
    });
  } finally {
    await pool.end();
  }
}
export async function requireOperatorGrant(client: PoolClient, subjectId: string) {
  const { rowCount } = await client.query(
    'SELECT subject_id FROM dms.operator_authorization WHERE subject_id=$1 AND revoked_at IS NULL',
    [subjectId],
  );
  if (!rowCount) throw new Error('Active DMS operator authorization required');
}
