// Actual private cutover helper, selected production containers, normal login and real central HTTPS.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { link, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseEnv } from 'node:util';
import { decodeJwt, exportSPKI, generateKeyPair, SignJWT } from 'jose';
import pg from 'pg';
import { verifyCutoverRestore } from './fixtures/module-cutover-restore.mjs';

const inputCode = `let input='';for await(const c of process.stdin)input+=c;const value=JSON.parse(input);`;
export async function testModuleCutover({
  page,
  context,
  origin,
  fixture,
  login,
  environment,
  preparation,
  ownerFile,
  network,
  web,
  replace,
  trackReporter,
}) {
  const directory = preparation.fixture.runDirectory,
    owner = parseEnv(await readFile(ownerFile, 'utf8'));
  const mounts = [
    'TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE',
    'TURNSTILE_CONTROL_PLANE_VERIFICATION_KEYS_FILE',
    'TURNSTILE_MODULE_RELEASE_FILE',
    'TURNSTILE_MODULE_RELEASE_TRUST_FILE',
    'NODE_EXTRA_CA_CERTS',
  ].map((k) => owner[k]);
  const args = (image) => [
    'run',
    '--rm',
    '-i',
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
    ownerFile,
    ...mounts.flatMap((path) => ['--mount', `type=bind,source=${path},target=${path},readonly`]),
    '--mount',
    `type=bind,source=${preparation.privateDirectory},target=${preparation.privateDirectory}`,
    '--mount',
    `type=bind,source=${preparation.pairingFile},target=${preparation.pairingFile},readonly`,
    image,
    'node',
  ];
  const invoke = (command, input = {}, expected = 0) =>
    new Promise((done, reject) => {
      const child = spawn(command[0], command.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '',
        stderr = '';
      child.stdout.on('data', (c) => (stdout += c));
      child.stderr.on('data', (c) => (stderr = (stderr + c).slice(-65536)));
      const timer = setTimeout(() => child.kill(), 240000);
      child.once('error', reject);
      child.once('close', async (code) => {
        clearTimeout(timer);
        if (code !== expected) {
          await writeFile(join(directory, 'customer-error.log'), stderr, { mode: 0o600 });
          reject(
            new Error(
              `Private selected customer command exit ${code}; inspect customer-error.log in the fixture directory`,
            ),
          );
        } else done(stdout.trim());
      });
      child.stdin.end(JSON.stringify(input));
    });
  const command = async (image, file, input, extra = []) => {
    const output = await invoke(['docker', ...args(image), file, ...extra], input);
    return JSON.parse(output.split('\n').find((s) => s.startsWith('{')) ?? '{}');
  };
  const evalOwner = (image, code, input) =>
    command(image, '--input-type=module', input, ['-e', code]);
  const api = async (path, status = 200) => {
    const response = await page.evaluate(async (path) => {
      const r = await fetch(path);
      return { status: r.status, body: await r.json() };
    }, path);
    assert.equal(response.status, status, `${path}: ${JSON.stringify(response.body)}`);
    return response.body;
  };
  const session = () => api('/api/auth/session');
  const proof = async () => {
    const s = await session(),
      cookie = (await context.cookies()).find((c) => c.name === '__Host-turnstile');
    assert.ok(cookie);
    return {
      operatorId: fixture.users.member.id,
      administratorUserId: fixture.users.member.id,
      administratorCookie: `${cookie.name}=${cookie.value}`,
      key: randomUUID(),
      expectedRevision: s.access.accessRevision,
    };
  };
  let current = preparation.fixture.bundles[0];
  const image = (b) =>
    `sha256:${b.inventory.images.find((i) => i.role === 'turnstile-api').digest}`;
  const roles = new Map(['incident-management', 'risk-management'].map((id) => [id, randomUUID()]));
  const permission = async (id, action) => {
    const p = await proof();
    const result = await evalOwner(
      image(current),
      `import {operatorSession} from './dist/modules/access/operator-session.js';import {moduleAccessOperator} from './dist/modules/module-access/module-access-operator.js';${inputCode}const {cookie,...c}=value;if(c.action==='grant')c.identityAccessToken=await operatorSession(c.userId,cookie,process.env);console.log(JSON.stringify(await moduleAccessOperator(c)));`,
      {
        operatorId: p.operatorId,
        key: randomUUID(),
        expectedRevision: p.expectedRevision,
        userId: fixture.users.member.id,
        moduleId: id,
        roleId: roles.get(id),
        action,
        reason: 'Actual cutover explicit local permission',
        cookie: p.administratorCookie,
      },
    );
    await session();
    return result;
  };
  const open = async () => {
    const p = await proof();
    await command(
      image(current),
      'dist/modules/access/release-operator.js',
      { ...p, releaseId: current.inventory.releaseId, incompatibleProcessesStopped: true },
      ['open'],
    );
  };
  const db = new pg.Pool({
    connectionString: environment.TURNSTILE_MIGRATION_DATABASE_URL,
    max: 1,
    options: `-c app.tenant_id=${environment.INSTALLATION_TENANT_ID}`,
  });
  const cli = (action, extra = {}) =>
    command(image(current), 'dist/modules/deployment/operator.js', { action, ...extra });
  const host = async (input, expected = 0) => {
    // The actual exported operator is used so private diagnostics can retain an assertion
    // stack. No Docker/SQL/filesystem handler is replaced or mocked.
    const code = `import {moduleCutover} from ${JSON.stringify(new URL('./module-cutover.mjs', import.meta.url).href)};import {writeFileSync} from 'node:fs';${inputCode}try{console.log(JSON.stringify(await moduleCutover(value)));}catch(error){writeFileSync(${JSON.stringify(join(directory, 'cutover-error.log'))},String(error.stack),{mode:0o600});process.exitCode=1;}`;
    const output = await invoke(
      [process.execPath, '--input-type=module', '-e', code],
      input,
      expected,
    );
    return expected === 0 ? JSON.parse(output) : null;
  };
  const docker = async (args) => invoke(['docker', ...args]);
  const inspect = async (name) =>
    JSON.parse(await docker(['inspect', '--format', '{{json .}}', name]));
  const reporter = async () => {
    const configuration = Object.fromEntries(
      Object.entries(owner).filter(
        ([key]) =>
          key === 'TURNSTILE_REPORTER_DATABASE_URL' ||
          key === 'INSTALLATION_TENANT_ID' ||
          key === 'TURNSTILE_APPLICATION_ID' ||
          key === 'TURNSTILE_BUILD_VERSION' ||
          key.startsWith('TURNSTILE_CONTROL_PLANE_') ||
          key.startsWith('TURNSTILE_MODULE_RELEASE') ||
          key === 'NODE_EXTRA_CA_CERTS',
      ),
    );
    const file = join(preparation.directory, 'reporter.env');
    await writeFile(
      file,
      Object.entries(configuration)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n'),
      { mode: 0o600 },
    );
    await docker([
      'run',
      '--detach',
      '--rm',
      '--name',
      `${web}-reporter`,
      '--network',
      network,
      '--env-file',
      file,
      ...mounts.flatMap((p) => ['--mount', `type=bind,source=${p},target=${p},readonly`]),
      '--mount',
      `type=bind,source=${preparation.privateDirectory},target=${preparation.privateDirectory},readonly`,
      image(current),
      'node',
      'dist/main.reporter.js',
    ]);
    trackReporter();
    for (let i = 0; i < 100; i++) {
      const meta = (await db.query('SELECT credential_metadata FROM turnstile.deployment_control'))
        .rows[0].credential_metadata;
      if (meta?.reportFailures === 0 && !meta.report) return;
      await delay(100);
    }
    throw new Error('Actual reporter did not settle before cutover');
  };
  try {
    await login('member');
    await page.getByRole('heading', { name: 'Welcome, member.', exact: true }).waitFor();
    await command(image(current), 'dist/modules/access/release-operator.js', await proof(), [
      'bootstrap-administrator',
    ]);
    await open();
    await permission('incident-management', 'grant');
    await permission('risk-management', 'grant');
    assert.equal(
      (await api('/api/modules/incident-management/entry')).message,
      'You are in Incident Management',
    );
    await api('/api/modules/risk-management/entry', 404);
    await api('/api/dms/capabilities');
    for (const [index, target] of preparation.fixture.bundles.slice(1).entries()) {
      console.log(
        `Actual cutover stage: ${current.request.profile.modules.map((m) => m.id).join(',')} -> ${target.request.profile.modules.map((m) => m.id).join(',')}`,
      );
      await preparation.rpc({
        action: 'assign',
        catalogueId: target.request.catalogue.id,
        ids: target.request.profile.modules
          .filter(
            (m) =>
              target.request.catalogue.modules.find((d) => d.id === m.id)?.category ===
              'individual',
          )
          .map((m) => m.id),
        removed: index === 1 ? ['incident-management'] : [],
      });
      await cli('sync');
      const before = await api('/api/modules');
      assert.equal(
        before.modules.some((m) => m.id === 'risk-management'),
        index > 0,
      );
      if (index === 1) await api('/api/modules/incident-management/entry', 403);
      await reporter();
      const row = (await db.query('SELECT decision FROM turnstile.deployment_control')).rows[0];
      const claims = (await import('jose')).decodeJwt(row.decision.accepted.token);
      const containers = [];
      for (const [name, role] of [
        [`${web}-product`, 'api'],
        [`${web}-reporter`, 'reporter'],
        [web, 'web'],
      ])
        containers.push({ id: (await inspect(name)).Id, role });
      const planDirectory = join(directory, `cutover-${index}`);
      await mkdir(planDirectory, { mode: 0o700 });
      const input = {
        action: 'prepare',
        requestId: randomUUID(),
        planDirectory,
        sourceBundleDirectory: current.directory,
        targetBundleDirectory: target.directory,
        releaseTrustFile: join(preparation.fixture.directory, 'release-trust.json'),
        network,
        ownerEnvironmentFile: ownerFile,
        privateDirectory: preparation.privateDirectory,
        mounts,
        containers,
        desiredRevision: claims.modulePolicy.desired.assignmentRevision,
        policyRevision: claims.policyRevision,
        operatorId: fixture.users.member.id,
        expectedAccessRevision: (await session()).access.accessRevision,
      };
      if (index === 0) {
        // Delivery trust must never replace installed key status or expand it. Exercise
        // the actual helper before closure, with otherwise identical signed artifacts.
        const installedTrustPath = owner.TURNSTILE_MODULE_RELEASE_TRUST_FILE,
          installedTrustBytes = await readFile(installedTrustPath),
          installedTrust = JSON.parse(installedTrustBytes),
          replacement = await generateKeyPair('RS256', { extractable: true }),
          publicKey = await exportSPKI(replacement.publicKey),
          kid = 'delivery-only-key',
          bundle = join(directory, 'delivery-only-target'),
          trustFile = join(directory, 'delivery-only-trust.json'),
          descriptor = JSON.parse(await readFile(join(target.directory, 'delivery.json'), 'utf8'));
        await mkdir(bundle, { mode: 0o700 });
        for (const name of await readdir(target.directory))
          if (name !== 'delivery.json')
            await link(join(target.directory, name), join(bundle, name));
        const attestation = await new SignJWT(decodeJwt(descriptor.attestation))
          .setProtectedHeader({ alg: 'RS256', typ: 'thaarei-module-delivery+jwt', kid })
          .sign(replacement.privateKey);
        await writeFile(
          join(bundle, 'delivery.json'),
          JSON.stringify({ ...descriptor, attestation }),
          {
            mode: 0o600,
          },
        );
        await writeFile(
          trustFile,
          JSON.stringify({
            ...preparation.fixture.releaseTrust,
            keys: [...preparation.fixture.releaseTrust.keys, { kid, publicKey }],
          }),
          { mode: 0o600 },
        );
        try {
          for (const status of ['absent', 'revoked', 'retired']) {
            const bytes =
              status === 'absent'
                ? installedTrustBytes
                : Buffer.from(
                    JSON.stringify({
                      ...installedTrust,
                      keys: [
                        ...installedTrust.keys,
                        {
                          kid,
                          pem: publicKey,
                          status,
                          lastIssuedAt: decodeJwt(attestation).iat - 1,
                        },
                      ],
                    }),
                  );
            await writeFile(installedTrustPath, bytes);
            await host({ ...input, targetBundleDirectory: bundle, releaseTrustFile: trustFile }, 1);
            assert.match(
              await readFile(join(directory, 'cutover-error.log'), 'utf8'),
              status === 'retired' ? /Invalid release evidence context/ : /Untrusted release key/,
              'The installed release verifier must reject the signer',
            );
            assert.deepEqual(
              await readFile(installedTrustPath),
              bytes,
              'Installed trust was rewritten',
            );
            await assert.rejects(readFile(join(planDirectory, 'cutover.json')), { code: 'ENOENT' });
            assert.equal(
              (await db.query('SELECT public_writes_enabled FROM turnstile.access_context')).rows[0]
                .public_writes_enabled,
              true,
              'Untrusted target closed the installation',
            );
            for (const c of containers) assert.equal((await inspect(c.id)).State.Running, true);
          }
        } finally {
          await writeFile(installedTrustPath, installedTrustBytes);
        }
        console.log(
          'Actual cutover helper rejected absent, revoked and retired target signers before closure and preserved installed trust.',
        );
        // Real filesystem failure after the durable fence. Retry must reuse its checkpoint.
        await mkdir(join(planDirectory, 'backup'), { mode: 0o700 });
        await host(input, 1);
        const failed = JSON.parse(await readFile(join(planDirectory, 'cutover.json'), 'utf8'));
        assert.equal(failed.phase, 'fenced');
        assert.equal(
          (await db.query('SELECT public_writes_enabled FROM turnstile.access_context')).rows[0]
            .public_writes_enabled,
          false,
        );
        for (const c of containers)
          await assert.rejects(docker(['inspect', '--format', '{{.State.Running}}', c.id]));
        await host({ ...input, desiredRevision: input.desiredRevision + 1 }, 1);
        await rm(join(planDirectory, 'backup'), { recursive: true });
      }
      const prepared = await host(input);
      assert.equal(prepared.phase, 'prepared');
      assert.equal(
        (await host(input)).phase,
        'prepared',
        'Replayed completion cannot mutate current authority',
      );
      const journal = JSON.parse(await readFile(join(planDirectory, 'cutover.json'), 'utf8'));
      assert.ok(journal.databaseDigest);
      assert.ok(Object.keys(journal.fingerprints).length >= 9);
      await replace(target);
      current = target;
      const pairing = await preparation.rpc({ action: 'pair' });
      await writeFile(preparation.pairingFile, JSON.stringify(pairing), { mode: 0o600 });
      await command(image(current), 'dist/modules/deployment/operator.js', {
        action: 'rebind',
        pairingFile: preparation.pairingFile,
      });
      await preparation.rpc({ action: 'approve-product' });
      await cli('sync');
      await api('/api/modules', 403); // A fresh pending epoch has no product/module business authority.

      await preparation.rpc({ action: 'activate', lost: true });
      await cli('sync');
      assert.equal(
        (await db.query('SELECT decision FROM turnstile.deployment_control')).rows[0].decision
          .minimumVersion,
        2,
      );
      assert.equal(
        (await db.query('SELECT decision FROM turnstile.deployment_control')).rows[0].decision
          .releaseTrustRevision,
        2,
        'Release trust floor survives a fresh pairing epoch',
      );
      if (index === 1) {
        await permission('risk-management', 'revoke');
        await host({ ...input, action: 'verify' }, 1);
        const p = await proof();
        const reconciled = {
          ...input,
          action: 'reconcile',
          review: {
            reviewId: randomUUID(),
            expectedAccessRevision: p.expectedRevision,
            administratorUserId: p.administratorUserId,
            administratorCookie: p.administratorCookie,
          },
        };
        assert.equal((await host(reconciled)).reviewed, true);
        assert.equal((await host(reconciled)).replayed, true);
      }
      const verified = await host({ ...input, action: 'verify' });
      assert.equal(verified.phase, 'complete');
      await open();
      await page.goto(`${origin}/`);
      await page.getByRole('heading', { name: 'Welcome, member.', exact: true }).waitFor();
      if (index === 0) {
        assert.equal(
          (await api('/api/modules/risk-management/entry')).message,
          'You are in Risk Management',
        );
        assert.equal(
          (await api('/api/modules/incident-management/entry')).message,
          'You are in Incident Management',
        );
      } else if (index === 1) {
        assert.deepEqual(
          (await api('/api/modules')).modules,
          [],
          'Intervening local revocation is retained',
        );
        await permission('risk-management', 'grant');
        assert.equal(
          (await api('/api/modules/risk-management/entry')).message,
          'You are in Risk Management',
        );
        await api('/api/modules/incident-management/entry', 404);
      } else {
        assert.equal(
          (await api('/api/modules/risk-management/entry')).message,
          'You are in Risk Management',
        );
        await api('/api/modules/incident-management/entry', 404);
      }
      await api('/api/dms/capabilities');
      assert.ok(
        (await db.query('SELECT completed_at FROM turnstile.organization_configuration')).rows[0]
          .completed_at,
      );
    }
    preparation.network = network;
    await verifyCutoverRestore({ environment, preparation, owner, invoke });
    const live = JSON.parse(
      await readFile(join(preparation.privateDirectory, 'product.json'), 'utf8'),
    );
    await writeFile(
      join(directory, 'central-restore-probe.json'),
      JSON.stringify({
        binding: live.binding,
        epoch: live.current.epoch,
        secret: live.current.secret,
        installed: {
          catalogueDigest: current.inventory.catalogueDigest,
          profileDigest: current.inventory.profileDigest,
          releaseId: current.inventory.releaseId,
        },
      }),
      { mode: 0o600 },
    );
    console.log(
      'Actual MOD-I08 selected-image normal-login cutover passed: real central activation, add/remove profiles, stopped old containers, coherent private archive, real interruption/same-request resume, current epoch/policy floors, preserved setup/grants, role-change review, target landing/API and independent DMS.',
    );
  } finally {
    await db.end();
  }
}
