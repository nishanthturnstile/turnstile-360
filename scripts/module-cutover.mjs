// Private Linux/Docker POC operator. Never served by an application or given a Docker socket.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { parse } from 'yaml';
import {
  moduleCutoverInput,
  ProtectedFileStore,
  readProtectedTrust,
  verifyInstalledModuleRelease,
} from '../packages/deployment-control/dist/index.js';
import { verifyBundle } from './module-delivery.mjs';

const hash = (v) => createHash('sha256').update(v).digest('hex');
function protect(path, directory = false) {
  const s = lstatSync(path);
  assert.ok(
    (directory ? s.isDirectory() : s.isFile()) &&
      !s.isSymbolicLink() &&
      !(s.mode & 0o077) &&
      s.uid === process.getuid(),
    'Protected operator path required',
  );
  return s;
}
function atomic(path, value) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, value, { mode: 0o600, flag: 'wx' });
  const fd = openSync(tmp, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  const dir = openSync(dirname(path), 'r');
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}
function run(args, input, extra = {}) {
  const r = spawnSync('docker', args, {
    input,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
    ...extra,
  });
  assert.equal(r.status, 0, 'Private Docker operation failed; preserve the cutover plan');
  return r.stdout?.trim() ?? '';
}
const stopped = (id) => {
  const r = spawnSync('docker', ['inspect', '--format', '{{.State.Running}}', id], {
    encoding: 'utf8',
    timeout: 15000,
  });
  return r.status === 0
    ? r.stdout.trim() === 'false'
    : /no such (?:object|container)/i.test(r.stderr);
};
function copyPrivate(from, to) {
  protect(from, true);
  mkdirSync(to, { mode: 0o700 });
  for (const name of readdirSync(from)) {
    if (name === 'operation.lock') continue; // Kernel locks are recreated, never recovery evidence.
    const src = join(from, name),
      dst = join(to, name);
    const s = lstatSync(src);
    assert.ok(!s.isSymbolicLink());
    if (s.isDirectory()) copyPrivate(src, dst);
    else {
      protect(src);
      assert.ok(s.size <= 16 * 1024 * 1024);
      writeFileSync(dst, readFileSync(src), { mode: 0o600, flag: 'wx' });
    }
  }
}
const fingerprintCode = `import {createHash} from 'node:crypto';import pg from 'pg';const pool=new pg.Pool({connectionString:process.env.TURNSTILE_MIGRATION_DATABASE_URL,max:1});const db=await pool.connect();try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await db.query("SELECT set_config('app.tenant_id',$1,true)",[process.env.INSTALLATION_TENANT_ID]);const result={};for(const table of ['installation','organization_configuration','organization_unit','access_member','access_legacy_source','access_role','access_role_permission','access_assignment','access_scope_anchor']){const data=(await db.query('SELECT coalesce(jsonb_agg(v ORDER BY v::text COLLATE "C"),jsonb_build_array()) AS data FROM (SELECT to_jsonb(t) AS v FROM turnstile.'+table+' t) source_rows')).rows[0].data;result[table]=createHash('sha256').update(JSON.stringify(data)).digest('hex');}await db.query('COMMIT');console.log(JSON.stringify(result));}finally{db.release();await pool.end();}`;
/** Both phases retain the same request identity. Completion never restores credentials or opens writers. */
export async function moduleCutover(raw) {
  const c = moduleCutoverInput.parse(raw);
  for (const path of [c.ownerEnvironmentFile, c.releaseTrustFile]) protect(path);
  protect(c.privateDirectory, true);
  assert.ok(
    c.mounts.every((p) => isAbsolute(p) && lstatSync(p).isFile() && !lstatSync(p).isSymbolicLink()),
  );
  const environment = parseEnv(readFileSync(c.ownerEnvironmentFile, 'utf8'));
  const required = [
    'TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE',
    'TURNSTILE_CONTROL_PLANE_VERIFICATION_KEYS_FILE',
    'TURNSTILE_MODULE_RELEASE_FILE',
    'TURNSTILE_MODULE_RELEASE_TRUST_FILE',
  ];
  for (const key of required)
    assert.ok(
      c.mounts.includes(environment[key]),
      'Mount every exact public trust/release/marker file',
    );
  assert.equal(
    environment.TURNSTILE_CONTROL_PLANE_MACHINE_SECRET_FILE,
    join(c.privateDirectory, 'product.json'),
  );
  for (const key of required) protect(environment[key]);
  assert.ok(
    !resolve(c.planDirectory).startsWith(`${resolve(c.privateDirectory)}/`) &&
      c.planDirectory !== c.privateDirectory,
  );
  const outside = relative(resolve('.'), resolve(c.planDirectory));
  assert.ok(
    outside === '..' || outside.startsWith('../') || isAbsolute(outside),
    'Keep cutover backups outside the checkout',
  );
  if (!existsSync(c.planDirectory)) mkdirSync(c.planDirectory, { mode: 0o700 });
  protect(c.planDirectory, true);
  const planPath = realpathSync(c.planDirectory);
  for (const input of [
    c.privateDirectory,
    c.sourceBundleDirectory,
    c.targetBundleDirectory,
    c.ownerEnvironmentFile,
    c.releaseTrustFile,
    ...c.mounts,
  ]) {
    const actual = realpathSync(input);
    assert.ok(
      actual !== planPath &&
        !actual.startsWith(`${planPath}/`) &&
        !planPath.startsWith(`${actual}/`),
      'Backup plan must be disjoint from every live input',
    );
  }

  return new ProtectedFileStore(
    c.planDirectory,
    environment.TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE,
  ).locked(async () => {
    const file = join(c.planDirectory, 'cutover.json'),
      command = { ...c, action: undefined, review: undefined },
      digest = hash(JSON.stringify(command));
    if (existsSync(file)) protect(file);
    let journal = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    if (journal)
      assert.ok(
        ['verified', 'closed', 'fenced', 'archived', 'prepared', 'complete'].includes(
          journal.phase,
        ),
        'Unknown cutover phase',
      );
    if (journal)
      assert.equal(journal.digest, digest, 'Changed cutover input requires reconciliation');
    const trust = JSON.parse(readFileSync(c.releaseTrustFile, 'utf8'));
    const source = JSON.parse(readFileSync(join(c.sourceBundleDirectory, 'delivery.json'), 'utf8'));
    const target = JSON.parse(readFileSync(join(c.targetBundleDirectory, 'delivery.json'), 'utf8'));
    const old = await verifyBundle(c.sourceBundleDirectory, source.request, trust, {
      historical: true,
    });
    const next = await verifyBundle(c.targetBundleDirectory, target.request, trust, {
      images: false,
    });
    // Artifact delivery trust cannot expand installed trust or reactivate revoked keys.
    // Provision any release-key change independently before starting/resuming cutover.
    await verifyInstalledModuleRelease(
      target.attestation,
      target.request,
      target.request.profile,
      await readProtectedTrust(environment.TURNSTILE_MODULE_RELEASE_TRUST_FILE),
      Math.floor(Date.now() / 1000),
    );
    if (journal) {
      assert.deepEqual(old.inventory, journal.source, 'Source artifact changed during cutover');
      assert.deepEqual(next.inventory, journal.target, 'Target artifact changed during cutover');
    }
    assert.notEqual(
      old.inventory.profileDigest,
      next.inventory.profileDigest,
      'Use ordinary reapproval for an unchanged profile',
    );
    const oldApi = `sha256:${old.inventory.images.find((i) => i.role === 'turnstile-api').digest}`,
      newApi = `sha256:${next.inventory.images.find((i) => i.role === 'turnstile-api').digest}`;
    const intent = {
      requestId: c.requestId,
      desiredRevision: c.desiredRevision,
      policyRevision: c.policyRevision,
      target: {
        catalogueDigest: next.inventory.catalogueDigest,
        profileDigest: next.inventory.profileDigest,
        releaseId: next.inventory.releaseId,
      },
    };
    const args = (image) => [
      'run',
      '--rm',
      '-i',
      '--network',
      c.network,
      '--read-only',
      '--tmpfs',
      '/tmp',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--env-file',
      c.ownerEnvironmentFile,
      ...c.mounts.flatMap((p) => ['--mount', `type=bind,source=${p},target=${p},readonly`]),
      '--mount',
      `type=bind,source=${c.privateDirectory},target=${c.privateDirectory}`,
      image,
      'node',
    ];
    const json = (output) => JSON.parse(output.split('\n').find((line) => line.startsWith('{')));
    const deployment = (image, action) =>
      json(
        run(
          [...args(image), 'dist/modules/deployment/operator.js'],
          JSON.stringify({ action, cutover: intent }),
        ),
      );
    const release = (operation, input, image = oldApi) =>
      json(
        run(
          [...args(image), 'dist/modules/access/release-operator.js', operation],
          JSON.stringify(input),
        ),
      );
    const fingerprints = (image) =>
      json(run([...args(image), '--input-type=module', '-e', fingerprintCode]));
    const save = () => atomic(file, `${JSON.stringify(journal, null, 2)}\n`);
    if (!journal) {
      assert.equal(c.action, 'prepare', 'Prepare a cutover before verification');
      const proof = deployment(oldApi, 'prepare-cutover');
      for (const key of ['catalogueDigest', 'profileDigest', 'releaseId'])
        assert.equal(proof.active[key], old.inventory[key]);
      for (const container of c.containers) {
        const info = JSON.parse(run(['inspect', '--format', '{{json .}}', container.id]));
        assert.equal(info.Id, container.id);
        assert.ok(
          Object.hasOwn(info.NetworkSettings.Networks, c.network),
          'Declared old process is outside this installation network',
        );
        if (container.role !== 'web')
          for (const key of ['INSTALLATION_TENANT_ID', 'TURNSTILE_APPLICATION_ID']) {
            const value = info.Config.Env.find((v) => v.startsWith(`${key}=`))?.slice(
              key.length + 1,
            );
            assert.equal(
              value,
              environment[key],
              'Declared old process belongs to a different installation/application',
            );
          }

        assert.equal(
          info.Image,
          `sha256:${old.inventory.images.find((i) => i.role === (container.role === 'web' ? 'turnstile-web' : 'turnstile-api')).digest}`,
        );
      }
      journal = {
        version: 1,
        requestId: c.requestId,
        digest,
        environmentDigest: hash(readFileSync(c.ownerEnvironmentFile)),
        phase: 'verified',
        source: old.inventory,
        target: next.inventory,
        binding: proof.binding,
        from: proof.active,
        desired: proof.desired,
      };
      save();
    }
    assert.equal(
      hash(readFileSync(c.ownerEnvironmentFile)),
      journal.environmentDigest,
      'Owner configuration changed; reconcile before continuing',
    );
    if (c.action === 'reconcile') {
      assert.equal(journal.phase, 'prepared', 'Reconcile only a closed prepared cutover');
      assert.ok(c.review, 'Current protected administrator review required');
      assert.ok(c.containers.every((v) => stopped(v.id)));
      deployment(newApi, 'verify-cutover');
      const current = release(
        'verify-login',
        {
          operatorId: c.operatorId,
          administratorUserId: c.review.administratorUserId,
          administratorCookie: c.review.administratorCookie,
        },
        newApi,
      );
      assert.equal(current.publicWritesEnabled, false);
      assert.equal(current.revision, c.review.expectedAccessRevision);
      journal.reviews ??= [];
      const safe = {
        reviewId: c.review.reviewId,
        administratorUserId: c.review.administratorUserId,
        expectedAccessRevision: c.review.expectedAccessRevision,
      };
      const receipt = journal.reviews.find((r) => r.reviewId === safe.reviewId);
      if (receipt) {
        assert.equal(receipt.digest, hash(JSON.stringify(safe)));
        return { requestId: c.requestId, phase: journal.phase, replayed: true };
      }
      assert.ok(journal.reviews.length < 16, 'Reconciliation history limit reached');
      journal.fingerprints = fingerprints(newApi);
      journal.reviews.push({
        ...safe,
        digest: hash(JSON.stringify(safe)),
        fingerprints: journal.fingerprints,
      });
      save();
      return { requestId: c.requestId, phase: journal.phase, reviewed: true };
    }
    if (c.action === 'verify') {
      assert.ok(['prepared', 'complete'].includes(journal.phase), 'Complete preparation first');
      assert.ok(
        c.containers.every((v) => stopped(v.id)),
        'Old processes must stay stopped',
      );
      await verifyBundle(c.targetBundleDirectory, target.request, trust);
      const proof = deployment(newApi, 'verify-cutover');
      assert.notEqual(
        proof.epoch,
        journal.epoch,
        'Supported cutover requires a fresh reviewed pairing epoch',
      );
      assert.deepEqual(
        fingerprints(newApi),
        journal.fingerprints,
        'Identity/setup/local grants changed; reconcile rather than replacing them',
      );
      journal.phase = 'complete';
      journal.verified = proof;
      save();
      return {
        requestId: c.requestId,
        phase: journal.phase,
        releaseId: next.inventory.releaseId,
        publicOpeningRequired: true,
      };
    }
    if (['prepared', 'complete'].includes(journal.phase))
      return { requestId: c.requestId, phase: journal.phase };
    if (journal.phase === 'verified') {
      const closed = release('close', {
        operatorId: c.operatorId,
        key: c.requestId,
        expectedRevision: c.expectedAccessRevision,
      });
      assert.equal(
        closed.publicWritesEnabled,
        false,
        'A historical close receipt cannot override a later opening',
      );
      journal.phase = 'closed';
      save();
    }
    if (journal.phase === 'closed') {
      for (const container of c.containers)
        if (!stopped(container.id)) run(['stop', '--time', '30', container.id]);
      assert.ok(c.containers.every((v) => stopped(v.id)));
      const proof = deployment(oldApi, 'quarantine-cutover');
      journal.epoch = proof.epoch;
      journal.phase = 'fenced';
      save();
    }
    if (journal.phase === 'fenced') {
      // Dump only the owning product schema, using dedicated owner credentials in a private env file.
      const backup = join(c.planDirectory, 'backup'),
        staging = join(c.planDirectory, 'backup.staging');
      if (existsSync(backup)) {
        const manifest = JSON.parse(readFileSync(join(backup, 'manifest.json'), 'utf8'));
        assert.equal(manifest.inputDigest, digest);
        for (const [name, value] of Object.entries(manifest.files))
          assert.equal(hash(readFileSync(join(backup, name))), value);
        journal.fingerprints = manifest.fingerprints;
        assert.deepEqual(fingerprints(oldApi), journal.fingerprints);
        journal.databaseDigest = manifest.files['database.dump'];
      } else {
        if (existsSync(staging)) {
          assert.ok(lstatSync(staging).isDirectory() && !lstatSync(staging).isSymbolicLink());
          if (readdirSync(staging).length)
            assert.equal(
              JSON.parse(readFileSync(join(staging, '.cutover-input.json'), 'utf8')).digest,
              digest,
              'Unknown backup staging data must be preserved',
            );
          rmSync(staging, { recursive: true });
        }
        mkdirSync(staging, { mode: 0o700 });
        atomic(join(staging, '.cutover-input.json'), JSON.stringify({ digest }));
        journal.fingerprints = fingerprints(oldApi);
        copyPrivate(c.privateDirectory, join(staging, 'private-state'));
        writeFileSync(
          join(staging, 'owner-environment.env'),
          readFileSync(c.ownerEnvironmentFile),
          { mode: 0o600, flag: 'wx' },
        );
        for (const [index, path] of c.mounts.entries())
          writeFileSync(join(staging, `protected-${index}`), readFileSync(path), {
            mode: 0o600,
            flag: 'wx',
          });
        const url = new URL(environment.TURNSTILE_MIGRATION_DATABASE_URL);
        assert.equal(url.username, 'thaarei_turnstile_migrator');
        const pgFile = join(staging, 'postgres.env');
        writeFileSync(
          pgFile,
          Object.entries({
            PGHOST: url.hostname,
            PGPORT: url.port || '5432',
            PGDATABASE: url.pathname.slice(1),
            PGOPTIONS: `-c app.tenant_id=${environment.INSTALLATION_TENANT_ID}`,
            PGUSER: url.username,
            PGPASSWORD: decodeURIComponent(url.password),
          })
            .map(([k, v]) => `${k}=${v}`)
            .join('\n'),
          { mode: 0o600, flag: 'wx' },
        );
        const database = join(staging, 'database.dump'),
          fd = openSync(database, 'wx', 0o600);
        try {
          const image = parse(readFileSync('deploy/compose.local.yaml', 'utf8')).services.postgres
            .image;
          run(
            [
              'run',
              '--rm',
              '--network',
              c.network,
              '--read-only',
              '--tmpfs',
              '/tmp',
              '--env-file',
              pgFile,
              image,
              'pg_dump',
              '--format=custom',
              '--enable-row-security',
              '--inserts',
              '--schema=turnstile',
              '--schema=turnstile_migrations',
            ],
            undefined,
            { stdio: ['ignore', fd, 'pipe'] },
          );
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        journal.databaseDigest = hash(readFileSync(database));
        const members = {};
        const walk = (directory, prefix = '') => {
          for (const name of readdirSync(directory)) {
            const path = join(directory, name),
              key = prefix + name;
            if (lstatSync(path).isDirectory()) walk(path, `${key}/`);
            else members[key] = hash(readFileSync(path));
          }
        };
        walk(staging);
        atomic(
          join(staging, 'manifest.json'),
          JSON.stringify({
            version: 1,
            inputDigest: digest,
            fingerprints: journal.fingerprints,
            files: members,
          }),
        );
        renameSync(staging, backup);
      }
      journal.phase = 'archived';
      save();
    }
    if (journal.phase === 'archived') {
      run(['load', '--input', join(c.targetBundleDirectory, 'images.tar')]);
      await verifyBundle(c.targetBundleDirectory, target.request, trust);
      atomic(environment.TURNSTILE_MODULE_RELEASE_FILE, JSON.stringify(target));
      run([...args(newApi), 'dist/infrastructure/database/migrate.js', 'turnstile']);
      assert.deepEqual(fingerprints(newApi), journal.fingerprints);
      journal.phase = 'prepared';
      save();
    }
    return {
      requestId: c.requestId,
      phase: journal.phase,
      releaseId: next.inventory.releaseId,
      reviewedRebindAndActivationRequired: true,
    };
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.equal(process.argv.length, 2);
    let input = '';
    for await (const c of process.stdin) {
      input += c;
      assert.ok(Buffer.byteLength(input) <= 32768);
    }
    console.log(JSON.stringify(await moduleCutover(JSON.parse(input))));
  } catch {
    console.error(
      'Private module cutover stopped; keep old processes stopped and preserve the protected plan for reconciliation.',
    );
    process.exitCode = 1;
  }
}
