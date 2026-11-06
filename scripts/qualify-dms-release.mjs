import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ledger } from './dms-evidence.mjs';

const args = process.argv.slice(2),
  option = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
for (const name of [
  '--bundle',
  '--output',
  '--signatures-dir',
  '--ocr-fixture',
  '--previous-image',
])
  assert.ok(option(name), `Explicit ${name} required`);
const bundle = resolve(option('--bundle')),
  output = resolve(option('--output'));
assert.ok(!existsSync(output), 'Use a new evidence directory');
mkdirSync(output, { recursive: true, mode: 0o700 });
const release = JSON.parse(readFileSync(join(bundle, 'RELEASE.json'))),
  commands = [];
async function run(command, values, extra = {}, cwd = process.cwd()) {
  const start = new Date().toISOString();
  const result = await new Promise((done, reject) => {
    const p = spawn(command, values, {
      cwd,
      env: { ...process.env, ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '',
      err = '';
    p.stdout.on('data', (x) => (out += x));
    p.stderr.on('data', (x) => (err += x));
    p.on('error', reject);
    p.on('exit', (code) => done({ code, out, err }));
  });
  const path = join(output, `${commands.length + 1}.log`);
  writeFileSync(path, `${result.out}\n${result.err}`, { mode: 0o600 });
  commands.push({
    command: [command, ...values],
    startedAt: start,
    finishedAt: new Date().toISOString(),
    exitCode: result.code,
    log: relative(process.cwd(), path),
    logSha256: sha(readFileSync(path)),
  });
  assert.equal(result.code, 0, `Qualification step failed; protected log ${path}`);
  return result.out;
}
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fingerprint() {
  const files = (await run('git', ['ls-files', '-co', '--exclude-standard', '-z']))
    .split('\0')
    .filter(
      (x) =>
        x &&
        ![
          'IN_PROGRESS.md',
          'docs/qualification/dms-i20-release.json',
          'docs/qualification/dms-i20-ledger.json',
        ].includes(x),
    );
  const h = createHash('sha256');
  for (const file of [...new Set(files)].sort()) {
    if (!existsSync(file) || !statSync(file).isFile()) continue;
    h.update(`${file}\0`);
    h.update(readFileSync(file));
  }
  return h.digest('hex');
}
function filesUnder(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesUnder(join(path, e.name)) : [join(path, e.name)],
  );
}
const source = await fingerprint();
const inputInventory = Object.fromEntries(
  [
    'pnpm-lock.yaml',
    'apps/dms-processing/uv.lock',
    ...filesUnder('docs/api').filter((p) => p.includes('dms') && p.endsWith('.json')),
    ...filesUnder('apps/dms-api/database/dms/migrations').filter((p) => p.endsWith('.sql')),
    'apps/dms-processing/src/turnstile_processing/structure-models.json',
  ].map((p) => [p, sha(readFileSync(p))]),
);
let report;
try {
  await run('sha256sum', ['--check', 'SHA256SUMS'], {}, bundle);
  assert.equal(
    release.version,
    JSON.parse(readFileSync('deploy/distribution/release.json')).version,
  );
  for (const [path, digest] of Object.entries(inputInventory)) {
    // SQL is bound through the image inventory; contracts and dependency/model inputs
    // must also match the independent, inspectable bundle copies.
    if (path.endsWith('.sql')) continue;
    const copy = join(bundle, path.startsWith('docs/') ? path : join('sources', path));
    assert.equal(sha(readFileSync(copy)), digest, `Bundle/source mismatch: ${path}`);
  }
  for (const image of release.images)
    assert.equal(
      (await run('docker', ['image', 'inspect', '--format', '{{.Id}}', image.name])).trim(),
      image.id,
      'Exact image changed',
    );
  for (const script of ['check', 'build', 'test', 'test:integration']) await run('pnpm', [script]);
  const apiImage = release.images.find((i) => i.name.startsWith('thaarei-dms-api:')).name;
  const sql = Object.keys(inputInventory).filter((p) => p.endsWith('.sql'));
  const imageSql = JSON.parse(
    await run('docker', [
      'run',
      '--rm',
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      apiImage,
      'node',
      '--input-type=module',
      '-e',
      "import{readFileSync}from'node:fs';import{createHash}from'node:crypto';console.log(JSON.stringify(Object.fromEntries(process.argv.slice(1).map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]))));",
      ...sql.map((p) => p.replace('apps/dms-api/', '/app/')),
    ]),
  );
  for (const p of sql)
    assert.equal(
      imageSql[p.replace('apps/dms-api/', '/app/')],
      inputInventory[p],
      `Packaged migration mismatch: ${p}`,
    );
  await run('node', ['scripts/test-auth-database.mjs', '--standalone'], {
    DMS_STANDALONE_IMAGE: release.images.find((i) => i.name.startsWith('thaarei-dms-api:')).name,
  });
  const native = join(output, 'native');
  mkdirSync(native, { mode: 0o777 }); // Synthetic measurement output only; evidence parent remains private.
  // Use the exact default processing image with trusted resource probes, offline namespaces and no credentials.
  await run('docker', [
    'run',
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--security-opt',
    `seccomp=${resolve('deploy/assessment/scanner-seccomp.json')}`,
    '--user',
    `${process.getuid()}:${process.getgid()}`,
    '--memory',
    '2g',
    '--cpus',
    '1',
    '--pids-limit',
    '128',
    '--tmpfs',
    '/tmp:size=384m,noexec,nosuid,nodev',
    '--mount',
    `type=bind,src=${resolve('apps/dms-processing/tests')},dst=/tests,readonly`,
    '--mount',
    `type=bind,src=${resolve(native)},dst=/out`,
    '--workdir',
    '/tests',
    `thaarei-dms-processing:${release.version}`,
    'python',
    'qualify_ocr.py',
    '--output',
    '/out/ocr.json',
  ]);
  await run('node', [
    'scripts/test-dms-distribution.mjs',
    bundle,
    '--previous-image',
    option('--previous-image'),
    '--rollback-image',
    option('--previous-image'),
    '--signatures-dir',
    resolve(option('--signatures-dir')),
    '--ocr-fixture',
    resolve(option('--ocr-fixture')),
    '--qualification',
    '--recovery',
    '--recovery-interrupt',
    '--evidence-parent',
    join(output, 'fixtures'),
  ]);
  const dirs = readdirSync(join(output, 'fixtures')).map((n) => join(output, 'fixtures', n));
  assert.equal(dirs.length, 1);
  const fixture = dirs[0];
  assert.ok(JSON.parse(readFileSync(join(fixture, 'RESULT.json'))).passed);
  const performance = JSON.parse(readFileSync(join(fixture, 'PERFORMANCE-RESULT.json'))),
    recovery = JSON.parse(readFileSync(join(fixture, 'RECOVERY-RESULT.json'))),
    ocr = JSON.parse(readFileSync(join(native, 'ocr.json')));
  assert.ok(
    performance.metadataP95Under300Ms,
    'Declared-workload metadata latency objective failed',
  );
  assert.equal(await fingerprint(), source, 'Source changed during qualification');
  for (const image of release.images)
    assert.equal(
      (await run('docker', ['image', 'inspect', '--format', '{{.Id}}', image.name])).trim(),
      image.id,
      'Candidate image tag changed during qualification',
    );
  const dirty = !!(await run('git', ['status', '--porcelain'])).trim();
  report = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    localQualified: true,
    customerReleased: false,
    targetAccepted: false,
    manualTested: false,
    candidate: {
      version: release.version,
      images: release.images,
      sourceSha256: source,
      gitHead: (await run('git', ['rev-parse', 'HEAD'])).trim(),
      workingTreeDirty: dirty,
      contractsDependenciesMigrations: inputInventory,
      bundleChecksumSha256: sha(readFileSync(join(bundle, 'SHA256SUMS'))),
    },
    authority: 'bundled-better-auth',
    selectedProfile: release.images.some((i) =>
      i.name.startsWith('thaarei-dms-processing-structured:'),
    )
      ? 'structured-included'
      : 'standard',
    commands,
    performance,
    recovery,
    ocr,
    evidenceDirectory: relative(process.cwd(), output),
    remaining: [
      'Independent off-host host-loss survival and realistic operating-volume recovery acceptance.',
      'Customer DNS/TLS/mail/secret delivery, sustained operating mix and hardware approval.',
      'Human/operator journey and accountable license/redistribution review.',
      'Reviewed clean source revision and explicit deployment/release authorization.',
    ],
    scope:
      'Synthetic isolated local qualification only; no installed environment/customer target touched.',
  };
  writeFileSync('docs/qualification/dms-i20-release.json', `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(
    'docs/qualification/dms-i20-ledger.json',
    `${JSON.stringify(ledger(report), null, 2)}\n`,
  );
  await run('pnpm', [
    'exec',
    'biome',
    'format',
    '--write',
    'docs/qualification/dms-i20-release.json',
    'docs/qualification/dms-i20-ledger.json',
  ]);
  console.log(JSON.stringify({ localQualified: true, targetAccepted: false, evidence: output }));
} catch (error) {
  writeFileSync(
    join(output, 'FAILED.json'),
    JSON.stringify(
      {
        failed: true,
        commands,
        message: 'Inspect protected step logs; no release/target acceptance is granted.',
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  throw error;
}
