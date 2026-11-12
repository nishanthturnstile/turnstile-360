import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  atomic,
  privateText,
  protect,
  writeJson,
} from '../packages/installation-engine/dist/files.js';

// Export only the exact already provisioned module-poc installation. No credentials
// or customer identities are synthesized; the independent release/installer owns setup.
export function exportCustomerCompose(input, outputDirectory, project) {
  assert.match(project, /^[a-z0-9][a-z0-9_-]{0,62}$/);
  protect(input.directory, true);
  const journal = JSON.parse(privateText(join(input.directory, '.installer/journal.json')));
  const local = journal.binding.binding.localInstallationId;
  assert.match(local, /^[0-9a-f-]{36}$/);
  assert.equal(journal.phase, 'initialized');
  assert.equal(resolve(outputDirectory), outputDirectory);
  assert.ok(!existsSync(outputDirectory), 'Choose a new private export directory');
  for (let parent = dirname(outputDirectory); parent !== '/'; parent = dirname(parent))
    assert.ok(!existsSync(join(parent, '.git')), 'Customer export must be outside a checkout');
  protect(dirname(outputDirectory), true);
  const docker = (...args) =>
    execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 16 * 1024 ** 2 });
  const names = [
    'postgres',
    'dms-api',
    'turnstile-api',
    'turnstile-web',
    'dms-reporter',
    'turnstile-reporter',
  ];
  const compose = { name: project, services: {}, networks: {}, volumes: {} };
  const files = [],
    ids = [];
  for (const service of names) {
    const [c] = JSON.parse(docker('inspect', `thaarei-${local}-${service}`));
    assert.equal(c.Config.Labels['thaarei.installation'], local);
    if (service !== 'postgres') assert.equal(c.Config.Labels['thaarei.installer.service'], service);
    assert.match(c.Image, /^sha256:[0-9a-f]{64}$/);
    assert.equal(c.HostConfig.Privileged, false);
    assert.ok(!c.Mounts.some((m) => m.Source === '/var/run/docker.sock'));
    assert.ok(
      c.Config.Env.every((e) => !/[\r\n]/.test(e)),
      'Multiline environment needs owning export',
    );
    files.push([`${service}.env`, `${c.Config.Env.join('\n')}\n`]);
    ids.push(c.Id);
    const networks = {};
    for (const [name, net] of Object.entries(c.NetworkSettings.Networks)) {
      assert.ok(
        [`thaarei-${local}`, input.ingressNetwork].includes(name),
        'Unexpected customer network',
      );
      compose.networks[name] = { external: true, name };
      networks[name] = { aliases: (net.Aliases ?? []).filter((a) => a !== c.Id.slice(0, 12)) };
    }
    const volumes = c.Mounts.filter((m) => m.Type !== 'tmpfs').map((m) => {
      assert.ok(['bind', 'volume'].includes(m.Type));
      if (m.Type === 'volume') compose.volumes[m.Name] = { external: true, name: m.Name };
      return {
        type: m.Type,
        source: m.Type === 'volume' ? m.Name : m.Source,
        target: m.Destination,
        read_only: !m.RW,
      };
    });
    const h = c.HostConfig;
    compose.services[service] = {
      image: c.Image,
      pull_policy: 'never',
      container_name: c.Name.slice(1),
      user: c.Config.User || undefined,
      entrypoint: c.Config.Entrypoint,
      command: c.Config.Cmd,
      env_file: [{ path: `${service}.env`, format: 'raw' }],
      labels: Object.fromEntries(
        Object.entries(c.Config.Labels).filter(([key]) => !key.startsWith('com.docker.compose.')),
      ),
      networks,
      volumes,
      read_only: h.ReadonlyRootfs,
      cap_drop: h.CapDrop ?? [],
      security_opt: h.SecurityOpt ?? [],
      restart: h.RestartPolicy.Name === 'unless-stopped' ? 'unless-stopped' : 'no',
      ...(h.Tmpfs ? { tmpfs: Object.entries(h.Tmpfs).map(([p, v]) => `${p}:${v}`) } : {}),
      ...(h.Memory ? { mem_limit: h.Memory } : {}),
      ...(h.NanoCpus ? { cpus: h.NanoCpus / 1e9 } : {}),
      ...(h.PidsLimit ? { pids_limit: h.PidsLimit } : {}),
      logging: { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '3' } },
    };
  }
  mkdirSync(outputDirectory, { mode: 0o700 });
  for (const [name, value] of files) atomic(join(outputDirectory, name), value);
  writeJson(join(outputDirectory, 'compose.yaml'), compose);
  writeJson(join(outputDirectory, 'container-ids.json'), ids);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(
      process.argv.length,
      5,
      'Use private installer input, new output directory and project name',
    );
    exportCustomerCompose(
      JSON.parse(privateText(process.argv[2])),
      process.argv[3],
      process.argv[4],
    );
    console.log(
      'Six customer services exported. Review privately before transferring lifecycle ownership to Compose.',
    );
  } catch {
    console.error('Customer Compose export stopped; inspect private inputs and owned runtime.');
    process.exitCode = 1;
  }
}
