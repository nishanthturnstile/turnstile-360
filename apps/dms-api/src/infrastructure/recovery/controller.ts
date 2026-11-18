import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  access,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { backupManifestSchema, backupPartNames } from '@thaarei/dms-contracts/private';
import { Client } from 'pg';
import { z } from 'zod';
import { WORK_SOURCE_EXPIRY } from '../../modules/processing/work-state.js';
import {
  STORAGE_ROLES,
  storageConfiguration,
} from '../../modules/storage/storage-configuration.js';
import { seaweedIdentityConfiguration } from '../../modules/storage/storage-provision.js';
import { type Container, DockerEngine, type Mount } from './docker-engine.js';
import { requiredRecoveryObjectsSql } from './object-inventory.js';
import { BackupRepository, fileHash } from './repository.js';

async function main() {
  const ROOT = '/installation';
  const engine = new DockerEngine();
  const requestSchema = z
    .object({
      operatorEmail: z.email().optional(),
      operatorPassword: z.string().min(15).max(128).optional(),
      backupId: z.uuid().optional(),
      targetProject: z
        .string()
        .regex(/^thaarei-dms-[a-z0-9_-]{1,48}$/)
        .optional(),
      ingressNetwork: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/)
        .optional(),
      accessReviewed: z.boolean().optional(),
    })
    .strict();
  const configSchema = z
    .object({
      repository: z.unknown(),
      retentionDays: z.number().int().min(7).max(3650).default(7),
    })
    .strict();
  const env = (text: string) =>
    Object.fromEntries(
      text.split('\n').flatMap((line) => {
        const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
        return m ? [[m[1], m[2]]] : [];
      }),
    );
  const readEnv = async (name: string) => env(await readFile(join(ROOT, name), 'utf8'));
  const privateWrite = (name: string, data: unknown) =>
    writeFile(name, typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
  const exists = async (path: string) =>
    access(path).then(
      () => true,
      () => false,
    );
  const self = await engine.inspect(hostname());
  const binding = self.Mounts.find((m) => m.Destination === ROOT);
  if (!binding) throw new Error('Private installation mount required');
  const hostRoot = binding.Source;
  const uid = String((await stat(ROOT)).uid);
  let phase = 'configure';
  const progress = (next: string) => {
    phase = next;
    console.log(JSON.stringify({ type: 'dms-recovery', phase }));
  };
  const rawRequest = requestSchema.parse(
    JSON.parse(await readFile(join(ROOT, '.dms-recovery-input.json'), 'utf8')),
  );
  const release = JSON.parse(await readFile(join(ROOT, 'RELEASE.json'), 'utf8'));
  const apiImage = `thaarei-dms-api:${release.version}`;
  const postgresImage = `thaarei-dms-bundled-postgres:${release.version}`;
  const mounts = (sub = ''): Mount[] => [
    { Type: 'bind', Source: join(hostRoot, sub), Target: '/configuration' },
  ];
  const project = () => readEnv('.env.dms.compose').then((e) => e.COMPOSE_PROJECT_NAME);
  const currentServices = async (name: string) => {
    const records = await engine.json<{ Id: string }[]>(
      'GET',
      `/containers/json?all=1&filters=${encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.project=${name}`] }))}`,
    );
    const map = new Map<string, Container>();
    for (const record of records) {
      const c = await engine.inspect(record.Id);
      const service = c.Config.Labels['com.docker.compose.service'];
      if (service && !c.Name.includes('-run-')) map.set(service, c);
    }
    return map;
  };
  const action = process.argv[2];
  // Source release and a previously verified access review must remain available
  // independently of repository credentials and encryption-key custody.
  if (action === 'release' || action === 'open') {
    try {
      if (action === 'release')
        await releaseSource(
          JSON.parse(await readFile(join(ROOT, '.dms-backup-fence.json'), 'utf8')),
        );
      else {
        if (!rawRequest.backupId || rawRequest.accessReviewed !== true)
          throw new Error('Explicit access review required');
        await privateCommand('recovery-open', {
          backupId: rawRequest.backupId,
          manifestSha256: await fileHash(
            join(ROOT, '.dms-restore', rawRequest.backupId, 'manifest.json'),
          ),
          accessReviewed: true,
        });
        await rm(join(ROOT, '.dms-recovery-blocked'), { force: true });
        progress('opened');
      }
    } finally {
      await rm(join(ROOT, '.dms-recovery-input.json'), { force: true });
    }
    return;
  }
  const settings = configSchema.parse(
    JSON.parse(await readFile(join(ROOT, '.dms-backup.json'), 'utf8')),
  );
  const repository = await BackupRepository.create(settings.repository);
  async function attach(network: string) {
    try {
      await engine.connect(network, self.Id);
    } catch {
      const c = await engine.json<{ Containers: Record<string, unknown> }>(
        'GET',
        `/networks/${encodeURIComponent(network)}`,
      );
      if (!c.Containers[self.Id]) throw new Error('Required private network unavailable');
    }
  }
  async function rootDatabase(container: Container) {
    const values = Object.fromEntries(
      container.Config.Env.map((value) => {
        const i = value.indexOf('=');
        return [value.slice(0, i), value.slice(i + 1)];
      }),
    );
    const client = new Client({
      host: 'postgres',
      port: 5432,
      user: values.POSTGRES_USER ?? 'workspace',
      password: values.POSTGRES_PASSWORD,
      database: values.POSTGRES_DB ?? 'dms',
      connectionTimeoutMillis: 10000,
    });
    await client.connect();
    return client;
  }
  async function privateCommand(action: string, extra: Record<string, unknown> = {}) {
    if (!rawRequest.operatorEmail || !rawRequest.operatorPassword)
      throw new Error('Fresh private administrator proof required');
    const input = {
      action,
      operatorEmail: rawRequest.operatorEmail,
      operatorPassword: rawRequest.operatorPassword,
      ...extra,
    };
    const file = join(ROOT, '.dms-recovery-command.json');
    await writeFile(file, JSON.stringify(input), { mode: 0o600 });
    const environment = await readEnv('.env.dms-operator');
    const id = await engine.job(
      apiImage,
      mounts(),
      uid,
      `${await project()}_default`,
      Object.entries(environment).map(([k, v]) => `${k}=${v}`),
    );
    try {
      return JSON.parse(
        await engine.exec(id, [
          'sh',
          '-ec',
          'node dist/modules/lifecycle/manage-recovery.js < /configuration/.dms-recovery-command.json',
        ]),
      );
    } finally {
      await engine.remove(id).catch(() => {});
      await rm(file, { force: true });
    }
  }
  async function volumeArchive(volume: string, target: string, user: string) {
    const id = await engine.job(
      apiImage,
      [{ Type: 'volume', Source: volume, Target: '/source', ReadOnly: true }],
      user,
    );
    try {
      await engine.archive(id, '/source', target);
    } finally {
      await engine.remove(id).catch(() => {});
    }
  }
  function storageClient(values: Record<string, string>) {
    const conf = storageConfiguration(values);
    return new S3Client({
      endpoint: conf.endpoint,
      region: conf.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: z.string().min(1).parse(values.DMS_STORAGE_BOOTSTRAP_ACCESS_KEY_ID),
        secretAccessKey: z.string().min(1).parse(values.DMS_STORAGE_BOOTSTRAP_SECRET_ACCESS_KEY),
      },
      maxAttempts: 1,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      requestHandler: { connectionTimeout: 5000, requestTimeout: 120000 },
    });
  }
  async function* actualObjects(client: S3Client, values: Record<string, string>) {
    for (const bucket of Object.values(storageConfiguration(values).buckets).sort()) {
      let token: string | undefined;
      let previous = '';
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1000, ContinuationToken: token }),
        );
        for (const item of page.Contents ?? []) {
          if (!item.Key || item.Key <= previous)
            throw new Error('Storage inventory ordering is not supported');
          previous = item.Key;
          const body = (await client.send(new GetObjectCommand({ Bucket: bucket, Key: item.Key })))
            .Body;
          if (!body) throw new Error('Object unavailable during inventory');
          const hash = createHash('sha256');
          let bytes = 0;
          for await (const chunk of body as Readable) {
            bytes += chunk.length;
            hash.update(chunk);
          }
          if (bytes !== item.Size) throw new Error('Object changed during inventory');
          yield { bucket, key: item.Key, bytes, sha256: hash.digest('hex') };
        }
        token = page.NextContinuationToken;
      } while (token);
    }
  }

  async function inventory(db: Client, values: Record<string, string>, file: string) {
    const conf = storageConfiguration(values),
      tenant = (await readEnv('.env.dms')).INSTALLATION_TENANT_ID;
    const client = storageClient(values);
    let expected: Record<string, unknown>[] = [],
      cursor: [string | null, string | null] = [null, null],
      finished = false;
    const next = async () => {
      if (!expected.length && !finished) {
        expected = (
          await db.query(requiredRecoveryObjectsSql, [
            tenant,
            conf.buckets.staging,
            conf.buckets.originals,
            conf.buckets.artifacts,
            ...cursor,
          ])
        ).rows;
        if (expected.length) {
          const last = expected.at(-1) as { bucket: string; key: string };
          cursor = [last.bucket, last.key];
        }
        if (expected.length < 1000) finished = true;
      }
      return expected[0];
    };
    const writer = createWriteStream(file, { flags: 'wx', mode: 0o600 });
    let count = 0,
      bytes = 0;
    try {
      for await (const object of actualObjects(client, values)) {
        const needed = await next();
        if (needed) {
          const compare =
            [String(needed.bucket), String(needed.key)].join('/') <
            [object.bucket, object.key].join('/');
          if (compare) throw new Error('Required recovery object missing');
          if (needed.bucket === object.bucket && needed.key === object.key) {
            if (
              needed.bytes !== object.bytes ||
              (needed.sha256 &&
                (needed.sha256 !== object.sha256 || needed.sha256 !== needed.maximum_sha))
            )
              throw new Error('Required recovery object integrity failed');
            expected.shift();
          }
        }
        count++;
        bytes += object.bytes;
        if (!writer.write(`${JSON.stringify(object)}\n`)) await once(writer, 'drain');
      }
      if (await next()) throw new Error('Required recovery object missing');
      writer.end();
      await once(writer, 'finish');
      return { count, bytes };
    } finally {
      writer.destroy();
      client.destroy();
    }
  }
  async function verifyObjects(file: string, values: Record<string, string>) {
    const client = storageClient(values);
    const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    const expected = lines[Symbol.asyncIterator]();
    let next = await expected.next();
    try {
      for await (const object of actualObjects(client, values)) {
        if (next.done) throw new Error('Unexpected restored object');
        const row = JSON.parse(next.value);
        if (JSON.stringify(row) !== JSON.stringify(object))
          throw new Error('Restored object integrity failed');
        next = await expected.next();
      }
      if (!next.done) throw new Error('Missing restored object');
    } finally {
      lines.close();
      client.destroy();
    }
  }

  async function releaseSource(fence: {
    id: string;
    roles: { name: string; login: boolean }[];
    services: string[];
    project: string;
  }) {
    const services = await currentServices(fence.project),
      pg = services.get('postgres');
    if (!pg) throw new Error('Source database unavailable');
    await attach(`${fence.project}_default`);
    const db = await rootDatabase(pg);
    try {
      await db.query('BEGIN');
      const tenant = (await readEnv('.env.dms')).INSTALLATION_TENANT_ID;
      await db.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
      const state = (
        await db.query(
          'SELECT state,backup_id FROM dms.recovery_state WHERE tenant_id=$1 FOR UPDATE',
          [tenant],
        )
      ).rows[0];
      if (state?.state === 'CLOSED') {
        if (state.backup_id !== fence.id)
          throw new Error('Another recovery operation owns the source fence');
        for (const role of fence.roles) {
          if (!/^thaarei_(auth|dms)_(runtime|migrator|operator|coordinator)$/.test(role.name))
            throw new Error('Invalid recorded role');
          await db.query(`ALTER ROLE ${role.name} ${role.login ? 'LOGIN' : 'NOLOGIN'}`);
        }
        await db.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename='thaarei_dms_backup' AND pid<>pg_backend_pid()",
        );
        await db.query('ALTER ROLE thaarei_dms_backup NOLOGIN PASSWORD NULL');
        await db.query("UPDATE dms.recovery_state SET state='OPEN' WHERE tenant_id=$1", [tenant]);
      }
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      await db.end();
    }
    for (const name of [
      'storage',
      'coordinator',
      'work-broker',
      'dms-scan',
      'work-publisher',
      'scan-worker',
      'extract-worker',
      'heavy-worker',
      'signature-updater',
      'dms-transfer',
      'dms-api',
    ]) {
      const c = services.get(name);
      if (c && fence.services.includes(name)) await engine.start(c.Id);
    }
    z.uuid().parse(fence.id);
    await engine.exec(pg.Id, ['rm', '-rf', `/tmp/dms-base-${fence.id}`], 'postgres');
    await rm(join(ROOT, '.dms-backup-fence.json'), { force: true });
  }
  async function verifyImages(services?: Map<string, Container>) {
    const locked = new Map<string, string>();
    for (const line of (await readFile(join(ROOT, 'images.lock'), 'utf8')).trim().split('\n')) {
      const [name, digest] = line.split('\t');
      if (!name || !digest) throw new Error('Invalid release image inventory');
      const image = await engine.json<{ Id: string }>(
        'GET',
        `/images/${encodeURIComponent(name)}/json`,
      );
      if (image.Id !== digest) throw new Error('Release image identity mismatch');
      locked.set(name, digest);
    }
    if (services)
      for (const service of services.values()) {
        if (locked.has(service.Config.Image) && locked.get(service.Config.Image) !== service.Image)
          throw new Error('Running release image mismatch');
      }
  }
  async function capture() {
    let proof = await privateCommand('backup-authorize');
    const id = proof.id as string;
    const sourceValues = await readEnv('.env.dms');
    if (
      sourceValues.AUTH_MODE !== 'standalone' ||
      (await readEnv('.env.provision')).DATABASE_PROFILE !== 'dms'
    )
      throw new Error('Standalone recovery profile required');
    const source = await project();
    const services = await currentServices(source);
    await verifyImages(services);
    const imageLockHash = await fileHash(join(ROOT, 'images.lock'));
    const running = [...services].filter(([, c]) => c.State.Running).map(([name]) => name);
    const pg = services.get('postgres'),
      storage = services.get('storage');
    if (!pg || !storage || !running.includes('postgres') || !running.includes('storage'))
      throw new Error('A running supported standalone source is required');
    const work = join(ROOT, '.dms-backups', id);
    await mkdir(work, { recursive: true, mode: 0o700 });
    await attach(`${source}_default`);
    await attach(`${source}_storage`);
    const db = await rootDatabase(pg);
    const roles = (
      await db.query(
        `SELECT rolname AS name,rolcanlogin AS login FROM pg_roles WHERE rolname IN ('thaarei_auth_runtime','thaarei_auth_migrator','thaarei_dms_runtime','thaarei_dms_migrator','thaarei_dms_operator','thaarei_dms_coordinator') ORDER BY rolname`,
      )
    ).rows;
    if (roles.length !== 6) throw new Error('Unexpected source role inventory');
    const fence = { id, roles, services: running, project: source };
    await privateWrite(join(ROOT, '.dms-backup-fence.json'), fence);
    const backupPassword = randomBytes(32).toString('base64url');
    const base = `/tmp/dms-base-${id}`;
    try {
      for (const name of [
        'dms-transfer',
        'work-publisher',
        'scan-worker',
        'extract-worker',
        'heavy-worker',
        'dms-api',
        'coordinator',
        'signature-updater',
      ]) {
        const c = services.get(name);
        if (c?.State.Running)
          await engine.stop(
            c.Id,
            name.endsWith('-worker') ? 660 : name === 'dms-transfer' ? 135 : 90,
          );
      }
      proof = await privateCommand('backup-authorize');
      progress('fence');
      await db.query('BEGIN');
      await db.query("SELECT set_config('app.tenant_id',$1,true)", [proof.tenantId]);
      await db.query(
        "SELECT pg_advisory_xact_lock_shared(hashtextextended('dms-operator:'||$1,0))",
        [proof.tenantId],
      );
      if (
        !(
          await db.query(
            'SELECT 1 FROM dms.operator_authorization WHERE tenant_id=$1 AND subject_id=$2 AND revoked_at IS NULL',
            [proof.tenantId, proof.subjectId],
          )
        ).rowCount
      )
        throw new Error('Operator authorization changed');
      if (
        (
          await db.query(
            "SELECT 1 FROM pg_tablespace WHERE spcname NOT IN ('pg_default','pg_global')",
          )
        ).rowCount
      )
        throw new Error('External PostgreSQL tablespaces are not supported by this profile');
      for (const role of roles) await db.query(`ALTER ROLE ${role.name} NOLOGIN`);
      await db.query(
        "DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='thaarei_dms_backup') THEN CREATE ROLE thaarei_dms_backup NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS REPLICATION LOGIN; END IF; END $$",
      );
      if (
        (
          await db.query(
            "SELECT 1 FROM pg_roles WHERE rolname='thaarei_dms_backup' AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolinherit)",
          )
        ).rowCount
      )
        throw new Error('Unsafe physical backup role');
      const sql = (
        await db.query(
          "SELECT format('ALTER ROLE thaarei_dms_backup LOGIN REPLICATION PASSWORD %L',$1::text) AS command",
          [backupPassword],
        )
      ).rows[0].command;
      await db.query(sql);
      await db.query(
        "INSERT INTO dms.recovery_state(tenant_id,state,backup_id) VALUES($1,'CLOSED',$2) ON CONFLICT(tenant_id) DO UPDATE SET state='CLOSED',backup_id=EXCLUDED.backup_id,manifest_sha256=NULL,verified_at=NULL,opened_at=NULL",
        [proof.tenantId, id],
      );
      await db.query('COMMIT');
      await db.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename=ANY($1::text[]) AND pid<>pg_backend_pid()',
        [roles.map((r) => r.name)],
      );
      const point = (
        await db.query('SELECT clock_timestamp() AS point')
      ).rows[0].point.toISOString();
      await db.query(
        'INSERT INTO dms.backup_catalog(id,tenant_id,recovery_point,expires_at,repository_id,verified_at) VALUES($1,$2,$3,$4,$5,NULL)',
        [
          id,
          proof.tenantId,
          point,
          new Date(Date.parse(point) + settings.retentionDays * 86400000).toISOString(),
          repository.config.id,
        ],
      );
      const values = await readEnv('.env.storage-admin');
      const began = Date.now();
      progress('inventory');
      const objects = await inventory(db, values, join(work, 'objects'));
      progress('basebackup');
      await engine.exec(
        pg.Id,
        [
          'pg_basebackup',
          '-h',
          '127.0.0.1',
          '-U',
          'thaarei_dms_backup',
          '-D',
          base,
          '--wal-method=stream',
          '--checkpoint=fast',
          '--manifest-checksums=SHA256',
          '--no-password',
        ],
        'postgres',
        [`PGPASSWORD=${backupPassword}`],
      );
      await engine.exec(pg.Id, ['pg_verifybackup', base], 'postgres');
      const control = await engine.exec(pg.Id, ['pg_controldata', base], 'postgres', ['LANG=C']);
      const systemIdentifier = control.match(/Database system identifier:\s*([0-9]+)/)?.[1],
        checkpointLsn = control.match(/Latest checkpoint location:\s*([0-9A-F/]+)/)?.[1];
      if (!systemIdentifier || !checkpointLsn)
        throw new Error('Missing PostgreSQL recovery identity');
      await engine.archive(pg.Id, base, join(work, 'postgres'));
      progress('storage');
      await engine.stop(storage.Id, 90);
      const data = storage.Mounts.find((m) => m.Destination === '/data');
      if (!data?.Name) throw new Error('Named SeaweedFS data volume required');
      await volumeArchive(data.Name, join(work, 'storage'), '10001:10001');
      const signatures = [...services.values()]
        .flatMap((c) => c.Mounts)
        .find((m) => m.Destination === '/var/lib/clamav');
      if (!signatures?.Name) throw new Error('Signature volume missing');
      await volumeArchive(signatures.Name, join(work, 'signatures'), uid);
      const config = join(work, 'configuration');
      await mkdir(config, { mode: 0o700 });
      for (const name of await readdir(ROOT)) {
        if (
          (name.startsWith('.env.') && !name.includes('backup')) ||
          ['.dms-profile', 'images.lock', 'RELEASE.json'].includes(name)
        )
          await cp(join(ROOT, name), join(config, name), { errorOnExist: true, force: false });
      }
      await cp(join(ROOT, 'deploy'), join(config, 'deploy'), {
        recursive: true,
        dereference: false,
      });
      await engine.archive(self.Id, config, join(work, 'configuration.tar'));
      await rename(join(work, 'configuration.tar'), join(work, 'configuration-part'));
      if ((await fileHash(join(config, 'images.lock'))) !== imageLockHash)
        throw new Error('Release inventory changed during capture');
      await db.end();
      await releaseSource(fence);
      progress('images');
      const names = (await readFile(join(ROOT, 'images.lock'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => line.split('\t')[0]);
      const params = new URLSearchParams();
      for (const name of names) params.append('names', z.string().min(1).parse(name));
      await pipeline(
        await engine.stream('GET', `/images/get?${params}`),
        createWriteStream(join(work, 'images'), { flags: 'wx', mode: 0o600 }),
      );
      await verifyImages();
      if ((await fileHash(join(ROOT, 'images.lock'))) !== imageLockHash)
        throw new Error('Release inventory changed during export');
      const parts = [];
      for (const name of backupPartNames) {
        const file = join(work, name === 'configuration' ? 'configuration-part' : name),
          encrypted = join(work, `${name}.gcm`);
        await repository.encrypt(file, encrypted, id, name);
        parts.push({
          name,
          sha256: await fileHash(encrypted),
          bytes: (await stat(encrypted)).size,
        });
      }
      const manifest = backupManifestSchema.parse({
        schemaVersion: 1,
        id,
        tenantId: proof.tenantId,
        customerKey: proof.customerKey,
        sourceProject: source,
        recoveryPoint: point,
        expiresAt: new Date(Date.parse(point) + settings.retentionDays * 86400000).toISOString(),
        postgresMajor: 18,
        systemIdentifier,
        checkpointLsn,
        releaseVersion: release.version,
        imageLockSha256: imageLockHash,
        repositoryId: repository.config.id,
        confirmedOffHost: repository.config.offHostAttested && !repository.config.fixtureOnly,
        roles,
        services: running,
        parts,
        objectCount: objects.count,
        sourceBytes: objects.bytes,
        durationSeconds: (Date.now() - began) / 1000,
      });
      await privateWrite(join(work, 'manifest.json'), manifest);
      return id;
    } finally {
      await db.end().catch(() => {});
      await engine.exec(pg.Id, ['rm', '-rf', base], 'postgres').catch(() => {});
      if (await exists(join(ROOT, '.dms-backup-fence.json'))) await releaseSource(fence);
    }
  }
  async function upload(id: string) {
    const work = join(ROOT, '.dms-backups', id),
      manifest = backupManifestSchema.parse(
        JSON.parse(await readFile(join(work, 'manifest.json'), 'utf8')),
      );
    if (manifest.repositoryId !== repository.config.id)
      throw new Error('Backup repository mismatch');
    progress('remote-upload');
    for (const part of manifest.parts) {
      const file = join(work, `${part.name}.gcm`);
      if ((await fileHash(file)) !== part.sha256) throw new Error('Local backup integrity failed');
      await repository.upload(id, part.name, file);
    }
    const encrypted = join(work, 'manifest.gcm');
    if (!(await exists(encrypted)))
      await repository.encrypt(join(work, 'manifest.json'), encrypted, id, 'manifest');
    await repository.upload(id, 'manifest', encrypted);
    await privateCommand('backup-register', {
      manifest,
      manifestSha256: await fileHash(join(work, 'manifest.json')),
      bytes: manifest.parts.reduce((sum, p) => sum + p.bytes, 0),
    });
    for (const name of backupPartNames)
      await rm(join(work, name === 'configuration' ? 'configuration-part' : name), { force: true });
    await rm(join(work, 'configuration'), { recursive: true, force: true });
    progress('complete');
    console.log(
      JSON.stringify({
        id,
        recoveryPoint: manifest.recoveryPoint,
        confirmedOffHost: manifest.confirmedOffHost,
        objects: manifest.objectCount,
        bytes: manifest.sourceBytes,
      }),
    );
  }

  async function loadManifest(id: string, work: string) {
    const encrypted = join(work, 'manifest.gcm');
    await repository.download(id, 'manifest', encrypted);
    const file = join(work, 'manifest.json');
    await repository.decrypt(encrypted, file, id, 'manifest');
    const manifest = backupManifestSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    if (
      Date.parse(manifest.expiresAt) <= Date.now() ||
      manifest.id !== id ||
      manifest.repositoryId !== repository.config.id ||
      manifest.releaseVersion !== release.version ||
      manifest.imageLockSha256 !== (await fileHash(join(ROOT, 'images.lock')))
    )
      throw new Error('Exact compatible release and recovery identity required');
    return manifest;
  }
  async function restoreVolume(
    name: string,
    file: string,
    rootName: string,
    targetSubdirectory = '',
  ) {
    await engine.json('POST', '/volumes/create', {
      Name: name,
      Labels: {
        'com.docker.compose.project': name.slice(0, name.lastIndexOf('_')),
        'thaarei.dms.recovery': 'true',
      },
    });
    const id = await engine.job(
      apiImage,
      [{ Type: 'volume', Source: name, Target: '/restore' }],
      '0:0',
      'none',
      [],
      ['CHOWN', 'DAC_OVERRIDE', 'FOWNER'],
    );
    try {
      if (
        await engine.exec(id, ['sh', '-ec', 'find /restore -mindepth 1 -maxdepth 1 -print -quit'])
      )
        throw new Error('Restore requires empty volumes');
      await engine.extract(id, '/restore', file);
      if (targetSubdirectory) {
        await engine.exec(id, [
          'mkdir',
          '-p',
          `/restore/${targetSubdirectory.slice(0, targetSubdirectory.lastIndexOf('/'))}`,
        ]);
        await engine.exec(id, ['mv', `/restore/${rootName}`, `/restore/${targetSubdirectory}`]);
      } else {
        if (rootName !== 'source') throw new Error('Unexpected recovery root');
        await engine.exec(id, [
          'sh',
          '-ec',
          'chown --reference=/restore/source /restore; chmod --reference=/restore/source /restore; find /restore/source -mindepth 1 -maxdepth 1 -exec mv -t /restore -- {} +; rmdir /restore/source',
        ]);
      }
    } finally {
      await engine.remove(id).catch(() => {});
    }
  }
  async function startRestoredContainer(
    name: string,
    service: string,
    image: string,
    environment: Record<string, string>,
    volumeMounts: Mount[],
    network: string,
    user: string,
    command?: string[],
  ) {
    const value = await engine.json<{ Id: string }>(
      'POST',
      `/containers/create?name=${encodeURIComponent(`${name}-${service}-1`)}`,
      {
        Image: image,
        User: user,
        Env: Object.entries(environment).map(([k, v]) => `${k}=${v}`),
        ...(command ? { Cmd: command } : {}),
        Labels: {
          'com.docker.compose.project': name,
          'com.docker.compose.service': service,
          'com.docker.compose.oneoff': 'False',
          'com.docker.compose.container-number': '1',
          'com.docker.compose.config-hash': 'dms-recovery-closed',
          'thaarei.dms.recovery': 'true',
        },
        HostConfig: {
          NetworkMode: network,
          Mounts: volumeMounts,
          Memory: 2147483648,
          NanoCpus: 1000000000,
          PidsLimit: 128,
        },
        NetworkingConfig: { EndpointsConfig: { [network]: { Aliases: [service] } } },
      },
    );
    await engine.start(value.Id);
    return value.Id;
  }
  async function restore() {
    const id = rawRequest.backupId,
      target = rawRequest.targetProject,
      ingress = rawRequest.ingressNetwork;
    if (!id || !target || !ingress)
      throw new Error('Explicit backup, new project and ingress network required');
    if ((await readdir(ROOT)).some((name) => name.startsWith('.env.') || name === '.dms-profile'))
      throw new Error('Never restore over an initialized installation');
    const work = join(ROOT, '.dms-restore', id);
    await mkdir(work, { recursive: true, mode: 0o700 });
    progress('download');
    const manifest = await loadManifest(id, work);
    if (target === manifest.sourceProject)
      throw new Error('Use a distinct recovery project until target handover');
    await engine.json('GET', `/networks/${encodeURIComponent(ingress)}`);
    for (const suffix of [
      'postgres-data',
      'storage-data',
      'storage-config',
      'work-broker-data',
      'dms-signatures',
    ]) {
      try {
        await engine.json('GET', `/volumes/${target}_${suffix}`);
      } catch {
        continue;
      }
      throw new Error('Recovery destination volume already exists');
    }
    for (const part of manifest.parts) {
      const encrypted = join(work, `${part.name}.gcm`);
      await repository.download(id, part.name, encrypted);
      if (
        (await fileHash(encrypted)) !== part.sha256 ||
        (await stat(encrypted)).size !== part.bytes
      )
        throw new Error('Backup component checksum mismatch');
      await repository.decrypt(encrypted, join(work, part.name), id, part.name);
    }
    progress('restore-configuration');
    const extractor = await engine.job(apiImage, mounts(), uid);
    try {
      const dir = `/configuration/.dms-restore/${id}/unpacked`;
      await engine.exec(extractor, ['mkdir', '-p', dir]);
      const listing = await engine.exec(extractor, [
        'tar',
        '-tf',
        `/configuration/.dms-restore/${id}/configuration`,
      ]);
      if (
        listing
          .split('\n')
          .some(
            (p) =>
              p.startsWith('/') || p.split('/').includes('..') || !p.startsWith('configuration/'),
          )
      )
        throw new Error('Invalid configuration archive path');
      await engine.exec(extractor, [
        'tar',
        '-xf',
        `/configuration/.dms-restore/${id}/configuration`,
        '-C',
        dir,
      ]);
      const imageList = JSON.parse(
        await engine.exec(extractor, [
          'tar',
          '-xOf',
          `/configuration/.dms-restore/${id}/images`,
          'manifest.json',
        ]),
      );
      const allowed = new Set(
        (await readFile(join(ROOT, 'images.lock'), 'utf8'))
          .trim()
          .split('\n')
          .map((line) => line.split('\t')[0]),
      );
      if (
        imageList
          .flatMap((entry: { RepoTags: string[] }) => entry.RepoTags ?? [])
          .some((tag: string) => !allowed.has(tag))
      )
        throw new Error('Unexpected backup image tag');
    } finally {
      await engine.remove(extractor).catch(() => {});
    }
    // All encrypted components are authenticated before importing any recovered data.
    await engine
      .stream('POST', '/images/load?quiet=true', createReadStream(join(work, 'images')))
      .then(async (response) => {
        for await (const _ of response) {
          /* consume progress without secret/error dumps */
        }
      });
    await verifyImages();
    const recovered = join(work, 'unpacked', 'configuration');
    const recoveredEnv = env(await readFile(join(recovered, '.env.dms'), 'utf8'));
    if (
      recoveredEnv.INSTALLATION_TENANT_ID !== manifest.tenantId ||
      recoveredEnv.INSTALLATION_CUSTOMER_KEY !== manifest.customerKey
    )
      throw new Error('Backup configuration installation mismatch');
    for (const name of await readdir(recovered)) {
      if (name === 'deploy') await cp(join(recovered, name), join(ROOT, name), { recursive: true });
      else if (name.startsWith('.env.') || name === '.dms-profile')
        await cp(join(recovered, name), join(ROOT, name), { errorOnExist: true, force: false });
    }
    // Every pre-recovery presigned capability must expire at the recovery boundary.
    // Object bytes do not depend on S3 signing identities; rotate every role pair
    // coherently before starting the recovered transfer/storage services.
    const credentials: Record<string, string> = {};
    for (const role of [...STORAGE_ROLES, 'bootstrap']) {
      const prefix = `DMS_STORAGE_${role.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;
      credentials[`${prefix}_ACCESS_KEY_ID`] = randomBytes(16).toString('hex');
      credentials[`${prefix}_SECRET_ACCESS_KEY`] = randomBytes(36).toString('base64url');
    }
    for (const name of (await readdir(ROOT)).filter(
      (n) => n.startsWith('.env.') && !n.endsWith('.json'),
    )) {
      const values = await readEnv(name);
      let changed = false;
      for (const key of Object.keys(values))
        if (credentials[key]) {
          values[key] = credentials[key];
          changed = true;
        }
      if (changed)
        await writeFile(
          join(ROOT, name),
          `${Object.entries(values)
            .map(([k, v]) => `${k}=${v}`)
            .join('\n')}\n`,
          { mode: 0o600 },
        );
    }
    await writeFile(
      join(ROOT, '.env.storage-identities.json'),
      JSON.stringify(seaweedIdentityConfiguration(await readEnv('.env.storage-admin'))),
      { mode: 0o600 },
    );
    const compose = await readEnv('.env.dms.compose');
    compose.COMPOSE_PROJECT_NAME = target;
    compose.DMS_INGRESS_NETWORK = ingress;
    await writeFile(
      join(ROOT, '.env.dms.compose'),
      `${Object.entries(compose)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n')}\n`,
      { mode: 0o600 },
    );
    await privateWrite(join(ROOT, '.dms-recovery-blocked'), {
      id,
      manifestSha256: await fileHash(join(work, 'manifest.json')),
    });
    await engine.network(`${target}_default`);
    await engine.network(`${target}_storage`, true);
    await restoreVolume(
      `${target}_postgres-data`,
      join(work, 'postgres'),
      `dms-base-${id}`,
      '18/docker',
    );
    // Verify the restored physical base and its recovery WAL before PostgreSQL touches it.
    const checker = await engine.json<{ Id: string }>('POST', '/containers/create', {
      Image: postgresImage,
      User: 'postgres',
      Entrypoint: ['pg_verifybackup'],
      Cmd: ['/check/18/docker'],
      HostConfig: {
        NetworkMode: 'none',
        Mounts: [
          { Type: 'volume', Source: `${target}_postgres-data`, Target: '/check', ReadOnly: true },
        ],
      },
    });
    try {
      await engine.start(checker.Id);
      const done = await engine.json<{ StatusCode: number }>(
        'POST',
        `/containers/${checker.Id}/wait?condition=not-running`,
      );
      if (done.StatusCode !== 0) throw new Error('Recovered base/WAL integrity failed');
    } finally {
      await engine.remove(checker.Id).catch(() => {});
    }
    await restoreVolume(`${target}_storage-data`, join(work, 'storage'), 'source');
    await restoreVolume(`${target}_dms-signatures`, join(work, 'signatures'), 'source');
    await engine.json('POST', '/volumes/create', { Name: `${target}_storage-config` });
    const iam = await engine.job(
      apiImage,
      [{ Type: 'volume', Source: `${target}_storage-config`, Target: '/run/dms' }, ...mounts()],
      '0:0',
      'none',
      [],
      ['CHOWN', 'DAC_OVERRIDE', 'FOWNER'],
    );
    try {
      await engine.exec(iam, [
        'cp',
        '/configuration/.env.storage-identities.json',
        '/run/dms/storage-identities.json',
      ]);
      await engine.exec(iam, ['chown', '10001:10001', '/run/dms/storage-identities.json']);
      await engine.exec(iam, ['chmod', '400', '/run/dms/storage-identities.json']);
    } finally {
      await engine.remove(iam).catch(() => {});
    }
    const pgId = await startRestoredContainer(
      target,
      'postgres',
      postgresImage,
      {
        POSTGRES_USER: 'workspace',
        POSTGRES_DB: 'dms',
        POSTGRES_PASSWORD: compose.POSTGRES_PASSWORD,
      },
      [{ Type: 'volume', Source: `${target}_postgres-data`, Target: '/var/lib/postgresql' }],
      `${target}_default`,
      'postgres',
    );
    await attach(`${target}_default`);
    let db: Client | undefined;
    for (let i = 0; i < 60; i++) {
      try {
        db = await rootDatabase(await engine.inspect(pgId));
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    if (!db) throw new Error('Recovered PostgreSQL did not start');
    try {
      progress('recovery-fence');
      await db.query('BEGIN');
      await db.query("SELECT set_config('app.tenant_id',$1,true)", [manifest.tenantId]);
      await db.query(
        "INSERT INTO dms.recovery_state(tenant_id,state,backup_id,manifest_sha256) VALUES($1,'CLOSED',$2,$3) ON CONFLICT(tenant_id) DO UPDATE SET state='CLOSED',backup_id=EXCLUDED.backup_id,manifest_sha256=EXCLUDED.manifest_sha256,verified_at=NULL,opened_at=NULL",
        [manifest.tenantId, id, await fileHash(join(work, 'manifest.json'))],
      );
      await db.query('DELETE FROM auth.session');
      await db.query('DELETE FROM auth.oauth_access_token');
      await db.query('DELETE FROM auth.oauth_refresh_token');
      await db.query('DELETE FROM auth.verification');
      await db.query('DELETE FROM auth.jwks');
      await db.query(
        "UPDATE dms.work_attempt SET state='LOST',finished_at=clock_timestamp() WHERE state='RUNNING'",
      );
      await db.query(
        "UPDATE dms.work_dispatch SET state='OBSOLETE',delivery_hash=NULL,delivery_until=NULL,delivery_client=NULL WHERE state<>'OBSOLETE'",
      );
      await db.query(
        `UPDATE dms.work_job j SET state='CANCELLED',generation=generation+1,current_attempt_id=NULL,recover_at=NULL,updated_at=clock_timestamp() WHERE j.state IN ('QUEUED','RUNNING','RETRY_WAIT') AND NOT EXISTS(SELECT 1 FROM dms.upload_admission a JOIN dms.upload_session s ON s.id=a.id JOIN dms.document d ON d.id=a.document_id JOIN dms.application_registration r ON r.id=a.application_id WHERE a.id=j.upload_id AND r.status='active' AND d.lifecycle='ACTIVE' AND a.lifecycle_generation=d.lifecycle_generation AND a.state IN ('RESERVED','SETTLED') AND NOT a.work_released AND ${WORK_SOURCE_EXPIRY}>clock_timestamp() AND ((j.task='document.scan' AND s.upload_state IN ('INITIATED','OBJECT_VERIFIED')) OR (j.task<>'document.scan' AND s.upload_state IN ('OBJECT_VERIFIED','COMPLETED'))))`,
      );
      await db.query(
        "UPDATE dms.work_job SET generation=generation+1,state=CASE WHEN executions>=3 OR recoveries>=3 OR deadline<=clock_timestamp() THEN 'FAILED' ELSE 'QUEUED' END,recoveries=least(3,recoveries+1),current_attempt_id=NULL,recover_at=NULL,next_eligible_at=NULL,updated_at=clock_timestamp() WHERE state IN ('QUEUED','RUNNING','RETRY_WAIT')",
      );
      await db.query(
        "INSERT INTO dms.work_dispatch(id,tenant_id,job_id,generation,task) SELECT gen_random_uuid(),tenant_id,id,generation,task FROM dms.work_job WHERE state='QUEUED' ON CONFLICT DO NOTHING",
      );
      await db.query(
        "UPDATE dms.disposal_intent SET state='PENDING',lease_id=NULL,lease_until=NULL,next_attempt_at=clock_timestamp() WHERE state='DELETING'",
      );
      await db.query('DELETE FROM dms.service_observation');
      for (const role of manifest.roles)
        await db.query(`ALTER ROLE ${role.name} ${role.login ? 'LOGIN' : 'NOLOGIN'}`);
      await db.query('ALTER ROLE thaarei_dms_backup NOLOGIN PASSWORD NULL');
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      await db.end();
    }
    await startRestoredContainer(
      target,
      'storage',
      `thaarei-dms-storage:${release.version}`,
      { DMS_STORAGE_IDENTITY_FILE: '/run/dms/storage-identities.json' },
      [
        { Type: 'volume', Source: `${target}_storage-data`, Target: '/data' },
        { Type: 'volume', Source: `${target}_storage-config`, Target: '/run/dms', ReadOnly: true },
      ],
      `${target}_storage`,
      '10001:10001',
    );
    await attach(`${target}_storage`);
    progress('closed');
    console.log(
      JSON.stringify({
        id,
        closed: true,
        objectCount: manifest.objectCount,
        manifestSha256: await fileHash(join(work, 'manifest.json')),
      }),
    );
  }

  async function verifyRestore(id: string) {
    const work = join(ROOT, '.dms-restore', id);
    const manifest = backupManifestSchema.parse(
      JSON.parse(await readFile(join(work, 'manifest.json'), 'utf8')),
    );
    const name = await project();
    const services = await currentServices(name);
    const pg = services.get('postgres');
    if (!pg) throw new Error('Closed recovery database required');
    await attach(`${name}_default`);
    await attach(`${name}_storage`);
    progress('verify-storage-ready');
    const storageConfig = await readEnv('.env.storage-admin');
    const probe = storageClient(storageConfig);
    try {
      let ready = false;
      for (let n = 0; n < 60; n++) {
        try {
          await probe.send(
            new ListObjectsV2Command({
              Bucket: storageConfiguration(storageConfig).buckets.staging,
              MaxKeys: 1,
            }),
          );
          ready = true;
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      if (!ready) throw new Error('Recovered storage is not ready');
    } finally {
      probe.destroy();
    }
    progress('verify-objects');
    await verifyObjects(join(work, 'objects'), await readEnv('.env.storage-admin'));
    progress('verify-catalog');
    const catalog: unknown[][] = [];
    for (const other of await repository.manifests()) {
      const dir = join(work, 'catalog', other);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const encrypted = join(dir, 'manifest.gcm'),
        file = join(dir, 'manifest.json');
      await rm(encrypted, { force: true });
      await rm(file, { force: true });
      await repository.download(other, 'manifest', encrypted);
      await repository.decrypt(encrypted, file, other, 'manifest');
      const old = backupManifestSchema.parse(JSON.parse(await readFile(file, 'utf8')));
      if (
        old.id !== other ||
        old.repositoryId !== repository.config.id ||
        old.tenantId !== manifest.tenantId ||
        old.customerKey !== manifest.customerKey
      )
        throw new Error('Foreign installation in backup catalog');
      catalog.push([
        old.id,
        old.tenantId,
        old.recoveryPoint,
        old.expiresAt,
        await fileHash(file),
        old.repositoryId,
        old.confirmedOffHost,
        old.parts.reduce((n, p) => n + p.bytes, 0),
      ]);
    }
    progress('verify-database');
    const db = await rootDatabase(pg);
    try {
      await db.query('BEGIN');
      await db.query("SELECT set_config('app.tenant_id',$1,true)", [manifest.tenantId]);
      if (
        (
          await db.query(
            'SELECT state FROM dms.recovery_state WHERE tenant_id=$1 AND backup_id=$2 AND manifest_sha256=$3',
            [manifest.tenantId, id, await fileHash(join(work, 'manifest.json'))],
          )
        ).rows[0]?.state !== 'CLOSED'
      )
        throw new Error('Recovery identity/fence mismatch');
      if (
        (await db.query('SELECT system_identifier::text AS id FROM pg_control_system()')).rows[0]
          .id !== manifest.systemIdentifier
      )
        throw new Error('PostgreSQL system identity mismatch');
      for (const row of catalog) {
        const old = (
          await db.query(
            'SELECT manifest_sha256,repository_id,recovery_point,expires_at FROM dms.backup_catalog WHERE id=$1',
            [row[0]],
          )
        ).rows[0];
        if (
          old &&
          ((old.manifest_sha256 !== null && old.manifest_sha256 !== row[4]) ||
            old.repository_id !== row[5] ||
            old.recovery_point.toISOString() !== row[2] ||
            old.expires_at.toISOString() !== row[3])
        )
          throw new Error('Conflicting retained recovery identity');
        await db.query(
          'INSERT INTO dms.backup_catalog(id,tenant_id,recovery_point,expires_at,manifest_sha256,repository_id,confirmed_off_host,bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET manifest_sha256=EXCLUDED.manifest_sha256,confirmed_off_host=EXCLUDED.confirmed_off_host,bytes=EXCLUDED.bytes,verified_at=clock_timestamp() WHERE dms.backup_catalog.manifest_sha256 IS NULL',
          row,
        );
      }
      await db.query(
        'UPDATE dms.recovery_state SET verified_at=clock_timestamp() WHERE tenant_id=$1',
        [manifest.tenantId],
      );
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      await db.end();
    }
    progress('verified-closed');
    console.log(JSON.stringify({ id, verified: true, accessReviewRequired: true }));
  }

  try {
    if (action === 'capture') {
      const lock = join(ROOT, '.dms-backup-lock');
      await mkdir(lock, { mode: 0o700 });
      try {
        progress('authorize');
        const id = await capture();
        await upload(id);
      } finally {
        await rm(lock, { recursive: true, force: true });
      }
    } else if (action === 'upload' && rawRequest.backupId) await upload(rawRequest.backupId);
    else if (action === 'restore') await restore();
    else if (action === 'verify' && rawRequest.backupId) await verifyRestore(rawRequest.backupId);
    else throw new Error('Explicit supported recovery action required');
  } catch {
    console.error(
      JSON.stringify({
        type: 'dms-recovery',
        phase,
        failed: true,
        action: 'Inspect protected state before retrying; a restored installation stays closed.',
      }),
    );
    process.exitCode = 1;
  } finally {
    repository.close();
    await rm(join(ROOT, '.dms-recovery-input.json'), { force: true });
  }
}
void main().catch(() => {
  console.error('Private recovery configuration rejected');
  process.exitCode = 1;
});
