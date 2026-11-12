import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseEnv } from 'node:util';
import { machineStatusResponse, pairingFile, sameBinding } from '@thaarei/control-plane-contracts';
import {
  ProtectedFileStore,
  preparePrivateFiles,
  rawEnvironment,
  readProtectedTrust,
  storedProduct,
  verifyInstallationIntent,
} from '@thaarei/deployment-control';
import { installationIntent } from '@thaarei/module-catalog';
import { decodeJwt } from 'jose';
import { verifyArtifacts } from './artifacts.js';
import {
  ENGINE_VERSION,
  type InstallerInput,
  type InstallerResult,
  installerInput,
  ownerCommand,
  pairingInput,
  retryOpenInput,
  type StageJournal,
  stageJournal,
} from './contracts.js';
import { Docker } from './docker.js';
import { atomic, hash, privateText, protect, writeJson } from './files.js';
import { integrateIdentity } from './identity.js';
import { PrivateJobs } from './jobs.js';
import { startRuntime } from './runtime.js';
import { Unavailable } from './unavailable.js';

const labels = (local: string, operation: string) => ({
  'thaarei.installation': local,
  'thaarei.installer.operation': operation,
});
const safeSettings = (c: InstallerInput) => {
  const { password: _password, ...smtp } = c.smtp;
  return {
    authorityOrigin: c.authorityOrigin,
    resourceOrigin: c.resourceOrigin,
    transferOrigin: c.transferOrigin,
    ingressNetwork: c.ingressNetwork,
    privateSubnet: c.privateSubnet ?? null,
    operatorId: c.operatorId,
    smtp,
    turnstileSmtp: c.turnstileSmtp,
  };
};
const required = (values: Record<string, string>, key: string) => {
  const value = values[key];
  assert.ok(value, `Missing owning configuration field ${key}`);
  return value;
};
const jsonOutput = (text: string): Record<string, unknown> =>
  JSON.parse(text.split('\n').find((l) => l.trim().startsWith('{')) ?? '{}');
