import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { parse, stringify } from 'yaml';

const version = JSON.parse(readFileSync('deploy/distribution/release.json', 'utf8'));
const args = process.argv.slice(2),
  option = (name) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
assert.ok(args.includes('--output'), 'Use --output <new private candidate directory>');
const output = resolve(option('--output'));
assert.ok(
  !existsSync(output) || (args.includes('--resume') && existsSync(join(output, 'CANDIDATE.json'))),
  'Refuse an existing candidate; use --resume explicitly',
);
mkdirSync(output, { recursive: true, mode: 0o700 });
const structured = args.includes('--structured');
if (existsSync(join(output, 'CANDIDATE.json'))) {
  const previous = JSON.parse(readFileSync(join(output, 'CANDIDATE.json'), 'utf8'));
  assert.equal(previous.version, version.version);
  if (previous.structured !== undefined)
    assert.equal(previous.structured, structured, 'Resume the same profile selection');
}
const previousRelease = existsSync(join(output, 'bundle/RELEASE.json'))
  ? JSON.parse(readFileSync(join(output, 'bundle/RELEASE.json'), 'utf8'))
  : undefined;
assert.ok(
  Array.isArray(version.sourceContacts) &&
    version.sourceContacts.length > 0 &&
    version.sourceContacts.every(
      (contact) =>
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) &&
        readFileSync('deploy/distribution/COVERED_SOURCE_OFFER.txt', 'utf8').includes(contact),
    ),
  'Configure the complete covered-source contacts and offer',
);
writeFileSync(
  join(output, 'CANDIDATE.json'),
  JSON.stringify({ version: version.version, structured }),
  {
    mode: 0o600,
  },
);
assert.ok(
  !existsSync(join(output, 'bundle')) ||
    !readdirSync(join(output, 'bundle')).some(
      (name) => name.startsWith('.dms-') || name.startsWith('.env.'),
    ),
  'Never re-export an initialized installation',
);
mkdirSync(join(output, 'logs'), { recursive: true });
const command = (cmd, values, extra = {}) => {
  const result = spawnSync(cmd, values, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...extra,
  });
  if (result.status !== 0)
    writeFileSync(
      join(output, 'logs', 'command-failure.log'),
      `${result.stdout}\n${result.stderr}`,
      { mode: 0o600 },
    );
  assert.equal(result.status, 0, `${cmd} failed; inspect private candidate logs`);
  return result.stdout?.trim() ?? '';
};
assert.ok(option('--syft'), 'Supply the checksum-verified pinned Syft binary with --syft');
const syft = resolve(option('--syft'));
assert.ok(
  command(syft, ['version']).includes(`Version:       ${version.sbom.version}`),
  'Pinned Syft required',
);
const selected = version.images.filter((image) => !image.optional || args.includes('--structured'));
const images = [];
for (const image of selected) {
  if (!args.includes('--reuse-images')) {
    const result = spawnSync(
      'docker',
      [
        'build',
        '--platform',
        version.platform,
        '--build-arg',
        `DMS_RELEASE=${version.version}`,
        '-f',
        image.dockerfile,
        ...(image.target ? ['--target', image.target] : []),
        '-t',
        image.name,
        '.',
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    writeFileSync(
      join(output, 'logs', `${image.name.split(':')[0]}.build.log`),
      `${result.stdout}\n${result.stderr}`,
      { mode: 0o600 },
    );
    assert.equal(result.status, 0, 'Candidate image build failed');
  } else {
    assert.equal(
      previousRelease?.version,
      version.version,
      'An existing assembled release is required',
    );
    assert.equal(
      command('docker', ['image', 'inspect', '--format', '{{.Id}}', image.name]),
      previousRelease?.images.find((previous) => previous.name === image.name)?.id,
      'Reuse only exact previously assembled image IDs',
    );
  }
  images.push({
    name: image.name,
    id: command('docker', ['image', 'inspect', '--format', '{{.Id}}', image.name]),
  });
}
const foundation = parse(readFileSync('deploy/compose.dms.yaml', 'utf8'));
const work = parse(readFileSync('deploy/compose.dms-work.yaml', 'utf8'));
const sources = {
  postgres: foundation.services.postgres.image,
  broker: work.services['work-broker'].image,
};
for (const [component, image] of Object.entries(sources)) {
  assert.match(image, /@sha256:[a-f0-9]{64}$/);
  if (spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status !== 0)
    command('docker', ['pull', '--platform', version.platform, image]);
  const name = `thaarei-dms-bundled-${component}:${version.version}`;
  command('docker', ['tag', image, name]);
  images.push({
    name,
    id: command('docker', ['image', 'inspect', '--format', '{{.Id}}', name]),
    upstream: image,
  });
}
const bundle = join(output, 'bundle');
mkdirSync(bundle, { recursive: true, mode: 0o700 });
for (const name of readdirSync('deploy').filter(
  (name) =>
    name.startsWith('compose.dms') ||
    name === 'compose.storage.yaml' ||
    name.endsWith('.env.example'),
)) {
  mkdirSync(join(bundle, 'deploy'), { recursive: true });
  cpSync(join('deploy', name), join(bundle, 'deploy', name));
}
const assets = [
  'deploy/assessment/Dockerfile',
  'deploy/assessment/clamd.conf',
  'deploy/assessment/scanner-seccomp.json',
  'deploy/assessment/MOBY-PROFILES-LICENSE',
  'deploy/assessment/legal/source.json',
  'deploy/storage/Dockerfile',
  'deploy/storage/SEAWEEDFS-LICENSE',
  'deploy/storage/seaweed-entrypoint.sh',
  'deploy/work/rabbitmq.conf',
  'deploy/distribution/release.json',
  'deploy/distribution/dms',
  'deploy/distribution/compose.runtime.yaml',
  'deploy/distribution/compose.structured.yaml',
  'deploy/distribution/clamd.conf',
  'deploy/distribution/freshclam.conf',
  'deploy/distribution/rabbitmq.conf',
  'deploy/distribution/import-signatures.sh',
  'deploy/distribution/COVERED_SOURCE_OFFER.txt',
];
const clamLegal = JSON.parse(readFileSync('deploy/assessment/legal/source.json', 'utf8'));
for (const file of clamLegal.files) {
  assert.ok(
    file === 'README.md' || file === 'COPYING.txt' || /^COPYING\/[A-Za-z0-9_.-]+$/.test(file),
    'Unexpected upstream license path',
  );
  assets.push(`deploy/assessment/legal/${file}`);
}
for (const file of assets) {
  const destination = join(bundle, file);
  mkdirSync(resolve(destination, '..'), { recursive: true });
  cpSync(file, destination);
}
mkdirSync(join(bundle, 'docs'), { recursive: true });
mkdirSync(join(bundle, 'docs/runbooks'), { recursive: true });
cpSync('docs/runbooks/authentication.md', join(bundle, 'docs/runbooks/authentication.md'));
mkdirSync(join(bundle, 'docs/api'), { recursive: true });
for (const name of readdirSync('docs/api').filter(
  (name) => name.startsWith('dms') && name.endsWith('.json'),
))
  cpSync(join('docs/api', name), join(bundle, 'docs/api', name));
for (const name of readdirSync('docs/runbooks').filter((name) => name.startsWith('dms-')))
  cpSync(join('docs/runbooks', name), join(bundle, 'docs/runbooks', name));
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES', 'architecture.md'])
  cpSync(file, join(bundle, file));
cpSync('deploy/distribution/dms', join(bundle, 'dms'));
mkdirSync(join(bundle, 'sbom'), { recursive: true });
mkdirSync(join(bundle, 'legal'), { recursive: true });
mkdirSync(join(bundle, 'sources'), { recursive: true });
cpSync('deploy/distribution/COVERED_SOURCE_OFFER.txt', join(bundle, 'COVERED_SOURCE_OFFER.txt'));
const sourceAccess = [];
for (const image of images) {
  const name = image.name.split(':')[0],
    base = join(bundle, 'sbom', name);
  const reusable =
    args.includes('--reuse-images') &&
    previousRelease?.images.some(
      (previous) => previous.name === image.name && previous.id === image.id,
    ) &&
    [
      `${base}.spdx.json`,
      `${base}.syft.json`,
      join(bundle, 'legal', `${name}.json`),
      join(bundle, 'legal', `${name}.tar.gz`),
    ].every(existsSync);
  if (!reusable)
    command(
      syft,
      [
        'scan',
        `docker:${image.name}`,
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
  assert.ok(sbom.artifacts.length > 0, 'Empty SBOM');
  for (const artifact of sbom.artifacts) {
    const licenses = artifact.licenses.map((item) => item.spdxExpression ?? item.value);
    assert.ok(
      !licenses.some((value) => /AGPL|SSPL|BUSL|NonCommercial/i.test(value)),
      `Unapproved distribution license in ${name}; inspect SBOM`,
    );
    sourceAccess.push({
      image: image.id,
      name: artifact.name,
      version: artifact.version,
      type: artifact.type,
      purl: artifact.purl,
      licenses,
      source: artifact.metadata?.source ?? null,
      sourceVersion: artifact.metadata?.sourceVersion ?? null,
      upstream: artifact.metadata?.url ?? artifact.metadata?.homepage ?? null,
    });
  }
  if (reusable) continue;
  const container = command('docker', ['create', image.name]),
    tar = join(output, `${name}.rootfs.tar`);
  try {
    command('docker', ['export', container, '-o', tar]);
    const counts = command('python3', [
      'scripts/collect-dms-notices.py',
      tar,
      join(bundle, 'legal', `${name}.tar.gz`),
    ]);
    writeFileSync(join(bundle, 'legal', `${name}.json`), `${counts}\n`);
  } finally {
    command('docker', ['rm', '--volumes', container]);
    rmSync(tar, { force: true });
  }
}
const overlay = { services: {} };
const aliases = {
  postgres: 'postgres',
  'work-broker': 'broker',
  'broker-init': 'broker',
  'dms-scan': 'scanner',
  'signature-updater': 'scanner',
  'signatures-init': 'scanner',
  'signature-import': 'scanner',
};
for (const [service, component] of Object.entries(aliases))
  overlay.services[service] = {
    image: `thaarei-dms-bundled-${component}:${version.version}`,
    pull_policy: 'never',
  };
writeFileSync(join(bundle, 'deploy/distribution/compose.images.yaml'), stringify(overlay));
for (const entry of ['compose.dms-complete.yaml', 'compose.dms-complete-structured.yaml']) {
  const document = parse(readFileSync(join(bundle, 'deploy', entry), 'utf8'));
  document.include[0].path.push('distribution/compose.images.yaml');
  writeFileSync(join(bundle, 'deploy', entry), stringify(document));
}
writeFileSync(
  join(bundle, 'images.lock'),
  `${images.map((image) => `${image.name}\t${image.id}`).join('\n')}\n`,
);
writeFileSync(
  join(bundle, 'source-access.json'),
  `${JSON.stringify(
    {
      version: version.version,
      contacts: version.sourceContacts,
      offer: 'COVERED_SOURCE_OFFER.txt',
      components: sourceAccess,
      serviceSources: {
        rabbitmq: 'https://github.com/rabbitmq/rabbitmq-server/tree/v4.3.7',
        clamav: 'https://github.com/Cisco-Talos/clamav/tree/clamav-1.5.1',
        debian: 'https://sources.debian.org/',
        alpine: 'https://gitlab.alpinelinux.org/alpine/aports',
      },
    },
    null,
    2,
  )}\n`,
);
for (const file of [
  'apps/dms-api/Dockerfile',
  'apps/dms-processing/Dockerfile',
  'deploy/storage/Dockerfile',
  'pnpm-lock.yaml',
  'apps/dms-processing/uv.lock',
  'apps/dms-processing/src/turnstile_processing/structure-models.json',
]) {
  const path = join(bundle, 'sources', file);
  mkdirSync(resolve(path, '..'), { recursive: true });
  cpSync(file, path);
}
const executionContract = JSON.parse(
  readFileSync('apps/dms-processing/src/turnstile_processing/work-contract.json', 'utf8'),
);
writeFileSync(
  join(bundle, 'sources/bundled-assets.json'),
  `${JSON.stringify(
    {
      ocr: executionContract.extraction.ocr,
      structure: structured ? executionContract.extraction.structure : null,
      models: structured
        ? JSON.parse(
            readFileSync(
              'apps/dms-processing/src/turnstile_processing/structure-models.json',
              'utf8',
            ),
          )
        : null,
      scanner: JSON.parse(readFileSync('deploy/assessment/legal/source.json', 'utf8')),
      tika: {
        version: '4.2.0',
        archiveSha512: readFileSync('apps/dms-processing/Dockerfile', 'utf8').match(
          /sha512\(path.read_bytes\(\)\).hexdigest\(\) == '([a-f0-9]{128})'/,
        )?.[1],
      },
      licenses:
        'THIRD_PARTY_NOTICES, actual per-image legal archives and retained upstream model agreements',
    },
    null,
    2,
  )}\n`,
);
writeFileSync(
  join(bundle, 'RELEASE.json'),
  `${JSON.stringify(
    {
      ...version,
      createdAt: new Date().toISOString(),
      images,
      qualified: false,
      scope: 'Local candidate only; customer release and target acceptance require I20 evidence.',
    },
    null,
    2,
  )}\n`,
);
command('docker', ['save', '-o', join(bundle, 'images.tar'), ...images.map((image) => image.name)]);
const files = [];
function walk(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile() && file !== join(bundle, 'SHA256SUMS')) files.push(file);
  }
}
walk(bundle);
const sums = [];
for (const file of files) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  sums.push(`${hash.digest('hex')}  ${file.slice(bundle.length + 1)}`);
}
writeFileSync(join(bundle, 'SHA256SUMS'), `${sums.join('\n')}\n`);
console.log(
  JSON.stringify({ version: version.version, images: images.length, bundle, qualified: false }),
);
