import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Docker, Mount } from './docker.js';
import { atomic, writeJson } from './files.js';
import { Unavailable } from './unavailable.js';

/** Exact private services only; ingress/TLS and host provisioning remain operator-owned. */
export async function startRuntime(c: {
  docker: Docker;
  root: string;
  local: string;
  uid: number;
  gid: number;
  network: string;
  ingress: string;
  image: (role: string) => string;
  env: (files: string[]) => Record<string, string>;
  current: () => Promise<void>;
  authorityOrigin: string;
  resourceOrigin: string;
  hasCa: boolean;
}) {
  const publicFiles = [
    'central-trust.json',
    'dms-marker',
    'turnstile-marker',
    'module-release.json',
    'module-release-trust.json',
    ...(c.hasCa ? ['customer-ca.pem'] : []),
  ];
  const publicMounts: Mount[] = publicFiles.map((name) => ({
    Type: 'bind',
    Source: join(c.root, name),
    Target: `/run/thaarei/${name}`,
    ReadOnly: true,
  }));
  const withCa = (values: Record<string, string>): Record<string, string> => ({
    ...values,
    ...(c.hasCa ? { NODE_EXTRA_CA_CERTS: '/run/thaarei/customer-ca.pem' } : {}),
  });
  const apiEnv = (files: string[]) => {
    const values = withCa(c.env(files));
    for (const key of Object.keys(values))
      if (
        key.endsWith('MACHINE_SECRET_FILE') ||
        key.includes('MIGRATION_DATABASE_URL') ||
        key.includes('PROVISION_DATABASE_URL') ||
        key.includes('REPORTER_DATABASE_URL') ||
        key.includes('COORDINATOR_DATABASE_URL')
      )
        delete values[key];
    return values;
  };
  const ensure = async (
    name: string,
    role: string,
    values: Record<string, string>,
    entry: string | null,
    mounts: Mount[],
  ) => {
    const full = `thaarei-${c.local}-${name}`;
    let container = await c.docker.inspect(full);
    const env = Object.entries(values).map(([k, v]) => `${k}=${v}`);
    if (!container) {
      await c.current();
      const id = await c.docker.create(full, {
        Image: c.image(role),
        User: `${c.uid}:${c.gid}`,
        Env: env,
        ...(entry ? { Entrypoint: ['node'], Cmd: [entry] } : {}),
        Labels: { 'thaarei.installation': c.local, 'thaarei.installer.service': name },
        HostConfig: {
          NetworkMode: c.network,
          ReadonlyRootfs: true,
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges'],
          LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
          RestartPolicy: { Name: 'unless-stopped' },
          Memory: role === 'turnstile-web' ? 268435456 : 536870912,
          NanoCpus: 1000000000,
          PidsLimit: 128,
          Tmpfs: { '/tmp': 'size=128m,noexec,nosuid,nodev' },
          Mounts: mounts,
        },
        NetworkingConfig: {
          EndpointsConfig: {
            [c.network]: { Aliases: name === 'dms-api' || name === 'turnstile-api' ? [name] : [] },
          },
        },
      });
      container = await c.docker.inspect(id);
    }
    assert.ok(container);
    assert.equal(container.Image, c.image(role));
    assert.equal(container.Config.Labels['thaarei.installation'], c.local);
    assert.equal(container.Config.Labels['thaarei.installer.service'], name);
    for (const entry of env)
      assert.ok(
        container.Config.Env.includes(entry),
        'Runtime configuration changed; reconcile before restart',
      );
    await c.docker.connect(c.ingress, container.Id);
    await c.docker.start(container.Id);
    if (name === 'dms-api' || name === 'turnstile-api') {
      let ready = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          await c.docker.exec(container.Id, [
            'node',
            '--input-type=module',
            '-e',
            `const r=await fetch('http://127.0.0.1:${name === 'dms-api' ? 3001 : 3002}/health/live',{signal:AbortSignal.timeout(2000)});if(!r.ok)process.exit(1);`,
          ]);
          ready = true;
          break;
        } catch {
          await delay(250);
        }
      }
      if (!ready)
        throw new Unavailable(
          'Owned API did not become live; preserve state and inspect private runtime logs',
        );
    }
    return full;
  };
  const dms = await ensure(
    'dms-api',
    'dms-api',
    {
      ...apiEnv(['.env.dms', '.env.integration', '.env.dms.deployment']),
      HOST: '0.0.0.0',
      PORT: '3001',
    },
    'dist/main.api.js',
    publicMounts.filter(
      (m) => !m.Target.includes('turnstile-marker') && !m.Target.includes('module-release'),
    ),
  );
  const web = await ensure('turnstile-web', 'turnstile-web', {}, null, []);
  let api: string | null = null;
  if (existsSync(join(c.root, '.env.clients')))
    api = await ensure(
      'turnstile-api',
      'turnstile-api',
      {
        ...apiEnv(['.env.turnstile', '.env.clients', '.env.turnstile.deployment']),
        HOST: '0.0.0.0',
        PORT: '3002',
      },
      'dist/main.js',
      publicMounts.filter((m) => !m.Target.includes('dms-marker')),
    );
  for (const product of ['dms', 'turnstile'] as const) {
    if (!existsSync(join(c.root, product, 'product.json'))) continue;
    const values = withCa(
      c.env(
        product === 'dms'
          ? ['.env.coordinator', '.env.dms.deployment']
          : ['.env.turnstile.reporter', '.env.turnstile.deployment'],
      ),
    );
    if (product === 'dms') {
      values.DMS_STORAGE_CAPACITY_PATH = '/tmp';
      values.DMS_SCRATCH_CAPACITY_PATH = '/tmp';
      values.DMS_CAPACITY_INDEPENDENT_FILESYSTEMS = 'false';
    }
    await ensure(
      `${product}-reporter`,
      product === 'dms' ? 'dms-api' : 'turnstile-api',
      values,
      product === 'dms' ? 'dist/main.coordinator.js' : 'dist/main.reporter.js',
      [
        ...publicMounts.filter((m) =>
          product === 'dms'
            ? !m.Target.includes('turnstile-marker') && !m.Target.includes('module-release')
            : !m.Target.includes('dms-marker'),
        ),
        {
          Type: 'bind',
          Source: join(c.root, product),
          Target: `/run/thaarei/${product}`,
          ReadOnly: true,
        },
      ],
    );
  }
  const apiName = api ?? `thaarei-${c.local}-turnstile-api`;
  const proxy = (host: string, port: number) =>
    `proxy_pass http://${host}:${port};\nproxy_set_header Host $http_host;\nproxy_set_header X-Forwarded-Host $http_host;\nproxy_set_header X-Forwarded-Proto https;\nproxy_set_header X-Forwarded-For $remote_addr;\nproxy_set_header X-Real-IP $remote_addr;\nproxy_set_header Forwarded "";`;
  atomic(
    join(c.root, 'ingress.nginx.conf'),
    `# Apply only in the operator-owned TLS ingress; never expose private command paths.\nlog_format thaarei_installation_safe '$remote_addr [$time_local] "$request_method" $status $body_bytes_sent';\nserver {\naccess_log /dev/stdout thaarei_installation_safe;\nerror_log /dev/null;\nlisten ${new URL(c.authorityOrigin).port || '443'} ssl;\nserver_name ${new URL(c.authorityOrigin).hostname};\nssl_certificate /tls/tls.crt;\nssl_certificate_key /tls/tls.key;\nresolver 127.0.0.11 valid=5s;\nset $dms ${dms};\nset $api ${apiName};\nset $web ${web};\nlocation /identity { ${proxy('$dms', 3001)} }\nlocation /.well-known/ { ${proxy('$dms', 3001)} }\nlocation /api/ { ${proxy('$api', 3002)} }\nlocation / { ${proxy('$web', 8080)} }\n}\nserver {\naccess_log /dev/stdout thaarei_installation_safe;\nerror_log /dev/null;\nlisten ${new URL(c.resourceOrigin).port || '443'} ssl;\nserver_name ${new URL(c.resourceOrigin).hostname};\nssl_certificate /tls/tls.crt;\nssl_certificate_key /tls/tls.key;\nresolver 127.0.0.11 valid=5s;\nset $dms ${dms};\nlocation /v1/ { ${proxy('$dms', 3001)} }\nlocation /.well-known/ { ${proxy('$dms', 3001)} }\nlocation / { return 404; }\n}\n`,
  );
  writeJson(join(c.root, 'ingress-routing.json'), {
    version: 1,
    authorityOrigin: c.authorityOrigin,
    resourceOrigin: c.resourceOrigin,
    web: { container: web, port: 8080 },
    dms: { container: dms, port: 3001 },
    api: { container: api ?? `thaarei-${c.local}-turnstile-api`, port: 3002 },
    authorityRoutes: { '/identity': 'dms', '/.well-known': 'dms', '/api': 'api', '/': 'web' },
    privateRoutesPublic: false,
  });
}
