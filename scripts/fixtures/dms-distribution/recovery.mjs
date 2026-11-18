import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Fixture S3 is deliberately marked non-off-host. It exercises transport/recovery,
// never attests physical host-loss survival or authorizes production disposal.
export async function qualifyRecovery({
  interruptCapture = false,
  root,
  install,
  bundle,
  network,
  state,
  run,
  compose,
  dms,
  driver,
  until,
}) {
  const suffix = randomBytes(5).toString('hex'),
    vault = `dms-i19-vault-${suffix}`,
    target = `thaarei-dms-recovered-${suffix}`;
  const keyFile = join(root, 'independent-recovery.key'),
    recovered = join(root, 'recovered');
  writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
  const accessKeyId = randomBytes(16).toString('hex'),
    secretAccessKey = randomBytes(32).toString('hex');
  const iam = join(root, 'vault-identities.json');
  writeFileSync(
    iam,
    JSON.stringify({
      identities: [
        {
          name: 'fixture-backup',
          credentials: [{ accessKey: accessKeyId, secretKey: secretAccessKey }],
          actions: ['Admin', 'Read', 'Write', 'List'],
        },
      ],
    }),
    { mode: 0o600 },
  );
  const storageImage = JSON.parse(readFileSync(join(install, 'RELEASE.json'), 'utf8')).version;
  const env = { ...process.env, DMS_BACKUP_KEY_FILE: keyFile, DMS_BACKUP_NETWORK: network };
  const input = { operatorEmail: state.operatorEmail, operatorPassword: state.operatorPassword };
  let targetStarted = false;
  let passed = false;
  const targetCompose = (args, options = {}) =>
    run(
      'docker',
      [
        'compose',
        '--project-directory',
        join(recovered, 'deploy'),
        '--env-file',
        '.env.dms.compose',
        '-f',
        'deploy/compose.dms-complete.yaml',
        ...args,
      ],
      { cwd: recovered, ...options },
    );
  const recover = (action, body, allowFailure = false) =>
    run('./dms', [action], {
      cwd: recovered,
      env: action === 'recovery-open' ? { ...env, DMS_BACKUP_KEY_FILE: '' } : env,
      input: body,
      allowFailure,
    });
  const targetDriver = (mode, allowFailure = false) =>
    targetCompose(
      [
        '--profile',
        'tools',
        'run',
        '--rm',
        '--no-deps',
        '-T',
        '--user',
        `${process.getuid()}:${process.getgid()}`,
        'dms-maintenance',
        '/fixture/driver.mjs',
        mode,
      ],
      { allowFailure },
    );
  const started = Date.now();
  try {
    await run('docker', ['volume', 'create', vault]);
    await run('docker', [
      'run',
      '-d',
      '--name',
      vault,
      '--network',
      network,
      '--mount',
      `type=bind,src=${iam},dst=/run/dms/storage-identities.json,readonly`,
      '--mount',
      `type=volume,src=${vault},dst=/data`,
      '--user',
      '0:0',
      '--env',
      'DMS_STORAGE_IDENTITY_FILE=/run/dms/storage-identities.json',
      `thaarei-dms-storage:${storageImage}`,
    ]);
    // Only fixture credentials are mounted; no secret enters argv or logs.
    const setup = join(install, '.recovery-vault-setup.json');
    writeFileSync(
      setup,
      JSON.stringify({
        endpoint: `http://${vault}:8333`,
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
        requestChecksumCalculation: 'WHEN_REQUIRED',
      }),
      { mode: 0o600 },
    );
    const script = join(install, 'deploy', 'qualification', 'vault-setup.mjs');
    writeFileSync(
      script,
      "import{readFileSync}from'node:fs';import{S3Client,CreateBucketCommand}from'/app/node_modules/@aws-sdk/client-s3/dist-cjs/index.js';const c=new S3Client(JSON.parse(readFileSync('/configuration/.recovery-vault-setup.json')));for(let n=0;;n++){try{await c.send(new CreateBucketCommand({Bucket:'dms-recovery'}));break}catch(e){if(n>60)throw new Error('Fixture vault unavailable');await new Promise(r=>setTimeout(r,1000))}}c.destroy();",
    );
    // Tool joins only the independently configured fixture vault network.
    await run('docker', [
      'run',
      '--rm',
      '--network',
      network,
      '--user',
      `${process.getuid()}:${process.getgid()}`,
      '--mount',
      `type=bind,src=${install},dst=/configuration`,
      `thaarei-dms-api:${storageImage}`,
      'node',
      '/configuration/deploy/qualification/vault-setup.mjs',
    ]);
    const config = {
      repository: {
        id: 'fixture-independent-vault',
        endpoint: `http://${vault}:8333`,
        bucket: 'dms-recovery',
        prefix: 'cohorts',
        region: 'us-east-1',
        accessKeyId,
        secretAccessKey,
        keyFile: '/run/recovery-key',
        offHostAttested: false,
        fixtureOnly: true,
      },
      retentionDays: 7,
    };
    writeFileSync(join(install, '.dms-backup.json'), JSON.stringify(config), { mode: 0o600 });
    await until('recovery-content', 180);
    await driver('recovery-history');
    await until('available', 180);
    await until('recovery-content', 180);
    await driver('recovery-reference');
    await until('available', 180);
    await until('recovery-content', 180);
    await compose(['stop', 'work-publisher', 'scan-worker', 'extract-worker', 'heavy-worker']);
    await driver('recovery-pending');
    await until('recovery-envelope', 60);
    if (interruptCapture) {
      let captureEnded = false;
      const interrupted = dms('backup', input, { env, allowFailure: true }).finally(() => {
        captureEnded = true;
      });
      let controller;
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline && !captureEnded) {
        // Only this installation's private controller is eligible for fault injection.
        const ids = (
          await run('docker', ['ps', '-q', '--filter', `ancestor=thaarei-dms-api:${storageImage}`])
        ).stdout
          .trim()
          .split('\n')
          .filter(Boolean);
        for (const id of ids) {
          const inspected = JSON.parse((await run('docker', ['inspect', id])).stdout)[0];
          if (
            inspected.Mounts.some(
              (m) => m.Destination === '/installation' && m.Source === install,
            ) &&
            inspected.Config.Cmd.at(-1) === 'capture'
          ) {
            const logs = (await run('docker', ['logs', '--tail', '12', id], { allowFailure: true }))
              .stdout;
            if (logs.includes('"phase":"basebackup"')) {
              controller = id;
              break;
            }
          }
        }
        if (controller) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      if (!controller) {
        await interrupted;
        throw new Error('Could not inject the bounded capture interruption');
      }
      await run('docker', ['kill', '--signal', 'KILL', controller]);
      assert.notEqual((await interrupted).status, 0);
      assert.ok(
        existsSync(join(install, '.dms-backup-fence.json')),
        'Interrupted capture lost its durable fence',
      );
      await dms('backup-release', {}, { env: { ...env, DMS_BACKUP_KEY_FILE: '' } });
      assert.equal(existsSync(join(install, '.dms-backup-fence.json')), false);
      rmSync(join(install, '.dms-backup-lock'), { recursive: true, force: true });
      await until('foundation', 60);
      await driver('refresh');
      await driver('available');
    }
    const backupStarted = Date.now();
    await dms('backup', input, { env });
    const backupCompletedAt = Date.now();
    const dirs = (await import('node:fs'))
      .readdirSync(join(install, '.dms-backups'))
      .filter((id) => existsSync(join(install, '.dms-backups', id, 'manifest.json')));
    assert.equal(dirs.length, 1);
    const backupId = dirs[0],
      manifest = JSON.parse(
        readFileSync(join(install, '.dms-backups', backupId, 'manifest.json'), 'utf8'),
      );
    assert.equal(manifest.confirmedOffHost, false);
    assert.ok(manifest.objectCount >= 2);
    await driver('refresh');
    await driver('available');
    await driver('recovery-content');
    // Source is recoverable and usable after the local capture; a later live edit
    // must not leak into the selected earlier cohort.
    await driver('recovery-mutate');
    await compose(['stop']);
    cpSync(bundle, recovered, { recursive: true, filter: (p) => !p.endsWith('/images.tar') });
    writeFileSync(join(recovered, '.dms-backup.json'), JSON.stringify(config), { mode: 0o600 });
    const request = { backupId, targetProject: target, ingressNetwork: network };
    const restoreStarted = Date.now();
    const correctKey = readFileSync(keyFile);
    writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
    assert.notEqual(
      (await recover('recovery-restore', request, true)).status,
      0,
      'Wrong-key recovery accepted',
    );
    assert.equal(
      existsSync(join(recovered, '.env.dms')),
      false,
      'Unauthenticated recovery imported configuration',
    );
    writeFileSync(keyFile, correctKey, { mode: 0o600 });
    correctKey.fill(0);
    rmSync(join(recovered, '.dms-restore'), { recursive: true, force: true });
    await recover('recovery-restore', request);
    targetStarted = true;
    assert.notEqual((await recover('up', {}, true)).status, 0, 'Unverified recovery opened');
    await recover('recovery-verify', { backupId });
    await recover('recovery-verify', { backupId }); // Interrupted verification is replayable.
    assert.notEqual(
      (await recover('recovery-open', { ...input, backupId, accessReviewed: false }, true)).status,
      0,
      'Missing access review accepted',
    );
    cpSync(join(install, '.qualification.json'), join(recovered, '.qualification.json'));
    await recover('recovery-open', { ...input, backupId, accessReviewed: true });
    await targetCompose(['--profile', 'tools', 'run', '--rm', '--no-deps', 'broker-init']);
    writeFileSync(
      join(recovered, 'deploy/qualification/policy/marker'),
      randomBytes(36).toString('base64url'),
      { mode: 0o600 },
    );
    await recover('up', {});
    const authDeadline = Date.now() + 120000;
    while ((await targetDriver('foundation', true)).status !== 0) {
      if (Date.now() > authDeadline) throw new Error('Restored authority unavailable');
      await new Promise((r) => setTimeout(r, 1000));
    }
    // Restore never opens business access using the backed-up deployment decision.
    // Issue a fresh genuine proof only after demonstrating denial on the restored API.
    await targetDriver('deployment-closed');
    await targetCompose([
      '--profile',
      'tools',
      'run',
      '--rm',
      '--no-deps',
      '-T',
      '--user',
      `${process.getuid()}:${process.getgid()}`,
      'dms-maintenance',
      '/app/qualification-deployment.mjs',
    ]);
    const deadline = Date.now() + 300000;
    while ((await targetDriver('ready', true)).status !== 0) {
      if (Date.now() > deadline) throw new Error('Restored services did not become ready');
      await new Promise((r) => setTimeout(r, 3000));
    }
    await targetDriver('recovery-old-token');
    await targetDriver('refresh');
    await targetDriver('available');
    await targetDriver('recovery-content');
    await targetDriver('recovery-cohort');
    const workDeadline = Date.now() + 180000;
    while ((await targetDriver('recovery-pending-result', true)).status !== 0) {
      if (Date.now() > workDeadline) throw new Error('Pending work was not recovered safely');
      await new Promise((r) => setTimeout(r, 3000));
    }
    const hardware = (
      await run('docker', [
        'info',
        '--format',
        '{{.NCPU}} CPUs; {{.MemTotal}} bytes; {{.OperatingSystem}}; {{.Architecture}}',
      ])
    ).stdout.trim();
    const result = {
      hardware,
      passed: true,
      interruptedCapture: interruptCapture,
      fixtureOnly: true,
      confirmedOffHost: false,
      backupId,
      objects: manifest.objectCount,
      sourceBytes: manifest.sourceBytes,
      encryptedBytes: manifest.parts.reduce((n, p) => n + p.bytes, 0),
      captureSeconds: manifest.durationSeconds,
      backupSeconds: (restoreStarted - backupStarted) / 1000,
      restoreSeconds: (Date.now() - restoreStarted) / 1000,
      totalSeconds: (Date.now() - started) / 1000,
      cpuLimit: 1,
      memoryLimitBytes: 2147483648,
      recoveryPoint: manifest.recoveryPoint,
      backupCompletedAt: new Date(backupCompletedAt).toISOString(),
      rpoSeconds: (backupCompletedAt - Date.parse(manifest.recoveryPoint)) / 1000,
      targetAcceptancePending: true,
    };
    assert.ok(result.restoreSeconds <= 4 * 3600, 'Fixture restore exceeded four hours');
    assert.ok(result.rpoSeconds <= 86400, 'Fixture recovery point exceeded 24 hours');
    writeFileSync(join(root, 'RECOVERY-RESULT.json'), JSON.stringify(result, null, 2), {
      mode: 0o600,
    });
    passed = true;
    console.log(
      'I19 physical PostgreSQL/WAL + SeaweedFS recovery, remote encrypted inventory, repeated verification, closed access review and old-token rejection passed',
    );
  } finally {
    if (targetStarted || existsSync(join(recovered, '.env.dms.compose')))
      await targetCompose(
        [
          '--profile',
          'tools',
          '--profile',
          'signature-updates',
          'down',
          '-v',
          '--remove-orphans',
          '--timeout',
          '15',
        ],
        { allowFailure: true },
      );
    for (const service of ['postgres', 'storage'])
      await run('docker', ['rm', '-f', '-v', `${target}-${service}-1`], { allowFailure: true });
    for (const suffix of ['postgres-data', 'storage-data', 'storage-config', 'dms-signatures'])
      await run('docker', ['volume', 'rm', `${target}_${suffix}`], { allowFailure: true });
    for (const suffix of ['default', 'storage'])
      await run('docker', ['network', 'rm', `${target}_${suffix}`], { allowFailure: true });
    await run('docker', ['rm', '-f', '-v', vault], { allowFailure: true });
    await run('docker', ['volume', 'rm', vault], { allowFailure: true });
    // Resume source fixture for the rest of I18's qualification and its cleanup.
    if (passed && existsSync(join(install, '.env.dms.compose')))
      await dms('up', {}, { allowFailure: true });
  }
}
