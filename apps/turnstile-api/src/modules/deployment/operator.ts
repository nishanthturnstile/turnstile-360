import { lstat, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { pairingFile } from '@thaarei/control-plane-contracts';
import {
  DeploymentClient,
  exportLocalManifest,
  httpsTransport,
  moduleCutoverIntent,
  readProtectedTrust,
  verifyModuleDecision,
} from '@thaarei/deployment-control';
import { z } from 'zod';
import { createPool, withTenant } from '../../infrastructure/database/postgres.js';
import { deploymentPreflight } from './access.js';
import { TurnstileDeploymentStore } from './store.js';

async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 4096) throw new Error('Bounded input required');
  }
  const command = z
    .object({
      action: z.enum([
        'manifest',
        'setup',
        'rebind',
        'sync',
        'rotate',
        'prepare-cutover',
        'quarantine-cutover',
        'verify-cutover',
      ]),
      cutover: moduleCutoverIntent.optional(),
      pairingFile: z.string().optional(),
      outputFile: z.string().optional(),
      environment: z.string().default('production'),
      buildVersion: z.string().default(process.env.TURNSTILE_BUILD_VERSION ?? 'development'),
    })
    .strict()
    .parse(JSON.parse(input));
  const tenantId = z.uuid().parse(process.env.INSTALLATION_TENANT_ID);
  const pool = createPool(z.string().url().parse(process.env.TURNSTILE_REPORTER_DATABASE_URL), 3);
  try {
    if (
      (await pool.query('SELECT current_user AS role')).rows[0]?.role !==
      'thaarei_turnstile_reporter'
    )
      throw new Error('Dedicated reporter role required');
    const local = await withTenant(pool, tenantId, async (db) => {
      const row = (
        await db.query(
          'SELECT c.local_installation_id,i.customer_key,i.application_id FROM turnstile.deployment_control c JOIN turnstile.installation i ON i.tenant_id=c.tenant_id',
        )
      ).rows[0];
      if (
        !row ||
        row.customer_key !== process.env.INSTALLATION_CUSTOMER_KEY ||
        row.application_id !== process.env.TURNSTILE_APPLICATION_ID
      )
        throw new Error('Bootstrap installation identity first');
      return row.local_installation_id;
    });
    if (command.action === 'manifest') {
      if (!command.outputFile || !isAbsolute(command.outputFile))
        throw new Error('Absolute output required');
      await writeFile(
        command.outputFile,
        JSON.stringify(
          exportLocalManifest({
            version: 1,
            localInstallationId: local,
            tenantId,
            product: 'turnstile',
            applicationId: z.uuid().parse(process.env.TURNSTILE_APPLICATION_ID),
            environment: command.environment,
            buildVersion: command.buildVersion,
          }),
          null,
          2,
        ),
        { mode: 0o600, flag: 'wx' },
      );
      return;
    }
    const secret = z.string().parse(process.env.TURNSTILE_CONTROL_PLANE_MACHINE_SECRET_FILE),
      marker = z.string().parse(process.env.TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE),
      origin = z.string().parse(process.env.TURNSTILE_CONTROL_PLANE_ORIGIN),
      keys = z.string().parse(process.env.TURNSTILE_CONTROL_PLANE_VERIFICATION_KEYS_FILE);
    if (secret !== `${dirname(secret)}/product.json`)
      throw new Error('Protected product.json required');
    const store = new TurnstileDeploymentStore(
      dirname(secret),
      marker,
      pool,
      tenantId,
      command.action === 'rebind',
    );
    const client = new DeploymentClient(store, httpsTransport(origin), () =>
      readProtectedTrust(keys),
    );
    if (['prepare-cutover', 'quarantine-cutover', 'verify-cutover'].includes(command.action)) {
      const intent = command.cutover;
      if (!intent) throw new Error('Reviewed cutover context required');
      if (command.action === 'verify-cutover') await deploymentPreflight(pool, tenantId, 'full');
      await store.locked(async () => {
        const value = await store.load(),
          release = await store.moduleRelease();
        const pending = await withTenant(
          pool,
          tenantId,
          async (db) =>
            (await db.query('SELECT credential_metadata FROM turnstile.deployment_control')).rows[0]
              ?.credential_metadata?.report,
        );
        if (pending) throw new Error('Reconcile the scheduled report journal before cutover');
        if (
          !value?.decision?.accepted ||
          !value.current ||
          !release ||
          value.operation ||
          value.report
        )
          throw new Error('Reconcile pending deployment operations before cutover');
        const claims = await verifyModuleDecision(
          value.decision.accepted.token,
          value.binding,
          value.current.epoch,
          await readProtectedTrust(keys),
          Math.floor(Date.now() / 1000),
          release,
        );
        if (
          claims.state !== 'approved' ||
          claims.modulePolicy.desired.catalogueDigest !== intent.target.catalogueDigest ||
          claims.modulePolicy.desired.profileDigest !== intent.target.profileDigest ||
          claims.modulePolicy.desired.assignmentRevision !== intent.desiredRevision
        )
          throw new Error('Current desired profile changed or lacks authority');
        if (command.action === 'verify-cutover') {
          if (
            value.decision.quarantined ||
            claims.policyRevision <= intent.policyRevision ||
            claims.modulePolicy.active.assignmentRevision !== intent.desiredRevision ||
            Object.entries(intent.target).some(
              ([key, id]) =>
                claims.modulePolicy.active[key as keyof typeof claims.modulePolicy.active] !== id,
            ) ||
            claims.modulePolicy.allowedModuleIds.length !==
              release.request.profile.modules.length ||
            release.request.profile.modules.some(
              (m) => !claims.modulePolicy.allowedModuleIds.includes(m.id),
            )
          )
            throw new Error('Current reviewed target activation required');
        } else {
          if (claims.policyRevision !== intent.policyRevision)
            throw new Error('Cutover policy basis changed');
          if (command.action === 'quarantine-cutover') {
            value.decision.quarantined = true;
            await store.save(value);
          } else if (value.decision.quarantined)
            throw new Error('Existing recovery quarantine requires reviewed reconciliation');
        }
        console.log(
          JSON.stringify({
            version: 1,
            requestId: intent.requestId,
            binding: value.binding,
            epoch: value.current.epoch,
            active: claims.modulePolicy.active,
            desired: claims.modulePolicy.desired,
            quarantined: command.action === 'quarantine-cutover' || value.decision.quarantined,
          }),
        );
      });
      return;
    }
    if (command.action === 'setup' || command.action === 'rebind') {
      if (!command.pairingFile) throw new Error('Private pairing file required');
      const info = await lstat(command.pairingFile);
      if (!info.isFile() || info.mode & 0o077 || info.size > 16384)
        throw new Error('Protected pairing file required');
      const file = pairingFile.parse(JSON.parse(await readFile(command.pairingFile, 'utf8')));
      if (
        file.binding.product !== 'turnstile' ||
        file.binding.applicationId !== process.env.TURNSTILE_APPLICATION_ID ||
        file.binding.tenantId !== tenantId ||
        file.binding.localInstallationId !== local ||
        file.origin !== origin
      )
        throw new Error('Exact installation binding required');
      if (
        (process.env.TURNSTILE_CONTROL_PLANE_INSTALLATION_ID &&
          file.binding.installationId !== process.env.TURNSTILE_CONTROL_PLANE_INSTALLATION_ID) ||
        (process.env.TURNSTILE_CONTROL_PLANE_PRODUCT_ID &&
          file.binding.productId !== process.env.TURNSTILE_CONTROL_PLANE_PRODUCT_ID)
      )
        throw new Error('Expected central binding mismatch');
      await client.setup(file, command.action === 'rebind');
    } else if (command.action === 'rotate') await client.rotate();
    else await client.sync();
  } finally {
    await pool.end();
  }
}
main()
  .then(() => console.log('Private DMS deployment operation completed.'))
  .catch(() => {
    console.error(
      'Private deployment operation failed; preserve the durable journal and reconcile before retrying.',
    );
    process.exitCode = 1;
  });
