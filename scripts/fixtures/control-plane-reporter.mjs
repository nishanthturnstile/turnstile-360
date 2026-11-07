import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

// Starts the shipped worker entrypoint. Owning SQL verifies completion; a healthy container alone is insufficient.
export async function verifyContainerReporter({
  product,
  image,
  config,
  temporary,
  network,
  postgres,
  run,
  completed,
}) {
  const prefix = product === 'dms' ? 'CONTROL_PLANE' : 'TURNSTILE_CONTROL_PLANE';
  const runtime = Object.fromEntries(
    Object.entries(config).filter(
      ([key]) =>
        /^(INSTALLATION_|TURNSTILE_|CONTROL_PLANE_|DMS_|NODE_EXTRA_CA_CERTS$)/.test(key) &&
        !key.includes('MIGRATION_') &&
        !key.endsWith('_FIXTURE_FILE') &&
        !key.endsWith('_DATABASE_URL'),
    ),
  );
  const databaseKey =
    product === 'dms' ? 'DMS_COORDINATOR_DATABASE_URL' : 'TURNSTILE_REPORTER_DATABASE_URL';
  const databaseUrl = new URL(config[databaseKey]);
  databaseUrl.host = `${postgres}:5432`;
  runtime[databaseKey] = databaseUrl.href;
  runtime[`${prefix}_MACHINE_SECRET_FILE`] = '/run/private/product.json';
  runtime[`${prefix}_RECOVERY_MARKER_FILE`] = '/run/recovery-marker';
  runtime[`${prefix}_VERIFICATION_KEYS_FILE`] = '/run/public-trust.json';
  runtime.NODE_EXTRA_CA_CERTS = '/run/ca.pem';
  if (product === 'dms')
    Object.assign(runtime, {
      DMS_WORK_ISSUER_URL: 'https://customer.fixture.test/identity',
      DMS_STORAGE_CAPACITY_PATH: '/tmp',
      DMS_SCRATCH_CAPACITY_PATH: '/tmp',
    });
  const file = join(temporary, `${product}-reporter.env`);
  await writeFile(
    file,
    Object.entries(runtime)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
    { mode: 0o600 },
  );
  const name = `${network}-${product}-reporter`;
  let created = false;
  try {
    await run('docker', [
      'run',
      '--detach',
      '--name',
      name,
      '--network',
      network,
      '--read-only',
      '--tmpfs',
      '/tmp',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--env-file',
      file,
      '--mount',
      `type=bind,source=${join(temporary, `${product}-private`)},target=/run/private,readonly`,
      '--mount',
      `type=bind,source=${config[`${prefix}_RECOVERY_MARKER_FILE`]},target=/run/recovery-marker,readonly`,
      '--mount',
      `type=bind,source=${config[`${prefix}_VERIFICATION_KEYS_FILE`]},target=/run/public-trust.json,readonly`,
      '--mount',
      `type=bind,source=${join(temporary, 'cert.pem')},target=/run/ca.pem,readonly`,
      image,
      'node',
      product === 'dms' ? 'dist/main.coordinator.js' : 'dist/main.reporter.js',
    ]);
    created = true;
    let complete = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await completed()) {
        complete = true;
        break;
      }
      await setTimeout(100);
    }
    assert.ok(complete, `${product} shipped reporter did not complete its HTTPS/SQL attempt`);
    await run('docker', ['stop', '--time', '15', name]);
    const state = JSON.parse(await run('docker', ['inspect', '--format', '{{json .State}}', name]));
    assert.equal(state.ExitCode, 0, `${product} shipped reporter must shut down cleanly`);
    assert.equal(state.OOMKilled, false);
    console.log(
      `Shipped ${product} reporter: canonical container HTTPS, owning SQL completion and graceful shutdown passed.`,
    );
  } finally {
    if (created) await run('docker', ['rm', '--force', name]);
  }
}
