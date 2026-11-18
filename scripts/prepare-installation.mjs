import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { decodeJwt } from 'jose';
import {
  preparePrivateFiles,
  protectedFile,
  rawEnvironment,
} from '../packages/deployment-control/dist/index.js';
import { installationIntent } from '../packages/module-catalog/dist/index.js';
import { verifyInstallationIntent } from './installation-intent.mjs';
import { run } from './module-artifacts.mjs';
import { readJson, verifyBundle } from './module-delivery.mjs';

const digest = (v) => createHash('sha256').update(v).digest('hex');
const inputKeys = [
  'directory',
  'bundleDirectory',
  'centralTrustFile',
  'releaseTrustFile',
  'intentFile',
  'dmsImage',
  'authorityOrigin',
  'resourceOrigin',
  'transferOrigin',
  'ingressNetwork',
  'smtp',
  'turnstileSmtp',
  'structured',
];
export async function prepareInstallation(raw) {
  assert.ok(
    process.platform === 'linux' && typeof process.getuid === 'function',
    'Run the private initializer in Linux/WSL',
  );
  assert.ok(
    raw && typeof raw === 'object' && !Array.isArray(raw),
    'Private operator configuration required',
  );
  assert.ok(
    Object.keys(raw).every((k) => inputKeys.includes(k)),
    'Unknown operator input',
  );
  const c = { ...raw, structured: raw.structured ?? false };
  for (const key of [
    'directory',
    'bundleDirectory',
    'centralTrustFile',
    'releaseTrustFile',
    'intentFile',
  ])
    assert.ok(
      typeof c[key] === 'string' && isAbsolute(c[key]) && !c[key].startsWith('\\'),
      'Use absolute Linux/WSL paths, not Windows UNC paths',
    );
  assert.match(
    c.dmsImage,
    /^sha256:[a-f0-9]{64}$/,
    'Pin the independent DMS image by content identity',
  );
  assert.equal(
    run('docker', ['image', 'inspect', '--format', '{{.Id}}', c.dmsImage]),
    c.dmsImage,
    'Load the verified independent DMS image locally before preparation',
  );
  const token = readJson(c.intentFile).intent,
    untrusted = installationIntent.parse(decodeJwt(token));
  const descriptor = readJson(join(c.bundleDirectory, 'delivery.json')),
    request = descriptor.request;
  const expected = {
    binding: untrusted.binding,
    dmsProductId: untrusted.dmsProductId,
    profileDigest: request.profileDigest,
    releaseId: untrusted.releaseId,
    assignmentRevision: untrusted.desired.assignmentRevision,
    intentRevision: untrusted.intentRevision,
  };
  const trust = readJson(c.centralTrustFile, 32768),
    intent = await verifyInstallationIntent(token, trust, expected);
  assert.equal(intent.mode, 'fresh', 'Fresh preparation cannot adopt an existing installation');
  assert.match(
    intent.customerKey,
    /^[a-z0-9][a-z0-9-]{0,47}$/,
    'Customer key is incompatible with owning configuration',
  );
  const proof = await verifyBundle(c.bundleDirectory, request, readJson(c.releaseTrustFile, 32768));
  assert.equal(proof.inventory.releaseId, intent.releaseId, 'Intent/package release mismatch');
  assert.equal(
    request.profile.catalogueDigest,
    intent.desired.catalogueDigest,
    'Intent/catalogue mismatch',
  );
  const assertCurrent = async () => {
    const response = await fetch(`${trust.issuer}/api/installation-intents/status`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intent: token }),
      signal: AbortSignal.timeout(10000),
    });
    assert.ok(response.ok, 'Central freshness check unavailable; retain preparation and retry');
    assert.deepEqual(
      await response.json(),
      { current: true },
      'Desired assignment/package changed; reconcile without resetting configuration',
    );
  };
  await assertCurrent();
  const apiImageForValidation = `sha256:${proof.inventory.images.find((i) => i.role === 'turnstile-api').digest}`;
  const dmsInput = {
    authorityOrigin: c.authorityOrigin,
    resourceOrigin: c.resourceOrigin,
    transferOrigin: c.transferOrigin,
    customerKey: intent.customerKey,
    tenantId: intent.binding.tenantId,
    localInstallationId: intent.binding.localInstallationId,
    combined: true,
    ingressNetwork: c.ingressNetwork,
    smtp: c.smtp,
    structured: c.structured,
    browserOrigins: [c.authorityOrigin],
  };
  const productInput = (url) => ({
    tenantId: intent.binding.tenantId,
    localInstallationId: intent.binding.localInstallationId,
    applicationId: intent.binding.applicationId,
    customerKey: intent.customerKey,
    publicOrigin: c.authorityOrigin,
    dmsOrigin: c.resourceOrigin,
    provisionDatabaseUrl: url,
    smtp: c.turnstileSmtp,
  });
  for (const [image, input] of [
    [c.dmsImage, dmsInput],
    [
      apiImageForValidation,
      productInput('postgresql://workspace:validation-only@postgres:5432/dms'),
    ],
  ]) {
    run(
      'docker',
      [
        'run',
        '--rm',
        '-i',
        '--network',
        'none',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--user',
        `${process.getuid()}:${process.getgid()}`,
        image,
        'node',
        'dist/infrastructure/distribution/initialize.js',
        '--validate',
      ],
      { input: JSON.stringify(input) },
    );
  }
  const repository = resolve(import.meta.dirname, '..'),
    destination = resolve(c.directory);
  if (destination === repository || destination.startsWith(`${repository}/`))
    assert.ok(
      destination
        .slice(repository.length + 1)
        .split('/')
        .some((name) => name.startsWith('.dms-')),
      'Use an ignored .dms-* directory or a private directory outside the repository',
    );
  const root = resolve(c.directory),
    journal = join(root, '.installation-preparation.json');
  if (existsSync(root)) {
    assert.ok(
      lstatSync(root).isDirectory() &&
        !lstatSync(root).isSymbolicLink() &&
        (lstatSync(root).mode & 0o077) === 0,
      'Private preparation directory required',
    );
    if (!existsSync(journal))
      assert.equal(
        readdirSync(root).length,
        0,
        'Existing installation cannot be replaced or adopted',
      );
  } else mkdirSync(root, { recursive: true, mode: 0o700 });
  const apiImage = `sha256:${proof.inventory.images.find((i) => i.role === 'turnstile-api').digest}`;
  const binding = {
    binding: intent.binding,
    dmsProductId: intent.dmsProductId,
    desired: intent.desired,
    releaseId: intent.releaseId,
    environment: intent.environment,
    customerKey: intent.customerKey,
  };
  const settings = {
    authorityOrigin: c.authorityOrigin,
    resourceOrigin: c.resourceOrigin,
    transferOrigin: c.transferOrigin,
    ingressNetwork: c.ingressNetwork,
    smtp: c.smtp,
    turnstileSmtp: c.turnstileSmtp,
    structured: c.structured,
  };
  // The identity/config plan is committed before invoking either owning initializer.
  const installFiles = [
    'central-trust.json',
    'module-release.json',
    'module-release-trust.json',
    'dms-marker',
    'turnstile-marker',
    '.env.dms.deployment',
    '.env.turnstile.deployment',
    'installation-binding.json',
  ];
  preparePrivateFiles(
    root,
    'installation',
    {
      binding,
      settings,
      dmsImage: c.dmsImage,
      apiImage,
      centralTrust: trust,
      moduleRelease: { request, attestation: descriptor.attestation },
      moduleReleaseTrust: readJson(c.releaseTrustFile, 32768),
    },
    installFiles,
    () => {
      const deployment = (prefix, productId, folder) =>
        rawEnvironment({
          [`${prefix}ORIGIN`]: trust.issuer,
          [`${prefix}INSTALLATION_ID`]: intent.binding.installationId,
          [`${prefix}PRODUCT_ID`]: productId,
          [`${prefix}VERIFICATION_KEYS_FILE`]: '/run/thaarei/central-trust.json',
          [`${prefix}RECOVERY_MARKER_FILE`]: `/run/thaarei/${folder}-marker`,
          [`${prefix}MACHINE_SECRET_FILE`]: `/run/thaarei/${folder}/product.json`,
        });
      return {
        files: {
          'central-trust.json': JSON.stringify(trust),
          'module-release.json': JSON.stringify({ request, attestation: descriptor.attestation }),
          'module-release-trust.json': JSON.stringify({
            version: 1,
            revision: 1,
            issuer: readJson(c.releaseTrustFile, 32768).issuer,
            keys: readJson(c.releaseTrustFile, 32768).keys.map((k) => ({
              kid: k.kid,
              pem: k.publicKey,
              status: 'active',
              lastIssuedAt: null,
            })),
          }),
          'dms-marker': randomBytes(48).toString('base64url'),
          'turnstile-marker': randomBytes(48).toString('base64url'),
          '.env.dms.deployment': deployment('CONTROL_PLANE_', intent.dmsProductId, 'dms'),
          '.env.turnstile.deployment':
            deployment('TURNSTILE_CONTROL_PLANE_', intent.binding.productId, 'turnstile') +
            rawEnvironment({
              TURNSTILE_MODULE_RELEASE_FILE: '/run/thaarei/module-release.json',
              TURNSTILE_MODULE_RELEASE_TRUST_FILE: '/run/thaarei/module-release-trust.json',
            }),
          'installation-binding.json': JSON.stringify(binding),
        },
        result: { version: 1, binding },
      };
    },
  );
  for (const name of ['dms', 'turnstile']) {
    const dir = join(root, name);
    if (!existsSync(dir)) mkdirSync(dir, { mode: 0o700 });
    assert.ok(
      lstatSync(dir).isDirectory() &&
        !lstatSync(dir).isSymbolicLink() &&
        (lstatSync(dir).mode & 0o077) === 0,
      'Private product state directory required',
    );
  }
  const dockerInput = (image, entry, input) =>
    run(
      'docker',
      [
        'run',
        '--rm',
        '-i',
        '--network',
        'none',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--user',
        `${process.getuid()}:${process.getgid()}`,
        '--mount',
        `type=bind,source=${root},target=/configuration`,
        image,
        'node',
        entry,
      ],
      { input: JSON.stringify(input) },
    );
  dockerInput(c.dmsImage, 'dist/infrastructure/distribution/initialize.js', dmsInput);
  const provision = parseEnv(protectedFile(join(root, '.env.provision')));
  dockerInput(
    apiImage,
    'dist/infrastructure/distribution/initialize.js',
    productInput(provision.PROVISION_DATABASE_URL),
  );
  await assertCurrent();
  // Completion is evidence of preparation only. It never authorizes bootstrap, pairing or business access.
  const files = readdirSync(root)
    .filter(
      (name) =>
        name.startsWith('.env.') ||
        name.endsWith('-marker') ||
        name === 'installation-binding.json' ||
        name === 'central-trust.json' ||
        name === 'module-release.json' ||
        name === 'module-release-trust.json',
    )
    .sort()
    .map((name) => ({ name, digest: digest(protectedFile(join(root, name))) }));
  const receipt = JSON.stringify({
    version: 1,
    binding,
    images: { dms: c.dmsImage, turnstile: apiImage },
    files,
  });
  const target = join(root, 'preparation-receipt.json');
  if (existsSync(target))
    assert.equal(
      protectedFile(target),
      receipt,
      'Prepared files changed; reconcile without resetting',
    );
  else {
    const tmp = join(root, `.receipt-${randomBytes(12).toString('hex')}`);
    writeFileSync(tmp, receipt, { mode: 0o600, flag: 'wx' });
    try {
      linkSync(tmp, target);
    } finally {
      rmSync(tmp);
    }
  }
  return {
    prepared: true,
    installationId: intent.binding.installationId,
    profileDigest: request.profileDigest,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.equal(process.argv.length, 3, 'Supply one protected operator input file');
    const input = JSON.parse(protectedFile(process.argv[2]));
    await prepareInstallation(input);
    console.log(
      'Combined private configuration prepared; independent provisioning, pairing and approval remain required.',
    );
  } catch {
    console.error(
      'Installation preparation stopped; retained identities and private files preserved. Use Linux/WSL paths and inspect current intent/package before retry.',
    );
    process.exitCode = 1;
  }
}
