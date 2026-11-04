import { randomBytes } from 'node:crypto';
import type { PeoplePermission } from '@thaarei/turnstile-contracts';
import type { Pool } from 'pg';
import { withTenant } from '../src/infrastructure/database/postgres.js';
import type { EffectiveAccess } from '../src/modules/access/access-evaluator.js';
import { accessOperator } from '../src/modules/access/access-operator.js';
import { ACCESS_TABLES } from '../src/modules/access/access-safety.js';
import { invitationRecoveryEpoch } from '../src/modules/access/release-state.js';
import { setUserAccess } from '../src/modules/auth/set-user-access.js';
import { configurationOperator } from '../src/modules/organization/configuration-operator.js';

// Owning service tests can seed capability state; complete-chain browser/release
// tests use the real operator and a live signed administrator login instead.
export async function openAccessFixture(owner: Pool) {
  if (
    process.env.AUTH_PROFILE !== 'test' ||
    !['/auth_fixture', '/onboarding_upgrade'].includes(
      new URL(process.env.PROVISION_DATABASE_URL as string).pathname,
    )
  )
    throw new Error('Disposable fixture required');
  process.env.TURNSTILE_INVITATION_RECOVERY_EPOCH ??= randomBytes(32).toString('base64url');
  const tenant = process.env.INSTALLATION_TENANT_ID as string;
  await withTenant(owner, tenant, async (db) => {
    await db.query(
      `UPDATE turnstile.access_context SET public_writes_enabled=true,
      release_id=$2,recovery_epoch=$3,released_by='fixture-operator',released_at=statement_timestamp(),revision=revision+1
      WHERE tenant_id=$1`,
      [tenant, 'a'.repeat(64), invitationRecoveryEpoch()],
    );
  });
}

// pg-pool.end() can resolve before idle clients emit their close/remove events.
// Wait for the public removal event before dropping an isolated database.
export async function closeFixturePool(pool: Pool | undefined, shutdown?: () => Promise<void>) {
  if (!pool) return;
  const expected = pool.totalCount;
  let removed = 0;
  let resolveDrained = () => {};
  const drained = expected
    ? new Promise<void>((resolve) => {
        resolveDrained = resolve;
      })
    : Promise.resolve();
  const onRemove = () => {
    if (++removed >= expected) resolveDrained();
  };
  pool.on('remove', onRemove);
  try {
    await (shutdown ? shutdown() : pool.end());
    await drained;
  } finally {
    pool.off('remove', onRemove);
  }
}

// Disposable harness only. These resets never substitute for a deployment import.
export async function resetAccessFixture(
  owner: Pool,
  users: readonly { userId: string; permissions: string[] }[] = [],
  leaveConfigurationAbsent = false,
) {
  if (
    process.env.AUTH_PROFILE !== 'test' ||
    !['/auth_fixture', '/onboarding_upgrade'].includes(
      new URL(process.env.PROVISION_DATABASE_URL as string).pathname,
    )
  )
    throw new Error('Disposable fixture required');
  await owner.query(
    `TRUNCATE ${ACCESS_TABLES.map((table) => `turnstile.${table}`).join(',')},turnstile.user_access,turnstile.organization_configuration CASCADE`,
  );
  const operator = { operatorId: 'canonical-fixture' };
  await configurationOperator('initialize', operator);
  await accessOperator('initialize', operator);
  for (const user of users) await setUserAccess({ ...operator, ...user, enabled: true });
  // Start the scenario after synthetic grant setup, with its own audit assertions.
  await owner.query('TRUNCATE turnstile.access_audit');
  if (leaveConfigurationAbsent)
    await owner.query('TRUNCATE turnstile.organization_configuration CASCADE');
}

export function policyFixtureAccess(permissions: readonly PeoplePermission[]): EffectiveAccess {
  return {
    memberId: '20000000-0000-4000-8000-000000000001',
    memberVersion: 1,
    status: 'active',
    workspaceComplete: true,
    protectedAdministrator: false,
    units: new Map(),
    context: {
      catalogVersion: 1,
      accessRevision: 1,
      fingerprint: '0'.repeat(64),
      grants: [
        {
          sourceId: '20000000-0000-4000-8000-000000000002',
          permissions: [...permissions],
          scope: { kind: 'company' },
        },
      ],
    },
  };
}
