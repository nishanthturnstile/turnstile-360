import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { candidateInventory } from './user-management-release-inventory.mjs';

const [authority, api, web, output, ...extra] = process.argv.slice(2);
assert.ok(
  authority && api && web && output && !extra.length,
  'Pass exact authority/API/web image references and a new private inventory output path',
);
const inventory = candidateInventory(authority, api, web);
const containers = [];
function docker(args, options = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 15000, ...options });
  assert.equal(result.status, 0, 'Candidate image operation failed');
  return result.stdout.trim();
}
async function ready(work) {
  for (let i = 0; i < 60; i++) {
    try {
      work();
      return;
    } catch {
      await delay(250);
    }
  }
  work();
}
try {
  for (const kind of ['authority', 'api', 'web']) {
    const name = `thaarei-um-image-${kind}-${randomBytes(6).toString('hex')}`;
    docker([
      'run',
      '--detach',
      '--rm',
      '--name',
      name,
      '--network',
      'none',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,nosuid,nodev',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      inventory.images[kind].id,
    ]);
    containers.push(name);
    const host = JSON.parse(docker(['inspect', '--format', '{{json .HostConfig}}', name]));
    assert.equal(host.NetworkMode, 'none');
    assert.equal(host.ReadonlyRootfs, true);
    assert.equal(Object.keys(host.PortBindings ?? {}).length, 0);
    assert.ok(Number(docker(['exec', name, 'id', '-u'])) > 0);
    const configuration = JSON.parse(docker(['inspect', '--format', '{{json .Config}}', name]));
    assert.ok(
      !configuration.Env.some((entry) =>
        /^(?:AUTH_SECRET|.*DATABASE_URL|.*CLIENT_SECRET|.*ENCRYPTION_KEY)=/.test(entry),
      ),
    );
    if (kind !== 'web') {
      const app = kind === 'api' ? 'turnstile-api' : 'dms-api';
      const port = kind === 'api' ? 3002 : 3001;
      const migrations =
        kind === 'api'
          ? [['database/migrations', inventory.migrations.product]]
          : [
              ['database/auth/migrations', inventory.migrations.authority],
              ['database/dms/migrations', inventory.migrations.dms],
            ];
      const compiled = inventory.compiled[kind].map((file) => ({
        path: file.path.replace(`apps/${app}/`, ''),
        sha256: file.sha256,
      }));
      const packages = (
        kind === 'api' ? ['dms-contracts', 'turnstile-contracts', 'dms-client'] : ['dms-contracts']
      ).flatMap((name) =>
        inventory.packages[name].map((file) => ({
          path: file.path.replace(`packages/${name}/`, `node_modules/@thaarei/${name}/`),
          sha256: file.sha256,
        })),
      );
      const probe = `
        import assert from 'node:assert/strict';
        import {readFile,access} from 'node:fs/promises';
        import {createHash} from 'node:crypto';
        const sha=(b)=>createHash('sha256').update(b).digest('hex');
        const get=(path)=>fetch('http://127.0.0.1:${port}'+path,{signal:AbortSignal.timeout(2000)});
        assert.deepEqual(await (await get('/health/live')).json(),{status:'ok'});
        assert.equal((await get('/health/ready/auth')).status,503);
        await access('LICENSE');
        for(const file of ${JSON.stringify(compiled)}) assert.equal(sha(await readFile(file.path)),file.sha256);
        for(const file of ${JSON.stringify(packages)}) assert.equal(sha(await readFile(file.path)),file.sha256);
        for(const [directory,expected] of ${JSON.stringify(migrations)}) {
          assert.deepEqual(JSON.parse(await readFile(directory+'/meta/_journal.json','utf8')),expected.journal);
          for(const file of expected.sql) assert.equal(sha(await readFile(directory+'/'+file.path)),file.sha256);
        }
        ${
          kind === 'api'
            ? `
          const {ACCESS_RELEASE_VERSION}=await import('./dist/modules/access/release-state.js');
          assert.equal(ACCESS_RELEASE_VERSION,1);
          for(const path of ['/api/people/catalog','/api/structure/units','/api/invitations/context'])
            assert.ok([401,503].includes((await get(path)).status));
          const {spawnSync}=await import('node:child_process');
          const result=spawnSync(process.execPath,['dist/modules/access/release-operator.js','verify'],
            {input:JSON.stringify({operatorId:'image-fixture'}),encoding:'utf8'});
          assert.equal(result.status,1);
          assert.equal(JSON.parse(result.stderr.trim()).code,'RELEASE_OPERATOR_FAILED');
        `
            : `
          for(const file of ['dist/modules/platform-auth/identity-handler.js','dist/modules/platform-auth/manage-client.js','dist/modules/platform-auth/prune-identity.js']) await access(file);
        `
        }
      `;
      await ready(() => docker(['exec', name, 'node', '--input-type=module', '-e', probe]));
      console.log(
        `${kind} candidate: actual non-root/read-only entrypoint, fail-closed readiness, exact compiled files and owning migrations passed.`,
      );
    } else {
      await ready(() =>
        assert.equal(
          docker(['exec', name, 'wget', '-qO-', 'http://127.0.0.1:8080/health/live']),
          'ok',
        ),
      );
      const entry = docker(['exec', name, 'wget', '-qO-', 'http://127.0.0.1:8080/']);
      assert.match(entry, /<div id="root"><\/div>/);
      for (const route of [
        '/people/members',
        '/people/roles',
        '/people/invitations',
        '/structure',
        '/invitations/join',
        '/settings',
        '/waiting-for-setup',
      ])
        assert.equal(
          docker(['exec', name, 'wget', '-qO-', `http://127.0.0.1:8080${route}`]),
          entry,
        );
      for (const file of inventory.compiled.web) {
        const path = file.path.replace('apps/turnstile-web/dist/', '/usr/share/nginx/html/');
        assert.equal(docker(['exec', name, 'sha256sum', path]).split(/\s/)[0], file.sha256);
      }
      const headers = spawnSync(
        'docker',
        ['exec', name, 'wget', '-S', '-O', '/dev/null', 'http://127.0.0.1:8080/invitations/join'],
        { encoding: 'utf8', timeout: 15000 },
      );
      assert.equal(headers.status, 0);
      assert.match(headers.stderr, /Content-Security-Policy:.*frame-ancestors 'none'/i);
      assert.match(headers.stderr, /Referrer-Policy: no-referrer/i);
      const denied = spawnSync(
        'docker',
        [
          'exec',
          name,
          'wget',
          '-S',
          '-O',
          '/dev/null',
          'http://127.0.0.1:8080/internal/identity/v1/invitation-preparations',
        ],
        { encoding: 'utf8', timeout: 15000 },
      );
      assert.match(denied.stderr, /404/);
      const marker = `um-private-${randomBytes(12).toString('hex')}`;
      docker([
        'exec',
        name,
        'wget',
        '-qO-',
        `http://127.0.0.1:8080/invitations/join?credential=${marker}`,
      ]);
      const logs = spawnSync('docker', ['logs', name], { encoding: 'utf8', timeout: 15000 });
      assert.equal(logs.status, 0);
      assert.ok(!`${logs.stdout}${logs.stderr}`.includes(marker));
      console.log(
        'Web candidate: exact assets, independent feature routes, CSP/referrer policy, internal-route denial and sensitive-query redaction passed.',
      );
    }
  }
  writeFileSync(output, `${JSON.stringify(inventory, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  console.log(`User-management capability1 image inventory written: ${output}`);
} finally {
  for (const name of containers)
    spawnSync('docker', ['rm', '--force', '--volumes', name], { stdio: 'ignore', timeout: 15000 });
}
