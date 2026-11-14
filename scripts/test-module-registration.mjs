// Disposable source snapshot: exercise a third module without registering it in the product.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

const root = process.argv[2];
assert.ok(
  root && isAbsolute(root) && !existsSync(root),
  'Use a new private absolute fixture directory',
);
mkdirSync(root, { mode: 0o700 });
const checkout = join(root, 'source');
mkdirSync(checkout);
for (const path of execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean)) {
  if (!existsSync(path)) continue;
  assert.ok(
    !path
      .split('/')
      .some(
        (part) =>
          part.startsWith('.dms-') || (part.startsWith('.env') && !part.endsWith('.example')),
      ),
  );
  assert.ok(lstatSync(path).isFile(), 'Fixture source must be ordinary files');
  mkdirSync(dirname(join(checkout, path)), { recursive: true });
  cpSync(path, join(checkout, path));
}
const run = (args) =>
  execFileSync('pnpm', args, {
    cwd: checkout,
    stdio: 'inherit',
    env: { ...process.env, CI: 'true' },
  });
run(['install', '--offline', '--frozen-lockfile']);
const registry = join(checkout, 'packages/turnstile-contracts/src/module-registry.ts');
const original = readFileSync(registry, 'utf8');
writeFileSync(
  registry,
  original.replace(
    'export const MODULE_REGISTRY = defineModules([',
    `export const MODULE_REGISTRY = defineModules([
  { id: 'permit-management', title: 'Permit Management', version: '1.0.0', permission: 'turnstile:permits:read', enabled: true, requires: ['foundation'], optionalIntegrations: [] },`,
  ),
);
for (const app of ['turnstile-api', 'turnstile-web']) {
  const source = join(checkout, `apps/${app}/src/features/risk-management`);
  const target = join(checkout, `apps/${app}/src/features/permit-management`);
  mkdirSync(target);
  for (const file of readdirSync(source)) {
    assert.ok(lstatSync(join(source, file)).isFile());
    const transform = (text) =>
      text
        .replaceAll('risk-management', 'permit-management')
        .replaceAll('RiskManagement', 'PermitManagement')
        .replaceAll('Risk Management', 'Permit Management')
        .replaceAll('turnstile:risks:read', 'turnstile:permits:read');
    writeFileSync(
      join(target, transform(file)),
      transform(readFileSync(join(source, file), 'utf8')),
    );
  }
}
run(['modules:sync']);
run(['test:browser:modules', join(root, 'added'), '--all-registered']);
// Retire by configuration only. Source and historical permission identity remain present.
writeFileSync(registry, readFileSync(registry, 'utf8').replace('enabled: true', 'enabled: false'));
run(['modules:sync']);
run(['typecheck']);
execFileSync(
  'node',
  [
    '--input-type=module',
    '-e',
    "import assert from 'node:assert/strict'; import {peoplePermissionSchema,BUSINESS_MODULES} from './packages/turnstile-contracts/dist/index.js'; assert.equal(peoplePermissionSchema.parse('turnstile:permits:read'),'turnstile:permits:read'); assert.ok(!BUSINESS_MODULES.some(m=>m.id==='permit-management'));",
  ],
  { cwd: checkout, stdio: 'inherit' },
);
run(['test:browser:modules', join(root, 'retired'), '--all-registered']);
// Documentation/contracts must also support retiring every business module.
writeFileSync(
  registry,
  readFileSync(registry, 'utf8')
    .replaceAll("id: 'incident-management',", "id: 'incident-management', enabled: false,")
    .replaceAll("id: 'risk-management',", "id: 'risk-management', enabled: false,"),
);
run(['modules:sync']);
execFileSync(
  'node',
  [
    '--input-type=module',
    '-e',
    "import assert from 'node:assert/strict'; import {moduleCapabilitiesSchema,BUSINESS_MODULES} from './packages/turnstile-contracts/dist/index.js'; assert.equal(BUSINESS_MODULES.length,0); moduleCapabilitiesSchema.parse({version:1,modules:[],context:null});",
  ],
  { cwd: checkout, stdio: 'inherit' },
);
console.log(
  'Third-module addition, generated permission migration, actual-image access and registry-only retirement passed.',
);
