// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: Uncached disposable orchestration; private fixture paths never enter Turbo task hashes.
// Restore the actual cutover archive into a disposable database with its original ownership/ACLs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import https from 'node:https';
import { join } from 'node:path';
import pg from 'pg';
import { parse } from 'yaml';
export async function verifyCutoverRestore({ environment, preparation, owner, invoke }) {
  const fixture = preparation.fixture,
    old = fixture.bundles[0],
    directory = fixture.runDirectory;
  const plan = JSON.parse(await readFile(join(directory, 'cutover-0/cutover.json'), 'utf8'));
  const backup = join(directory, 'cutover-0/backup');
  const provision = new URL(environment.PROVISION_DATABASE_URL),
    name = `module_restore_${randomUUID().replaceAll('-', '')}`;
  const root = new pg.Client({ connectionString: provision.href });
  await root.connect();
  await root.query(`CREATE DATABASE ${name}`);
  try {
    const hostUrl = new URL(provision);
    hostUrl.hostname = process.env.ONBOARDING_ARCHIVE_CONTAINER;
    hostUrl.port = '5432';
    hostUrl.pathname = `/${name}`;
    const pgFile = join(preparation.directory, 'restore-postgres.env');
    await writeFile(
      pgFile,
      Object.entries({
        PGHOST: hostUrl.hostname,
        PGPORT: hostUrl.port,
        PGDATABASE: name,
        PGUSER: hostUrl.username,
        PGPASSWORD: decodeURIComponent(hostUrl.password),
      })
        .map(([k, v]) => `${k}=${v}`)
        .join('\n'),
      { mode: 0o600 },
    );
    const pgImage = parse(await readFile('deploy/compose.local.yaml', 'utf8')).services.postgres
      .image;
    await invoke([
      'docker',
      'run',
      '--rm',
      '--network',
      preparation.network,
      '--env-file',
      pgFile,
      '--mount',
      `type=bind,source=${join(backup, 'database.dump')},target=/backup.dump,readonly`,
      pgImage,
      'pg_restore',
      '--exit-on-error',
      `--dbname=${name}`,
      '/backup.dump',
    ]);
    const runtime = { ...owner };
    for (const key of Object.keys(runtime)) {
      if (key.endsWith('DATABASE_URL')) {
        if (key === 'TURNSTILE_DATABASE_URL') {
          const url = new URL(runtime[key]);
          url.pathname = `/${name}`;
          runtime[key] = url.href;
        } else delete runtime[key];
      }
      if (key === 'NODE_OPTIONS' || key.endsWith('MACHINE_SECRET_FILE')) delete runtime[key];
    }
    const descriptor = join(preparation.directory, 'restore-release.json');
    await writeFile(descriptor, await readFile(join(old.directory, 'delivery.json')), {
      mode: 0o600,
    });
    runtime.TURNSTILE_MODULE_RELEASE_FILE = descriptor;
    runtime.TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE = join(
      preparation.directory,
      'independent-marker-missing',
    );
    const config = join(preparation.directory, 'restore-runtime.env');
    await writeFile(
      config,
      Object.entries(runtime)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n'),
      { mode: 0o600 },
    );
    const image = `sha256:${old.inventory.images.find((i) => i.role === 'turnstile-api').digest}`;
    const publicFiles = [
      descriptor,
      owner.TURNSTILE_MODULE_RELEASE_TRUST_FILE,
      owner.TURNSTILE_CONTROL_PLANE_VERIFICATION_KEYS_FILE,
      owner.NODE_EXTRA_CA_CERTS,
    ];
    const code = `import {createPool,withTenant} from './dist/infrastructure/database/postgres.js';import {deploymentPreflight} from './dist/modules/deployment/access.js';const pool=createPool(process.env.TURNSTILE_DATABASE_URL,1);try{const snapshot=await withTenant(pool,process.env.INSTALLATION_TENANT_ID,async db=>(await db.query('SELECT turnstile.deployment_read() AS snapshot')).rows[0].snapshot);const claims=JSON.parse(Buffer.from(snapshot.decision.accepted.token.split('.')[1],'base64url').toString('utf8'));if(claims.modulePolicy.active.profileDigest!==${JSON.stringify(old.inventory.profileDigest)}||claims.modulePolicy.desired.profileDigest!==${JSON.stringify(plan.target.profileDigest)}||snapshot.decision.minimumVersion!==2)throw new Error('Restored module context lost');let denied=false;try{await deploymentPreflight(pool,process.env.INSTALLATION_TENANT_ID,'full');}catch(error){denied=error.getStatus?.()===403;}if(!denied)throw new Error('Missing independent evidence reopened archive');console.log(JSON.stringify({closed:true,contextsRetained:true}));}finally{await pool.end();}`;
    const response = await invoke([
      'docker',
      'run',
      '--rm',
      '--network',
      preparation.network,
      '--env-file',
      config,
      ...publicFiles.flatMap((p) => ['--mount', `type=bind,source=${p},target=${p},readonly`]),
      image,
      'node',
      '--input-type=module',
      '-e',
      code,
    ]);
    assert.equal(JSON.parse(response).closed, true);
    // A restored credential cannot renew against current central evidence even while its old JWT is unexpired.
    const archived = JSON.parse(await readFile(join(backup, 'private-state/product.json'), 'utf8'));
    const ca = await readFile(owner.NODE_EXTRA_CA_CERTS);
    const status = await new Promise((done, reject) => {
      const url = new URL(`${archived.origin}/api/machine/v1/sync`);
      const request = https.request(
        url,
        {
          method: 'POST',
          ca,
          headers: {
            authorization: `Bearer ${archived.current.secret}`,
            'content-type': 'application/json',
          },
          lookup: (_h, _o, callback) => callback(null, [{ address: '127.0.0.1', family: 4 }]),
        },
        (response) => {
          response.resume();
          done(response.statusCode);
        },
      );
      request.on('error', reject);
      request.end(
        JSON.stringify({
          version: 2,
          reportId: randomUUID(),
          binding: archived.binding,
          epoch: archived.current.epoch,
          applied: null,
          installed: {
            catalogueDigest: old.inventory.catalogueDigest,
            profileDigest: old.inventory.profileDigest,
            releaseId: old.inventory.releaseId,
          },
        }),
      );
      request.setTimeout(10000, () => request.destroy(new Error('Central probe deadline')));
    });
    assert.equal(status, 401);
    console.log(
      'Actual product archive restore retained module active/desired/floor evidence, stayed closed without the independent marker, and could not renew retired credentials.',
    );
  } finally {
    await root.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await root.end();
  }
}
