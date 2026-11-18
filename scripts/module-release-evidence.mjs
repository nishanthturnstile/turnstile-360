// Local evidence/checksums are review material, never release trust or business authority.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { binding } from '../packages/control-plane-contracts/dist/index.js';
import { protectedFile } from '../packages/deployment-control/dist/index.js';
import { verifyArtifacts } from '../packages/installation-engine/dist/artifacts.js';
import { hash, sourceInventory } from './module-build-source.mjs';
import { verifyBundle } from './module-delivery.mjs';

const reportPath = 'docs/qualification/module-release-20261111.json';
export function snapshotPaths(paths, root = '.') {
  return [...new Set(paths)].sort().map((path) => {
    assert.ok(!path.startsWith('/') && !path.split('/').includes('..'));
    const file = join(root, path),
      s = lstatSync(file);
    assert.ok(s.isFile() && !s.isSymbolicLink(), 'Regular source files required');
    return { path, digest: hash(readFileSync(file)), executable: !!(s.mode & 0o111) };
  });
}
export function workspaceSnapshot() {
  const paths = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8', maxBuffer: 8 * 1024 ** 2 },
  )
    .split('\0')
    .filter(Boolean)
    .filter(
      (p) =>
        p !== reportPath &&
        p !== 'IN_PROGRESS.md' &&
        !p
          .split('/')
          .some((part) =>
            ['node_modules', 'dist', '.next', '__pycache__', '.turbo'].includes(part),
          ) &&
        (!p.split('/').some((part) => part.startsWith('.env')) || p.endsWith('.example')),
    );
  return snapshotPaths(paths);
}
export function seal(body) {
  return { ...body, recordDigest: hash(JSON.stringify(body)) };
}
export function verifyRecord(record, snapshot = workspaceSnapshot()) {
  const { recordDigest, ...body } = record;
  assert.equal(recordDigest, hash(JSON.stringify(body)), 'Evidence record checksum changed');
  assert.deepEqual(
    record.source.workspaceFiles,
    snapshot,
    'Frozen workspace source/document drift',
  );
  assert.equal(record.productionAccepted, false);
}

// Each row has an owning handler, a focused executed test and its execution category.
const central = 'apps/thaarei-control-plane/src/server/',
  customer = 'apps/turnstile-api/src/modules/',
  fixture = 'scripts/fixtures/';
