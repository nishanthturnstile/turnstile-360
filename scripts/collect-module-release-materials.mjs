// External release tooling. Never inspect a running customer container or its state.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { protectedFile } from '../packages/deployment-control/dist/index.js';
import { verifyArtifacts } from '../packages/installation-engine/dist/artifacts.js';
import { run } from './module-artifacts.mjs';
import { hash } from './module-build-source.mjs';

assert.equal(process.argv.length, 5, 'Supply private fixture, verified Syft binary and new output');
const fixture = JSON.parse(protectedFile(process.argv[2])),
  syft = resolve(process.argv[3]),
  output = resolve(process.argv[4]),
  pinned = JSON.parse(readFileSync('deploy/distribution/release.json', 'utf8')).sbom;
// Verify both the pinned archive and the executable extracted from it, not just a version string.
const archive = join(dirname(syft), 'syft.tar.gz');
assert.equal(hash(readFileSync(archive)), pinned.sha256, 'Pinned Syft archive checksum');
assert.equal(
  hash(readFileSync(syft)),
  hash(execFileSync('tar', ['-xOf', archive, 'syft'], { maxBuffer: 128 * 1024 ** 2 })),
  'Syft executable differs from verified archive',
);
assert.ok(run(syft, ['version']).includes(`Version:       ${pinned.version}`));
const { release } = await verifyArtifacts(
  fixture.bundleDirectory,
  join(fixture.root, 'release-trust.json'),
);
mkdirSync(output, { mode: 0o700 });
const images = [];
for (const image of release.images) {
  const base = join(output, image.role);
  run(
    syft,
    [
      'scan',
      `docker:${image.id}`,
      '-q',
      '--scope',
      'squashed',
      '-o',
      `spdx-json=${base}.spdx.json`,
      '-o',
      `syft-json=${base}.syft.json`,
    ],
    {
      env: {
        ...process.env,
        SYFT_CHECK_FOR_APP_UPDATE: 'false',
        SYFT_JAVA_USE_NETWORK: 'false',
        SYFT_GOLANG_SEARCH_REMOTE_LICENSES: 'false',
      },
    },
  );
  const sbom = JSON.parse(readFileSync(`${base}.syft.json`, 'utf8'));
  assert.ok(sbom.artifacts.length > 0, 'Empty image inventory');
  const container = run('docker', ['create', '--network', 'none', image.id]),
    tar = `${base}.rootfs.tar`;
  let legal;
  try {
    run('docker', ['export', container, '-o', tar]);
    legal = JSON.parse(
      run('python3', ['scripts/collect-dms-notices.py', tar, `${base}.legal.tar.gz`]),
    );
  } finally {
    run('docker', ['rm', '--volumes', container]);
    rmSync(tar, { force: true });
  }
  const components = sbom.artifacts.map((a) => ({
    name: a.name,
    version: a.version,
    type: a.type,
    purl: a.purl ?? null,
    licenses: a.licenses.map((l) => l.spdxExpression ?? l.value),
    source: a.metadata?.source ?? null,
    sourceVersion: a.metadata?.sourceVersion ?? null,
    upstream: a.metadata?.url ?? a.metadata?.homepage ?? null,
  }));
  writeFileSync(`${base}.sources.json`, JSON.stringify(components, null, 2), { mode: 0o600 });
  images.push({
    ...image,
    components: components.length,
    undeclaredLicenses: components
      .filter((c) => !c.licenses.length)
      .map((c) => ({ name: c.name, version: c.version })),
    restrictedLicenseDeclarations: components
      .filter((c) => c.licenses.some((l) => /AGPL|SSPL|BUSL|NonCommercial/i.test(l)))
      .map((c) => ({ name: c.name, version: c.version, licenses: c.licenses })),
    legal,
    files: ['spdx.json', 'syft.json', 'sources.json', 'legal.tar.gz'].map((ext) => ({
      name: `${image.role}.${ext}`,
      digest: hash(readFileSync(`${base}.${ext}`)),
    })),
  });
  console.log(`Inventoried exact ${image.role} image and retained upstream notices.`);
}
writeFileSync(
  join(output, 'inventory.json'),
  JSON.stringify(
    {
      version: 1,
      scope: 'five-image-local-module-poc',
      scanner: { tool: pinned.tool, version: pinned.version, verifiedArchiveDigest: pinned.sha256 },
      sourceCompletenessAccepted: false,
      customerDistributionAccepted: false,
      images,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  'Exact-image inventory and legal material collected; source completeness and distribution sign-off remain separate.',
);
