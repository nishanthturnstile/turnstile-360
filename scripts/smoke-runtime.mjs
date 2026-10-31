import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';

for (const [application, entrypoint, prefix, name] of [
  ['dms-api', 'main.api.js', '/v1', 'Thaarei DMS API'],
  ['turnstile-api', 'main.js', '/api', 'Turnstile 360 API'],
]) {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  reservation.close();
  await once(reservation, 'close');

  const child = spawn(process.execPath, [`dist/${entrypoint}`], {
    cwd: resolve('apps', application),
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      assert.equal(child.exitCode, null, `${application} exited early: ${output}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health/live`, {
          signal: AbortSignal.timeout(500),
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { status: 'ok' });
        ready = true;
        break;
      } catch {
        await setTimeout(100);
      }
    }
    assert.ok(ready, `${application} did not become live: ${output}`);
    const response = await fetch(`http://127.0.0.1:${port}${prefix}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { name });
    console.log(`${application}: compiled entry point and HTTP checks passed`);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
  }
}