const coverage = [
  ['module-service.ts', 'control-plane-modules.mjs', 'integration'],
  ['module-service.ts', 'control-plane-modules.mjs', 'integration'],
  ['module-assignment-service.ts', 'control-plane-module-assignments.mjs', 'integration'],
  ['module-assignment-service.ts', 'control-plane-module-assignments.mjs', 'integration'],
  ['module-assignment-service.ts', 'control-plane-module-assignments.mjs', 'integration'],
  ['installation-intent-service.ts', 'installation-handover.mjs', 'installer'],
  ['scripts/assemble-module-runtime.mjs', 'scripts/test-selected-module-images.mjs', 'selected'],
  ['scripts/module-delivery.mjs', 'scripts/module-delivery.test.mjs', 'test'],
  ['module-handover-service.ts', 'installation-handover.mjs', 'installer'],
  ['module-decision-policy.ts', 'turnstile-module-decisions.mjs', 'integration'],
  [
    `${customer}module-access/module-access.service.ts`,
    'scripts/test-auth-browser.mjs',
    'selected',
  ],
  [
    `${customer}module-access/module-access.controller.ts`,
    'scripts/test-auth-browser.mjs',
    'selected',
  ],
  ['apps/turnstile-web/src/features', 'scripts/test-auth-browser.mjs', 'selected'],
  ['module-transition-service.ts', 'scripts/test-module-cutover-browser.mjs', 'cutover'],
  ['packages/deployment-control/src/verifier.ts', 'turnstile-module-decisions.mjs', 'integration'],
  ['scripts/module-cutover.mjs', 'scripts/test-module-cutover-browser.mjs', 'cutover'],
  [
    'packages/deployment-control/src/module-release.ts',
    'scripts/test-module-cutover-browser.mjs',
    'cutover',
  ],
  ['module-handover-service.ts', 'installation-handover.mjs', 'installer'],
  ['packages/installation-engine/src/jobs.ts', 'scripts/test-installation-jobs.mjs', 'installer'],
  ['scripts/module-release-evidence.mjs', 'scripts/module-release-evidence.test.mjs', 'evidence'],
];
function requirementLedger() {
  const lines = readFileSync('docs/turnstile/modules/module_delivery_specification.md', 'utf8')
    .split('\n')
    .filter((s) => /^\| MOD-R\d{2} \|/.test(s));
  assert.equal(lines.length, 20);
  return lines.map((line, i) => {
    const [, id, title, text] = line.split('|').map((s) => s.trim()),
      [owner, test, execution] = coverage[i];
    assert.equal(id, `MOD-R${String(i + 1).padStart(2, '0')}`);
    const references = [
      owner.includes('/') ? owner : central + owner,
      test.includes('/') ? test : fixture + test,
    ];
    // Directory evidence is expanded in the immutable workspace file inventory.
    for (const path of references) assert.ok(lstatSync(path));
    return {
      id,
      title,
      requirementDigest: hash(text),
      references,
      execution,
      acceptance: 'local-poc-evidence; target acceptance pending',
      limitations:
        i === 10
          ? 'Future jobs require the same guard when implemented; this POC has landing services only.'
          : i === 13
            ? 'Disconnected installations restrict at bounded authority expiry; no remote instantaneous revocation.'
            : i === 17
              ? 'Reported inventory and acknowledgement are claims, not attestation or user authorization.'
              : i === 19
                ? 'No independent human/production sign-off; see pending target gates.'
                : null,
    };
  });
}
async function freeze(configFile, output) {
  assert.equal(resolve(output), resolve(reportPath), 'Use the declared public record location');
  const c = JSON.parse(protectedFile(configFile)),
    f = JSON.parse(protectedFile(c.fixtureFile));
  const verified = await verifyArtifacts(f.bundleDirectory, join(f.root, 'release-trust.json'));
  assert.equal(verified.release.sourceDigest, hash(JSON.stringify(sourceInventory())));
  const q = JSON.parse(protectedFile(join(c.selectedDirectory, 'qualification.json')));
  assert.equal(q.ordinaryLoginModuleAcceptance, true);
  assert.equal(q.profiles.length, 4);
  const selectedProfiles = [];
  for (const p of q.profiles) {
    assert.match(p.profileDigest, /^[a-f0-9]{64}$/);
    const dir = join(c.selectedDirectory, p.profileDigest),
      d = JSON.parse(readFileSync(join(dir, 'delivery.json'), 'utf8'));
    assert.equal(d.request.profile.sourceDigest, verified.release.sourceDigest);
    const evidence = await verifyBundle(dir, d.request, f.releaseTrust);
    assert.equal(evidence.inventory.releaseId, p.releaseId);
    assert.deepEqual(evidence.inventory.images, p.images);
    selectedProfiles.push({
      profileDigest: d.request.profileDigest,
      modules: d.request.profile.modules,
      releaseId: evidence.inventory.releaseId,
      images: evidence.inventory.images,
    });
  }
  assert.deepEqual(
    selectedProfiles
      .map((p) =>
        p.modules
          .map((m) => m.id)
          .sort()
          .join('+'),
      )
      .sort(),
    [
      'foundation',
      'foundation+incident-management',
      'foundation+risk-management',
      'foundation+incident-management+risk-management',
    ].sort(),
    'All four distinct profiles required',
  );
  const rawFresh = JSON.parse(protectedFile(c.freshReceipt)),
    a = rawFresh.appliedSnapshot.acknowledged;
  // Explicit safe projection: never copy an extensible private receipt wholesale.
  const fresh = {
    version: rawFresh.version,
    passed: rawFresh.passed,
    scope: rawFresh.scope,
    releaseId: rawFresh.releaseId,
    profileDigest: rawFresh.profileDigest,
    installationId: rawFresh.installationId,
    sourceDigest: rawFresh.sourceDigest,
    catalogueDigest: rawFresh.catalogueDigest,
    productionAccepted: rawFresh.productionAccepted,
    appliedSnapshot: {
      binding: binding.parse(rawFresh.appliedSnapshot.binding),
      desiredRevision: rawFresh.appliedSnapshot.desiredRevision,
      products: rawFresh.appliedSnapshot.products.map(
        ({ product, productId, policyState, revision, paired, acknowledged }) => ({
          product,
          productId,
          policyState,
          revision,
          paired,
          acknowledged,
        }),
      ),
      acknowledged: {
        epoch: a.epoch,
        decisionId: a.decisionId,
        policyRevision: a.policyRevision,
        decisionSequence: a.decisionSequence,
        appliedAt: a.appliedAt,
        receivedAt: a.receivedAt,
        expiresAt: a.expiresAt,
        catalogueDigest: a.catalogueDigest,
        profileDigest: a.profileDigest,
        assignmentRevision: a.assignmentRevision,
        allowedIds: a.allowedIds,
      },
    },
  };
  assert.equal(fresh.passed, true);
  assert.equal(fresh.productionAccepted, false);
  assert.equal(fresh.profileDigest, verified.release.module.profileDigest);
  assert.equal(fresh.sourceDigest, verified.release.sourceDigest);
  assert.equal(fresh.releaseId, verified.release.module.releaseId);
  assert.equal(fresh.installationId, fresh.appliedSnapshot.binding.installationId);
  assert.equal(
    fresh.appliedSnapshot.acknowledged.catalogueDigest,
    verified.release.module.catalogueDigest,
  );
  assert.equal(
    fresh.appliedSnapshot.acknowledged.profileDigest,
    verified.release.module.profileDigest,
  );
  assert.deepEqual(fresh.appliedSnapshot.acknowledged.allowedIds, [
    'foundation',
    'incident-management',
  ]);
  assert.equal(
    fresh.appliedSnapshot.desiredRevision,
    fresh.appliedSnapshot.acknowledged.assignmentRevision,
  );
  const required = [
    'check',
    'build',
    'test',
    'integration',
    'selected',
    'cutover',
    'installer',
    'evidence',
    'inventories',
  ];
  assert.deepEqual(c.runs.map((r) => r.id).sort(), required.sort());
  const runs = c.runs.map((r) => {
    assert.equal(r.exitCode, 0);
    const images = (r.images ?? []).map(({ role, id }) => {
      assert.ok(
        ['central', 'dms-api', 'turnstile-api', 'turnstile-web', 'engine', 'postgres'].includes(
          role,
        ),
      );
      assert.match(id, /^sha256:[a-f0-9]{64}$/);
      assert.equal(
        execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', id], {
          encoding: 'utf8',
        }).trim(),
        id,
      );
      return { role, id };
    });
    return {
      id: r.id,
      command: r.command,
      exitCode: r.exitCode,
      kind: r.kind,
      limitations: r.limitations,
      logDigest: hash(readFileSync(r.log)),
      images,
    };
  });
  const legal = JSON.parse(protectedFile(join(c.legalDirectory, 'inventory.json')));
  assert.deepEqual(
    legal.images.map(({ role, id }) => ({ role, id })),
    verified.release.images,
  );
  for (const image of legal.images)
    for (const file of image.files)
      assert.equal(hash(readFileSync(join(c.legalDirectory, file.name))), file.digest);
  const cutover = JSON.parse(protectedFile(join(c.cutoverDirectory, 'fixture.json')));
  const cutoverProfiles = [];
  for (const b of cutover.bundles) {
    assert.equal(b.request.profile.sourceDigest, verified.release.sourceDigest);
    const evidence = await verifyBundle(b.directory, b.request, f.releaseTrust, { images: false });
    assert.equal(evidence.inventory.releaseId, b.inventory.releaseId);
    cutoverProfiles.push({
      catalogue: b.request.catalogue,
      profile: b.request.profile,
      catalogueDigest: b.request.profile.catalogueDigest,
      profileDigest: b.request.profileDigest,
      releaseId: b.inventory.releaseId,
      images: b.inventory.images,
    });
  }
  assert.match(c.centralImage, /^sha256:[a-f0-9]{64}$/);
  assert.equal(
    execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', c.centralImage], {
      encoding: 'utf8',
    }).trim(),
    c.centralImage,
  );
  const record = seal({
    version: 1,
    scope: 'local-linux-amd64-module-poc',
    createdAt: new Date().toISOString(),
    productionAccepted: false,
    source: {
      selectedDigest: verified.release.sourceDigest,
      gitHeadContextOnly: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      identity:
        'Exact file bytes and executable flags; uncommitted workspace, not a committed release.',
      workspaceFiles: workspaceSnapshot(),
    },
    contracts: {
      engine: verified.release.engineVersion,
      customerManifest: 1,
      catalogueProfileIntent: 1,
      turnstileDecision: 2,
      independentDmsDecision: 1,
    },
    environment: {
      node: process.version,
      pnpm: execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim(),
      docker: execFileSync(
        'docker',
        ['version', '--format', '{{.Server.Version}} / {{.Server.Os}}/{{.Server.Arch}}'],
        { encoding: 'utf8' },
      ).trim(),
    },
    independentCentralImage: c.centralImage,
    candidate: {
      ...verified.release,
      manifestDigest: hash(readFileSync(join(f.bundleDirectory, 'installation.json'))),
    },
    catalogue: verified.installed.request.catalogue,
    profile: verified.installed.request.profile,
    selectedProfiles,
    cutoverProfiles,
    fresh,
    runs,
    legal,
    requirements: requirementLedger(),
    pendingTargetGates: [
      'Independent human replay and accountable acceptance',
      'Separate clean Linux/Dokploy host, canonical production DNS/TLS/mail',
      'Off-host restoration and target recovery',
      'Authenticated production HTTPS distribution adapter and protected transfer',
      'Complete corresponding-source retention/review and redistribution sign-off',
      'Real document processing and capacity acceptance under owning IA/DMS gates',
      'Proposed public scoped proof UX under IA-I06; current protected private proof remains required',
    ],
  });
  const formatted = execFileSync(
    'pnpm',
    ['exec', 'biome', 'format', `--stdin-file-path=${output}`],
    { input: JSON.stringify(record), encoding: 'utf8', maxBuffer: 16 * 1024 ** 2 },
  );
  writeFileSync(output, formatted, { flag: 'wx', mode: 0o644 });
  console.log(
    `Frozen local evidence: ${record.recordDigest}. Production acceptance remains false.`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === 'freeze' && process.argv.length === 5)
      await freeze(process.argv[3], process.argv[4]);
    else {
      assert.equal(process.argv.length, 4);
      assert.equal(process.argv[2], 'verify');
      verifyRecord(JSON.parse(readFileSync(process.argv[3], 'utf8')));
      console.log(
        'Frozen evidence checksum and exact workspace source/document inventory verified.',
      );
    }
  } catch (error) {
    console.error(
      `Module evidence stopped (${error instanceof Error ? error.name : 'Error'}); inspect protected inputs and source drift locally.`,
    );
    process.exitCode = 1;
  }
}
