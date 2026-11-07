import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parse } from 'yaml';

export async function workBrokerFixture() {
  const name = `thaarei-work-test-${randomBytes(6).toString('hex')}`,
    password = randomBytes(36).toString('base64url');
  const root = resolve('../..'),
    cwd = resolve('../dms-processing');
  const run = (args: string[], env = process.env) => {
    const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 30000, env });
    if (r.status !== 0) throw new Error('Disposable work broker command failed');
    return r.stdout.trim();
  };
  const image = parse(await readFile(resolve(root, 'deploy/compose.local.yaml'), 'utf8')).services
    .rabbitmq.image as string;
  run(
    [
      'run',
      '--detach',
      '--rm',
      '--name',
      name,
      '-e',
      'RABBITMQ_DEFAULT_USER',
      '-e',
      'RABBITMQ_DEFAULT_PASS',
      '-e',
      'RABBITMQ_DEFAULT_VHOST',
      '-p',
      '127.0.0.1::5672',
      '-p',
      '127.0.0.1::15672',
      image,
    ],
    {
      ...process.env,
      RABBITMQ_DEFAULT_USER: 'fixture',
      RABBITMQ_DEFAULT_PASS: password,
      RABBITMQ_DEFAULT_VHOST: 'dms',
    },
  );
  const port = run([
    'inspect',
    '--format',
    '{{(index (index .NetworkSettings.Ports "5672/tcp") 0).HostPort}}',
    name,
  ]);
  const management = run([
    'inspect',
    '--format',
    '{{(index (index .NetworkSettings.Ports "15672/tcp") 0).HostPort}}',
    name,
  ]);
  const broker = `amqp://fixture:${password}@127.0.0.1:${port}/dms`,
    base = `http://127.0.0.1:${management}/api`;
  const authorization = `Basic ${Buffer.from(`fixture:${password}`).toString('base64')}`;
  const api = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { authorization, 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`Disposable broker API ${response.status}`);
    const raw = await response.text();
    return raw ? JSON.parse(raw) : null;
  };
  let ready = false;
  const workers = new Set<{ stop: () => Promise<void> }>();
  const close = async () => {
    try {
      await Promise.all([...workers].map((worker) => worker.stop()));
    } finally {
      run(['rm', '--force', name]);
    }
  };
  try {
    for (let i = 0; i < 100; i++) {
      try {
        await api('/overview');
        ready = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    if (!ready) throw new Error('Disposable RabbitMQ unavailable');
    const python = async (
      args: string[],
      environment: NodeJS.ProcessEnv,
      input?: unknown,
      timeoutMs = 20000,
    ) =>
      new Promise<string>((resolve, reject) => {
        const child = spawn('uv', ['run', '--locked', ...args], {
          cwd,
          env: {
            ...process.env,
            ...environment,
            DMS_BROKER_URL: environment.DMS_BROKER_URL ?? broker,
            DMS_WORK_ALLOW_HTTP: 'true',
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', (chunk) => {
          output = (output + String(chunk)).slice(-10000);
        });
        let failureStage = '';
        child.stderr.on('data', (chunk) => {
          const status = /Private work API status (400|401|403|409|429|503)/.exec(String(chunk));
          if (status) failureStage = ` (HTTP ${status[1]})`;
          if (args.some((arg) => arg.endsWith('secure_transfer.py'))) {
            const match =
              /Secure transfer failed during (initialization|upload-begin|upload|completion|poll|download-authorization|download|verification);/.exec(
                String(chunk),
              );
            if (match) failureStage = ` (${match[1]})`;
          }
        });
        child.stdin.end(input !== undefined ? JSON.stringify(input) : undefined);
        const timeout = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('Private Python transport fixture timed out'));
        }, timeoutMs);
        child.on('error', () => {
          clearTimeout(timeout);
          reject(new Error('Private Python transport fixture failed'));
        });
        child.on('close', (code) => {
          clearTimeout(timeout);
          if (code !== 0)
            reject(new Error(`Private Python transport fixture failed${failureStage}`));
          else resolve(output);
        });
      });
    await python(['turnstile-processing', 'topology'], {});
    return {
      broker,
      api,
      python,
      worker(environment: NodeJS.ProcessEnv, mode = 'unsupported') {
        const child = spawn(
          'uv',
          [
            'run',
            '--locked',
            ...(mode === 'production'
              ? ['turnstile-processing', 'worker']
              : ['python', 'tests/work_worker.py']),
          ],
          {
            cwd,
            env: {
              ...process.env,
              ...environment,
              DMS_BROKER_URL: environment.DMS_BROKER_URL ?? broker,
              DMS_WORK_ALLOW_HTTP: 'true',
              DMS_TEST_WORK_MODE: mode,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true,
          },
        );
        let output = '';
        for (const stream of [child.stdout, child.stderr])
          stream?.on('data', (chunk) => {
            output = (output + String(chunk)).slice(-10000);
          });
        const closed = new Promise<void>((done) => child.once('close', () => done()));
        const outcomes: Array<{ state: string; reason: string }> = [];
        createInterface({ input: child.stdout }).on('line', (line) => {
          try {
            const value = JSON.parse(line);
            if (
              value.type === 'fixture-task-outcome' &&
              ['RETRY', 'REJECTED', 'SUCCESS', 'FAILURE'].includes(value.state) &&
              ['unroutable', 'other'].includes(value.reason)
            ) {
              outcomes.push({ state: value.state, reason: value.reason });
              if (outcomes.length > 32) outcomes.shift();
            }
          } catch {
            /* Worker logs are not fixture events and may contain private transport details. */
          }
        });
        let stopped: Promise<void> | undefined;
        const handle = {
          child,
          output: () => output.replaceAll(password, '[redacted]'),
          outcomes: () => [...outcomes],
          stop: () =>
            (stopped ??= (async () => {
              if (child.pid) {
                try {
                  process.kill(-child.pid, 'SIGKILL');
                } catch {}
              }
              let timeout: ReturnType<typeof setTimeout> | undefined;
              try {
                await Promise.race([
                  closed,
                  new Promise<never>((_, reject) => {
                    timeout = setTimeout(
                      () => reject(new Error('Private worker process group did not exit')),
                      5000,
                    );
                  }),
                ]);
              } finally {
                clearTimeout(timeout);
                workers.delete(handle);
              }
            })()),
        };
        workers.add(handle);
        return handle;
      },
      async reset() {
        for (const task of ['document.scan', 'document.extract', 'document.heavy']) {
          await api(`/queues/dms/${task}/contents`, 'DELETE');
          await api(`/queues/dms/${task}.dead/contents`, 'DELETE');
          await api(`/bindings/dms/e/dms.work/q/${task}`, 'POST', {
            routing_key: task,
            arguments: {},
          });
        }
      },
      async binding(task: string, enabled: boolean) {
        return enabled
          ? api(`/bindings/dms/e/dms.work/q/${task}`, 'POST', { routing_key: task, arguments: {} })
          : api(`/bindings/dms/e/dms.work/q/${task}/${encodeURIComponent(task)}`, 'DELETE');
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
