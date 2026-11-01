import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status ?? result.error?.code})`);
}

function environment(directory) {
  const file = resolve(directory, '.env');
  return { ...(existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}), ...process.env };
}

try {
  run('pnpm', [
    'exec',
    'turbo',
    'run',
    'build',
    '--filter=@thaarei/dms-api',
    '--filter=@thaarei/turnstile-api',
  ]);
  const { parseAuthorityEnvironment } = await import(
    '../apps/dms-api/dist/modules/platform-auth/authority-configuration.js'
  );
  const { parseProductEnvironment, parseMachineEnvironment } = await import(
    '../apps/turnstile-api/dist/infrastructure/auth-environment.js'
  );
  const dmsEnv = environment('apps/dms-api');
  const productEnv = environment('apps/turnstile-api');
  for (const [env, port] of [
    [dmsEnv, '3001'],
    [productEnv, '3002'],
  ]) {
    if ((env.PORT && env.PORT !== port) || (env.HOST && env.HOST !== '127.0.0.1'))
      throw new Error('dev:auth requires API ports 3001/3002 on 127.0.0.1 to match Vite');
  }
  const dms = parseAuthorityEnvironment(dmsEnv);
  const product = parseProductEnvironment(productEnv);
  const machine = parseMachineEnvironment(productEnv);
  if (
    dms.AUTH_PROFILE !== 'local' ||
    product.AUTH_PROFILE !== 'local' ||
    machine.AUTH_PROFILE !== 'local'
  )
    throw new Error('dev:auth requires the local profile');
  for (const key of [
    'INSTALLATION_TENANT_ID',
    'INSTALLATION_CUSTOMER_KEY',
    'AUTH_PUBLIC_ORIGIN',
    'AUTH_ISSUER_URL',
    'AUTH_LOGIN_CALLBACK_URL',
    'AUTH_LOGIN_CLIENT_ID',
    'DMS_MACHINE_CLIENT_ID',
  ]) {
    if (dms[key] !== product[key]) throw new Error(`API configuration mismatch: ${key}`);
  }
  if (
    dms.AUTH_PUBLIC_ORIGIN !== 'http://localhost:5173' ||
    machine.DMS_RESOURCE_URL !== dms.DMS_RESOURCE_URL
  )
    throw new Error('Local URLs must match the Vite proxy configuration');
  if (
    [
      product.AUTH_LOGIN_CLIENT_SECRET,
      machine.DMS_MACHINE_CLIENT_SECRET,
      product.TURNSTILE_COOKIE_SECRET,
      product.TURNSTILE_TOKEN_ENCRYPTION_KEY,
    ].includes(dms.AUTH_SECRET)
  )
    throw new Error('Authority and product secrets must be independent');
  const productRole = new URL(product.TURNSTILE_DATABASE_URL).username;
  if (
    [dms.AUTH_DATABASE_URL, dms.DMS_DATABASE_URL].some(
      (value) => new URL(value).username === productRole,
    )
  )
    throw new Error('Turnstile requires its own database role');
  run('docker', [
    'compose',
    '--env-file',
    '.env',
    '-f',
    'deploy/compose.local.yaml',
    'up',
    '-d',
    '--wait',
    'postgres',
    'mailpit',
  ]);

  // Turbo rebuilds dependency packages and restarts consumers after shared source changes.
  // API processes load their own .env. Never inject their credentials into Vite's environment.
  const child = spawn(
    'pnpm',
    [
      'exec',
      'turbo',
      'watch',
      'dev',
      '--filter=@thaarei/dms-api',
      '--filter=@thaarei/turnstile-api',
      '--filter=@thaarei/turnstile-web',
    ],
    { stdio: 'inherit' },
  );
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 0;
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Auth development setup failed');
  process.exitCode = 1;
}
