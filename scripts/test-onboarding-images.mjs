import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const [apiImage, webImage, ...extra] = process.argv.slice(2);
assert.ok(apiImage && webImage && !extra.length, 'Pass the built API and web image tags');
assert.ok(!apiImage.startsWith('-') && !webImage.startsWith('-'), 'Image tags are required');
function docker(args, includeStderr = false) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, `Image verification failed: ${result.stderr}`);
  return (result.stdout + (includeStderr ? result.stderr : '')).trim();
}
async function ready(check) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      check();
      return;
    } catch {
      await delay(250);
    }
  }
  check();
}
const containers = [];
const journal = JSON.parse(
  readFileSync('apps/turnstile-api/database/migrations/meta/_journal.json', 'utf8'),
);
const migrations = journal.entries.map(({ tag }) => ({
  tag,
  sha256: createHash('sha256')
    .update(readFileSync(`apps/turnstile-api/database/migrations/${tag}.sql`))
    .digest('hex'),
}));
try {
  for (const [kind, image] of [
    ['api', apiImage],
    ['web', webImage],
  ]) {
    const name = `thaarei-onboarding-${kind}-${randomBytes(6).toString('hex')}`;
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
      image,
    ]);
    containers.push(name);
    assert.notEqual(docker(['inspect', '--format', '{{.Config.User}}', name]), 'root');
    assert.ok(Number(docker(['exec', name, 'id', '-u'])) > 0);
    const host = JSON.parse(docker(['inspect', '--format', '{{json .HostConfig}}', name]));
    assert.equal(host.NetworkMode, 'none');
    assert.equal(Object.keys(host.PortBindings ?? {}).length, 0);
    assert.equal(host.ReadonlyRootfs, true);
    if (kind === 'api') {
      const probe = `
        import assert from 'node:assert/strict';
        import { access, readFile } from 'node:fs/promises';
        import { createHash } from 'node:crypto';
        import { SETUP_REQUIREMENT_VERSION, setupSchema } from '@thaarei/turnstile-contracts';
        const get = async (path) => fetch('http://127.0.0.1:3002'+path, {signal: AbortSignal.timeout(2000)});
        assert.deepEqual(await (await get('/health/live')).json(), {status:'ok'});
        assert.deepEqual(await (await get('/api')).json(), {name:'Turnstile 360 API'});
        // No installation credentials/network are supplied: readiness and business access fail closed.
        assert.equal((await get('/health/ready/auth')).status, 503);
        const denied = await get('/api/organization');
        assert.equal(denied.status, 503);
        assert.deepEqual(await denied.json(), {code:'AUTH_UNAVAILABLE'});
        for (const file of [
          'LICENSE', 'dist/main.js', 'dist/infrastructure/database/migrate.js',
          'dist/modules/auth/set-user-access.js', 'dist/modules/organization/configuration-operator.js',
          'database/migrations/meta/_journal.json',
        ]) await access(file);
        assert.deepEqual(JSON.parse(await readFile('database/migrations/meta/_journal.json', 'utf8')), ${JSON.stringify(journal)});
        for (const {tag, sha256} of ${JSON.stringify(migrations)})
          assert.equal(createHash('sha256').update(await readFile('database/migrations/'+tag+'.sql')).digest('hex'), sha256);
        assert.equal(SETUP_REQUIREMENT_VERSION, 2);
        const completed = {state:'completed',revision:1,nextStep:null,completion:{completedAt:'2026-11-02T00:00:00Z',completedBy:'image-fixture',requirementVersion:1},requirementVersion:1,requirements:['organization_name','time_zone','organization_root','configuration_manager'].map(id=>({id,satisfied:true}))};
        assert.equal(setupSchema.parse(completed).requirementVersion,1);
        const fresh = {...completed, requirementVersion:2,completion:{...completed.completion,requirementVersion:2},requirements:[...completed.requirements.slice(0,3),{id:'first_unit',satisfied:true},completed.requirements[3]]};
        assert.equal(setupSchema.parse(fresh).requirementVersion,2);
      `;
      await ready(() => docker(['exec', name, 'node', '--input-type=module', '-e', probe]));
      console.log(
        'API image passed: non-root/read-only runtime, liveness, fail-closed access, compatible v1/v2 contracts and exact candidate migration journal/SQL including first-unit and move guards/private commands.',
      );
    } else {
      await ready(() =>
        assert.equal(
          docker(['exec', name, 'wget', '-qO-', 'http://127.0.0.1:8080/health/live']),
          'ok',
        ),
      );
      const paths = [
        '/',
        '/onboarding/organization',
        '/onboarding/structure',
        '/onboarding/review',
        '/onboarding/paused',
        '/waiting-for-setup',
        '/settings',
        '/settings/organization',
        '/settings/organization/structure',
        '/settings/workspace',
      ];
      const entry = docker(['exec', name, 'wget', '-qO-', 'http://127.0.0.1:8080/']);
      assert.match(entry, /<div id="root"><\/div>/);
      assert.match(entry, /\/assets\//);
      docker(['exec', name, 'test', '-f', '/usr/share/nginx/html/third-party-notices.txt']);
      for (const path of paths)
        assert.equal(docker(['exec', name, 'wget', '-qO-', `http://127.0.0.1:8080${path}`]), entry);
      const headers = docker(
        ['exec', name, 'wget', '-S', '-O', '/dev/null', 'http://127.0.0.1:8080/settings'],
        true,
      );
      assert.match(headers, /Content-Security-Policy:.*frame-ancestors 'none'/i);
      assert.match(headers, /Referrer-Policy: no-referrer/i);
      console.log(
        'Web image passed: non-root/read-only Nginx, liveness, ten onboarding/Settings SPA entries and CSP/referrer headers.',
      );
    }
  }
  console.log(
    'Production image checks used isolated containers with no credentials, host bindings or external network.',
  );
} finally {
  for (const name of containers)
    spawnSync('docker', ['rm', '--force', '--volumes', name], { stdio: 'ignore', timeout: 15000 });
}