export async function execute(
  raw: unknown,
  action: string,
  control?: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<InstallerResult> {
  const uid = process.getuid?.(),
    gid = process.getgid?.();
  assert.ok(
    typeof uid === 'number' && uid > 0 && typeof gid === 'number',
    'A nonroot Linux operator is required',
  );
  const c = installerInput.parse(raw),
    docker = new Docker();
  assert.equal(
    c.directory,
    environment.THAAREI_INSTALLATION_DIRECTORY,
    'Use the bound installation directory',
  );
  assert.equal(
    c.ingressNetwork,
    environment.THAAREI_INSTALLER_NETWORK,
    'Use the selected ingress network',
  );
  protect(c.directory, true);
  assert.equal(
    c.bundleDirectory,
    environment.THAAREI_INSTALLER_BUNDLE_DIRECTORY,
    'Use the mounted release bundle',
  );
  for (const path of [
    c.centralTrustFile,
    c.releaseTrustFile,
    c.intentFile,
    ...(c.caFile ? [c.caFile] : []),
    ...(action === 'pair' ? [pairingInput.parse(control).file] : []),
  ]) {
    assert.equal(
      dirname(path),
      environment.THAAREI_INSTALLER_INPUT_DIRECTORY,
      'Private inputs must be in the mounted input directory',
    );
    protect(path);
  }
  await docker.preflight();
  for (const file of [c.centralTrustFile, c.releaseTrustFile, c.intentFile]) protect(file);
  const mutating = !['plan', 'status', 'verify'].includes(action);
  const retainedRead =
    !mutating && action !== 'plan' && existsSync(join(c.directory, '.installer', 'journal.json'));
  const artifact = await verifyArtifacts(
    c.bundleDirectory,
    c.releaseTrustFile,
    docker,
    mutating,
    true, // Release signatures attest immutable content; current intent below supplies fresh setup authority.
  );
  assert.equal(
    artifact.release.images.find((i) => i.role === 'engine')?.id,
    environment.THAAREI_INSTALLER_IMAGE,
    'Pinned engine differs from release',
  );
  const descriptor = JSON.parse(privateText(c.intentFile)),
    token = descriptor.intent;
  const decoded = installationIntent.parse(decodeJwt(token));
  const intent = await verifyInstallationIntent(
    token,
    await readProtectedTrust(c.centralTrustFile),
    {
      binding: decoded.binding,
      dmsProductId: decoded.dmsProductId,
      profileDigest: artifact.release.module.profileDigest,
      assignmentRevision: decoded.desired.assignmentRevision,
      intentRevision: decoded.intentRevision,
      releaseId: artifact.release.module.releaseId,
    },
    retainedRead
      ? Math.min(decoded.iat, Math.floor(Date.now() / 1000))
      : Math.floor(Date.now() / 1000),
  );
  assert.equal(intent.mode, 'fresh');
  assert.equal(intent.binding.product, 'turnstile');
  const applicationId = intent.binding.applicationId;
  assert.ok(typeof applicationId === 'string');
  const context = {
    binding: intent.binding,
    dmsProductId: intent.dmsProductId,
    desired: intent.desired,
    releaseId: intent.releaseId,
    customerKey: intent.customerKey,
    environment: intent.environment,
  };
  const local = intent.binding.localInstallationId,
    network = `thaarei-${local}`,
    prefix = `thaarei-${local}`;
  const state = join(c.directory, '.installer'),
    journalFile = join(state, 'journal.json');
  const current = async () => {
    const r = await fetch(`${intent.iss}/api/installation-intents/status`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intent: token }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      if (r.status >= 500 || r.status === 429)
        throw new Unavailable('Central intent check unavailable');
      throw new Error('Central intent is no longer valid; renew or reconcile');
    }
    assert.deepEqual(
      await r.json(),
      { current: true },
      'Assignment changed; reconcile retained state',
    );
  };
  if (!retainedRead) await current();
  const image = (role: string) => {
    const found = artifact.release.images.find((i) => i.role === role);
    assert.ok(found);
    return found.id;
  };
  const outcome = (
    conditions: string[],
    nextActor: InstallerResult['nextActor'] = 'operator',
  ): InstallerResult => ({
    version: 1,
    state: conditions.length ? 'waiting' : 'complete',
    nextActor: conditions.length ? nextActor : 'none',
    conditions,
    releaseId: intent.releaseId,
    profileDigest: intent.desired.profileDigest,
    installationId: intent.binding.installationId,
  });
  const readback = async (): Promise<InstallerResult> => {
    if (!existsSync(journalFile)) return outcome(['installation-not-initialized']);
    const j = stageJournal.parse(JSON.parse(privateText(journalFile)));
    assert.deepEqual(j.binding, context);
    assert.equal(j.releaseDigest, hash(JSON.stringify(artifact.release)));
    const conditions: string[] = [];
    if (j.phase !== 'initialized') conditions.push('base-initialization-pending');
    for (const product of ['dms', 'turnstile']) {
      const file = join(c.directory, product, 'product.json');
      if (!existsSync(file)) {
        conditions.push(`${product}-pairing-required`);
        continue;
      }
      const s = storedProduct.parse(JSON.parse(privateText(file)));
      const expected =
        product === 'turnstile'
          ? intent.binding
          : {
              ...intent.binding,
              product: 'dms' as const,
              applicationId: null,
              productId: intent.dmsProductId,
            };
      assert.ok(sameBinding(s.binding, expected));
      assert.equal(s.origin, intent.iss);
      if (s.operation || s.report) conditions.push(`${product}-pending-operation`);
      if (s.decision?.quarantined) conditions.push(`${product}-recovery-reconciliation-required`);
      if (!s.decision?.accepted) conditions.push(`${product}-signed-sync-required`);
      if (s.current) {
        try {
          const response = await fetch(`${s.origin}/api/machine/v1/status`, {
            method: 'POST',
            redirect: 'error',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${s.current.secret}`,
            },
            body: JSON.stringify({ version: 1, binding: s.binding, epoch: s.current.epoch }),
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok) conditions.push(`${product}-central-readback-unavailable`);
          else {
            const read = machineStatusResponse.parse(await response.json());
            if (!read.activationAcknowledged)
              conditions.push(`${product}-approval-acknowledgement-pending`);
            if (read.reportFreshness !== 'current')
              conditions.push(`${product}-report-${read.reportFreshness}`);
            if (
              product === 'turnstile' &&
              read.moduleDesired &&
              (read.moduleDesired.profileDigest !== intent.desired.profileDigest ||
                read.moduleDesired.assignmentRevision !== intent.desired.assignmentRevision)
            )
              conditions.push('assigned-profile-changed-reconciliation-required');
          }
        } catch {
          conditions.push(`${product}-central-readback-unavailable`);
        }
      }
    }
    if (!existsSync(join(c.directory, '.env.clients')))
      conditions.push('verified-identity-client-integration-required');
    if (!existsSync(join(c.directory, 'credentials')))
      conditions.push('verified-customer-administrator-required');
    conditions.push(
      existsSync(join(state, 'handover-open.json'))
        ? 'current-private-release-and-customer-workspace-verification-required'
        : 'private-administrator-handover-and-opening-required',
    );
    conditions.push('processing-and-production-target-acceptance-separate');
    const staff = conditions.some(
      (v) => v.includes('pairing-required') || v.includes('approval-acknowledgement'),
    );
    return outcome(conditions, staff ? 'central-staff' : 'operator');
  };
  if (!mutating) return readback();

  if (!existsSync(state)) {
    assert.equal(
      readdirSync(c.directory).length,
      0,
      'Fresh installer refuses existing unowned state',
    );
    mkdirSync(state, { mode: 0o700 });
  }
  protect(state, true);
  return new ProtectedFileStore(state, join(c.directory, 'turnstile-marker')).locked(async () => {
    let journal: StageJournal;
    if (existsSync(journalFile)) {
      journal = stageJournal.parse(JSON.parse(privateText(journalFile)));
      assert.deepEqual(journal.binding, context, 'Changed intent requires reconciliation');
      assert.equal(journal.releaseDigest, hash(JSON.stringify(artifact.release)));
      assert.deepEqual(journal.settings, safeSettings(c));
      assert.deepEqual(
        JSON.parse(privateText(join(state, journal.privateRequest))),
        c,
        'Retained private settings changed',
      );
    } else {
      assert.ok(['install', 'resume'].includes(action), 'Initialize the fresh installation first');
      writeJson(join(state, 'request.json'), c);
      journal = {
        version: 1,
        engineVersion: ENGINE_VERSION,
        releaseDigest: hash(JSON.stringify(artifact.release)),
        binding: context,
        settings: safeSettings(c),
        jobs: {},
        phase: 'preparing',
        privateRequest: 'request.json',
      };
      writeJson(journalFile, journal);
    }
    const save = () => writeJson(journalFile, journal);
    const env = (files: string[]) =>
      Object.assign({}, ...files.map((f) => parseEnv(privateText(join(c.directory, f))))) as Record<
        string,
        string
      >;
    const ownerEnv = (product: 'dms' | 'turnstile', maintenance = false) => {
      const values = env(
        product === 'dms'
          ? [
              '.env.dms',
              ...(maintenance ? ['.env.dms-maintenance'] : []),
              '.env.integration',
              '.env.coordinator',
              '.env.dms.deployment',
            ]
          : [
              '.env.turnstile',
              ...(maintenance ? ['.env.turnstile.migrate'] : []),
              '.env.turnstile.reporter',
              '.env.turnstile.deployment',
              ...(existsSync(join(c.directory, '.env.clients')) ? ['.env.clients'] : []),
            ],
      );
      if (c.caFile) values.NODE_EXTRA_CA_CERTS = '/run/thaarei/customer-ca.pem';
      return values;
    };
    const jobs = new PrivateJobs({
      docker,
      root: c.directory,
      state,
      network,
      ingress: c.ingressNetwork,
      uid,
      gid,
      local,
      image,
      journal,
      save,
      current,
    });
    const pairRequest = action === 'pair' ? pairingInput.parse(control) : undefined;
    if (action === 'retry-open') {
      const retry = retryOpenInput.parse(control);
      const owned = await docker.json<{ Containers: Record<string, unknown> }>(
        'GET',
        `/networks/${encodeURIComponent(network)}`,
      );
      assert.ok(owned);
      for (const id of Object.keys(owned.Containers)) {
        const process = await docker.inspect(id);
        assert.ok(process);
        assert.equal(process.Config.Labels['thaarei.installation'], local);
        assert.ok(artifact.release.images.some((candidate) => candidate.id === process.Image));
      }
      const output = await jobs.retryOpen(retry.stage, retry.administratorCookie);
      const result = jsonOutput(output);
      assert.equal(result.action, 'release-open');
      assert.equal(result.tenantId, intent.binding.tenantId);
      assert.equal(result.applicationId, applicationId);
      atomic(join(state, 'last-owner-result.json'), output);
      if (result.publicWritesEnabled === true && result.releaseId === intent.releaseId)
        writeJson(join(state, 'handover-open.json'), { stage: retry.stage });
    }
    await jobs.resume(pairRequest?.mode === 'rebind' ? pairRequest.product : undefined);
    const job = jobs.run.bind(jobs);
    const dmsInput = {
      authorityOrigin: c.authorityOrigin,
      resourceOrigin: c.resourceOrigin,
      transferOrigin: c.transferOrigin,
      customerKey: intent.customerKey,
      tenantId: intent.binding.tenantId,
      localInstallationId: local,
      combined: true,
      ingressNetwork: c.ingressNetwork,
      smtp: c.smtp,
      structured: false,
      browserOrigins: [c.authorityOrigin],
    };
    const productInput = (url: string) => ({
      tenantId: intent.binding.tenantId,
      localInstallationId: local,
      applicationId: intent.binding.applicationId,
      customerKey: intent.customerKey,
      publicOrigin: c.authorityOrigin,
      dmsOrigin: c.resourceOrigin,
      provisionDatabaseUrl: url,
      smtp: c.turnstileSmtp,
    });
    if (journal.phase === 'preparing') {
      await job(
        'validate-dms',
        'dms-api',
        'dist/infrastructure/distribution/initialize.js',
        ['--validate'],
        {},
        dmsInput,
      );
      await job(
        'validate-turnstile',
        'turnstile-api',
        'dist/infrastructure/distribution/initialize.js',
        ['--validate'],
        {},
        productInput('postgresql://workspace:validation-only@postgres:5432/dms'),
      );
      const trust = await readProtectedTrust(c.centralTrustFile),
        releaseTrust = await readProtectedTrust(c.releaseTrustFile);
      const names = [
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
        c.directory,
        'installation',
        {
          context,
          settings: safeSettings(c),
          centralTrust: trust,
          moduleRelease: artifact.module,
          moduleTrust: releaseTrust,
        },
        names,
        () => {
          const deployment = (prefix: string, id: string, product: string) =>
            rawEnvironment({
              [`${prefix}ORIGIN`]: intent.iss,
              [`${prefix}INSTALLATION_ID`]: intent.binding.installationId,
              [`${prefix}PRODUCT_ID`]: id,
              [`${prefix}VERIFICATION_KEYS_FILE`]: '/run/thaarei/central-trust.json',
              [`${prefix}RECOVERY_MARKER_FILE`]: `/run/thaarei/${product}-marker`,
              [`${prefix}MACHINE_SECRET_FILE`]: `/run/thaarei/${product}/product.json`,
            });
          return {
            files: {
              'central-trust.json': JSON.stringify(trust),
              'module-release.json': JSON.stringify(artifact.module),
              'module-release-trust.json': JSON.stringify(releaseTrust),
              'dms-marker': randomBytes(48).toString('base64url'),
              'turnstile-marker': randomBytes(48).toString('base64url'),
              '.env.dms.deployment': deployment('CONTROL_PLANE_', intent.dmsProductId, 'dms'),
              '.env.turnstile.deployment':
                deployment('TURNSTILE_CONTROL_PLANE_', intent.binding.productId, 'turnstile') +
                rawEnvironment({
                  TURNSTILE_MODULE_RELEASE_FILE: '/run/thaarei/module-release.json',
                  TURNSTILE_MODULE_RELEASE_TRUST_FILE: '/run/thaarei/module-release-trust.json',
                }),
              'installation-binding.json': JSON.stringify(context),
            },
            result: { version: 1, binding: context },
          };
        },
      );
      for (const product of ['dms', 'turnstile'])
        if (!existsSync(join(c.directory, product)))
          mkdirSync(join(c.directory, product), { mode: 0o700 });
      if (c.caFile) {
        const ca = readFileSync(c.caFile, 'utf8'),
          file = join(c.directory, 'customer-ca.pem');
        if (existsSync(file)) assert.equal(privateText(file), ca);
        else atomic(file, ca);
      }
      await job(
        'configure-dms',
        'dms-api',
        'dist/infrastructure/distribution/initialize.js',
        [],
        {},
        dmsInput,
      );
      const provision = env(['.env.provision']);
      await job(
        'configure-turnstile',
        'turnstile-api',
        'dist/infrastructure/distribution/initialize.js',
        [],
        {},
        productInput(required(provision, 'PROVISION_DATABASE_URL')),
      );
      const product = env(['.env.turnstile']);
      const integration = {
        AUTH_LOGIN_CLIENT_ID: required(product, 'AUTH_LOGIN_CLIENT_ID'),
        AUTH_LOGIN_CALLBACK_URL: required(product, 'AUTH_LOGIN_CALLBACK_URL'),
        DMS_MACHINE_CLIENT_ID: required(product, 'DMS_MACHINE_CLIENT_ID'),
        IDENTITY_SERVICE_CLIENT_ID: required(product, 'IDENTITY_SERVICE_CLIENT_ID'),
        IDENTITY_SERVICE_RESOURCE_URL: required(product, 'IDENTITY_SERVICE_RESOURCE_URL'),
        AUTH_SETUP_COMPLETION_URL: `${c.authorityOrigin}/setup-preparation`,
      };
      preparePrivateFiles(c.directory, 'integration', integration, ['.env.integration'], () => ({
        files: { '.env.integration': rawEnvironment(integration) },
        result: { version: 1 },
      }));
      journal.phase = 'configured';
      save();
    }
    await docker.network(network, local, hash(c.directory), c.privateSubnet);
    await docker.volume(`${prefix}-postgres`, local, hash(c.directory));
    const provision = env(['.env.provision']),
      db = new URL(required(provision, 'PROVISION_DATABASE_URL'));
    const postgresName = `${prefix}-postgres`;
    let postgres = await docker.inspect(postgresName);
    if (!postgres) {
      await current();
      const id = await docker.create(postgresName, {
        Image: image('postgres'),
        Env: [
          `POSTGRES_PASSWORD=${decodeURIComponent(db.password)}`,
          `POSTGRES_USER=${decodeURIComponent(db.username)}`,
          `POSTGRES_DB=${db.pathname.slice(1)}`,
        ],
        Labels: labels(local, 'postgres'),
        HostConfig: {
          NetworkMode: network,
          Memory: 1073741824,
          NanoCpus: 1000000000,
          PidsLimit: 256,
          LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
          Mounts: [{ Type: 'volume', Source: postgresName, Target: '/var/lib/postgresql' }],
        },
        NetworkingConfig: { EndpointsConfig: { [network]: { Aliases: ['postgres'] } } },
      });
      postgres = await docker.inspect(id);
    }
    assert.ok(postgres);
    assert.equal(postgres.Image, image('postgres'));
    assert.equal(postgres.Config.Labels['thaarei.installation'], local);
    assert.ok(
      postgres.Config.Env.includes(`POSTGRES_PASSWORD=${decodeURIComponent(db.password)}`),
      'Retained database configuration changed',
    );
    await docker.start(postgres.Id);
    if (journal.phase === 'configured') {
      let ready = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        try {
          await docker.exec(postgres.Id, [
            'pg_isready',
            '-h',
            '127.0.0.1',
            '-U',
            decodeURIComponent(db.username),
            '-d',
            db.pathname.slice(1),
          ]);
          ready = true;
          break;
        } catch {
          await delay(250);
        }
      }
      assert.ok(ready, 'Private PostgreSQL is not ready; preserve and resume');
      await job(
        'provision-dms',
        'dms-api',
        'maintenance/provision-auth-database.mjs',
        [],
        env(['.env.provision']),
        {},
        network,
      );
      await job(
        'provision-turnstile',
        'dms-api',
        'maintenance/provision-auth-database.mjs',
        [],
        env(['.env.turnstile-provision']),
        {},
        network,
      );
      for (const owner of ['auth', 'dms', 'bootstrap'])
        await job(
          `migrate-${owner}`,
          'dms-api',
          'dist/infrastructure/database/migrate.js',
          [owner],
          env(['.env.dms-maintenance']),
          {},
          network,
        );
      for (const owner of ['turnstile', 'bootstrap'])
        await job(
          `product-${owner}`,
          'turnstile-api',
          'dist/infrastructure/database/migrate.js',
          [owner],
          env(['.env.turnstile.migrate']),
          {},
          network,
        );
      for (const [name, entry] of [
        ['configuration', 'organization/configuration-operator'],
        ['access', 'access/access-operator'],
      ])
        await job(
          `initialize-${name}`,
          'turnstile-api',
          `dist/modules/${entry}.js`,
          ['initialize'],
          env(['.env.turnstile.migrate']),
          { operatorId: c.operatorId },
          network,
        );
      journal.phase = 'initialized';
      save();
    }
    const runtime = () =>
      startRuntime({
        docker,
        root: c.directory,
        local,
        uid,
        gid,
        network,
        ingress: c.ingressNetwork,
        image,
        env,
        current,
        authorityOrigin: c.authorityOrigin,
        resourceOrigin: c.resourceOrigin,
        hasCa: !!c.caFile,
      });
    await runtime();
    if (action === 'pair') {
      const request = pairingInput.parse(control),
        file = pairingFile.parse(JSON.parse(privateText(request.file)));
      const expected =
        request.product === 'turnstile'
          ? intent.binding
          : {
              ...intent.binding,
              product: 'dms' as const,
              productId: intent.dmsProductId,
              applicationId: null,
            };
      assert.ok(sameBinding(file.binding, expected));
      assert.equal(file.origin, intent.iss);
      const name = `pairing-${file.pairingId}.json`;
      const destination = join(c.directory, request.product, name);
      if (existsSync(destination)) assert.equal(privateText(destination), JSON.stringify(file));
      else writeJson(destination, file);
      await job(
        `pair-${request.product}-${file.pairingId}`,
        request.product === 'dms' ? 'dms-api' : 'turnstile-api',
        'dist/modules/deployment/operator.js',
        [],
        ownerEnv(request.product),
        { action: request.mode, pairingFile: `/run/thaarei/${request.product}/${name}` },
        c.ingressNetwork,
      );
      rmSync(destination, { force: true });
    }
    if (action === 'sync')
      for (const product of ['dms', 'turnstile'] as const) {
        if (!existsSync(join(c.directory, product, 'product.json'))) continue;
        for (let round = 0; round < 2; round++)
          await job(
            `sync-${product}-${randomUUID()}`,
            product === 'dms' ? 'dms-api' : 'turnstile-api',
            'dist/modules/deployment/operator.js',
            [],
            ownerEnv(product),
            { action: 'sync' },
            c.ingressNetwork,
          );
      }
    if (action === 'identity')
      await integrateIdentity(
        {
          root: c.directory,
          state,
          applicationId,
          tenantId: intent.binding.tenantId,
          operatorId: c.operatorId,
          authorityOrigin: c.authorityOrigin,
          resourceOrigin: c.resourceOrigin,
          network: c.ingressNetwork,
          env,
          ownerEnv,
          jobs,
          current,
        },
        control,
      );
    if (action === 'owner') {
      const command = ownerCommand.parse(control);
      const mapping = {
        'provision-user': ['dms', 'platform-auth/provision-user'],
        'resend-verification': ['dms', 'platform-auth/provision-user'],
        'authority-client': ['dms', 'platform-auth/manage-client'],
        application: ['dms', 'enrollment/manage-application'],
        'dms-operator': ['dms', 'access/manage-operator'],
        'bootstrap-operator': ['dms', 'access/manage-operator'],
        configuration: ['turnstile', 'organization/configuration-operator'],
        access: ['turnstile', 'access/access-operator'],
        release: ['turnstile', 'access/release-operator'],
        'module-access': ['turnstile', 'module-access/module-access-operator'],
      } as const;
      const [product, entry] = mapping[command.operation];
      // Caller retains one private command file/operation; owning schemas and authority remain authoritative.
      const reference = environment.THAAREI_INSTALLER_COMMAND_REFERENCE;
      assert.ok(reference, 'A retained private command file reference is required');
      const keyFile = join(state, 'request-authentication-key');
      if (!existsSync(keyFile)) atomic(keyFile, randomBytes(48).toString('base64url'));
      const authentication = createHmac('sha256', privateText(keyFile))
        .update(JSON.stringify(command))
        .digest('hex');
      const record = join(state, `owner-${hash(reference)}.request.json`);
      const retained = existsSync(record)
        ? JSON.parse(privateText(record))
        : { id: randomUUID(), authentication };
      assert.equal(
        retained.authentication,
        authentication,
        'Changed owner request requires a new private command file',
      );
      if (!existsSync(record)) writeJson(record, retained);
      const id = retained.id;
      const preparedFile = join(state, `owner-${id}.resolved.json`);
      const readOnly =
        command.subcommand === 'inspect' ||
        command.subcommand === 'verify' ||
        command.subcommand === 'verify-login' ||
        command.input.action === 'inspect';
      const stage = readOnly ? `owner-read-${randomUUID()}` : `owner-${id}`;
      let payload: Record<string, unknown>;
      if (existsSync(preparedFile)) payload = JSON.parse(privateText(preparedFile));
      else {
        payload = { ...command.input };
        if (command.operation === 'authority-client' || command.operation === 'application') {
          if (payload.applicationId !== undefined)
            assert.equal(payload.applicationId, intent.binding.applicationId);
          if (command.operation === 'application' || payload.action === 'issue')
            payload.applicationId = intent.binding.applicationId;
        }
        if (['configuration', 'access', 'release', 'module-access'].includes(command.operation))
          payload.operatorId ??= c.operatorId;
        for (const field of ['userId', 'administratorUserId'])
          if (payload[field] === '@prepared-user')
            payload[field] = jsonOutput(privateText(join(state, 'prepared-user.json'))).userId;
        const mutation =
          command.operation === 'module-access' ||
          (command.operation === 'release' &&
            ['bootstrap-administrator', 'open', 'close', 'recover'].includes(
              command.subcommand ?? '',
            ));
        if (mutation && !journal.jobs[stage]) {
          const latest = jsonOutput(
            await job(
              `revision-${id}`,
              'turnstile-api',
              'dist/modules/access/release-operator.js',
              ['verify'],
              ownerEnv('turnstile', true),
              { operatorId: c.operatorId },
              network,
            ),
          );
          assert.ok(typeof latest.revision === 'number');
          if (payload.expectedRevision !== undefined)
            assert.equal(payload.expectedRevision, latest.revision);
          payload.expectedRevision = latest.revision;
          payload.key ??= randomUUID();
          if (command.operation === 'module-access' && payload.action === 'grant')
            payload.roleId ??= randomUUID();
          if (command.operation === 'release' && command.subcommand === 'open') {
            payload.releaseId ??= intent.releaseId;
            assert.equal(payload.releaseId, intent.releaseId);
            if (payload.incompatibleProcessesStopped !== undefined)
              assert.equal(payload.incompatibleProcessesStopped, true);
            const ownedNetwork = await docker.json<{ Containers: Record<string, unknown> }>(
              'GET',
              `/networks/${encodeURIComponent(network)}`,
            );
            assert.ok(ownedNetwork);
            for (const id of Object.keys(ownedNetwork.Containers)) {
              const process = await docker.inspect(id);
              assert.ok(process);
              assert.equal(
                process.Config.Labels['thaarei.installation'],
                local,
                'Unknown process in installation network',
              );
              assert.ok(
                artifact.release.images.some((image) => image.id === process.Image),
                'Incompatible process requires reconciliation',
              );
            }
            payload.incompatibleProcessesStopped = true;
          }
        }
        if (command.operation === 'authority-client' && payload.action === 'issue') {
          const generated = env(['.env.turnstile']);
          const purpose =
            payload.kind === 'login'
              ? 'AUTH_LOGIN_CLIENT_ID'
              : payload.kind === 'machine'
                ? 'DMS_MACHINE_CLIENT_ID'
                : payload.kind === 'identity_service'
                  ? 'IDENTITY_SERVICE_CLIENT_ID'
                  : null;
          assert.ok(purpose, 'This module POC does not provision work clients');
          const clientId = required(generated, purpose);
          if (payload.clientId !== undefined) assert.equal(payload.clientId, clientId);
          payload.clientId = clientId;
          const credentials = join(c.directory, 'credentials');
          if (!existsSync(credentials)) mkdirSync(credentials, { mode: 0o700 });
          const file = `/run/thaarei/credentials/${clientId}.json`;
          if (payload.credentialFile !== undefined) assert.equal(payload.credentialFile, file);
          payload.credentialFile = file;
        }
        if (command.operation === 'application' && payload.action === 'issue-key') {
          const credentials = join(c.directory, 'credentials');
          if (!existsSync(credentials)) mkdirSync(credentials, { mode: 0o700 });
          payload.credentialFile ??= '/run/thaarei/credentials/enrollment.json';
          assert.equal(payload.credentialFile, '/run/thaarei/credentials/enrollment.json');
        }
        if (!readOnly && !journal.jobs[stage]) writeJson(preparedFile, payload);
      }
      const output = await job(
        stage,
        product === 'dms' ? 'dms-api' : 'turnstile-api',
        `dist/modules/${entry}.js`,
        command.operation === 'resend-verification'
          ? ['--resend-verification']
          : command.subcommand
            ? [command.subcommand]
            : [],
        ownerEnv(product, true),
        payload,
        c.ingressNetwork,
      );
      if (command.operation === 'provision-user') {
        const result = jsonOutput(output);
        assert.ok(typeof result.userId === 'string' && result.verificationRequired === true);
        const user = {
          userId: result.userId,
          email: command.input.email,
          verificationRequired: true,
        };
        if (existsSync(join(state, 'prepared-user.json')))
          assert.deepEqual(JSON.parse(privateText(join(state, 'prepared-user.json'))), user);
        else writeJson(join(state, 'prepared-user.json'), user);
      }
      atomic(join(state, 'last-owner-result.json'), output);
      if (command.operation === 'release' && command.subcommand === 'open')
        writeJson(join(state, 'handover-open.json'), { stage });
      // Transient authority passwords/session proof are not retained after their command settles.
      rmSync(preparedFile, { force: true });
    }
    await runtime();
    await current();
    return readback();
  });
}
