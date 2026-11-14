import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTIVE_MODULE_REGISTRY,
  defineModules,
  MODULE_REGISTRY,
} from '../packages/turnstile-contracts/src/module-registry.ts';

const ledgerFile = 'packages/turnstile-contracts/module-permissions.json';
// Never delete a retired permission: retained roles/data must remain migratable.
export function registrationChanges(modules, ledger) {
  defineModules(modules);
  for (const id of Object.keys(ledger))
    assert.ok(
      modules.some((module) => module.id === id),
      'Retire published modules with enabled: false; retain their metadata',
    );
  const additions = [];
  for (const module of modules) {
    const previous = ledger[module.id];
    assert.ok(
      !previous || previous === module.permission,
      'Published module permissions are immutable',
    );
    assert.ok(
      !Object.entries(ledger).some(
        ([id, permission]) => id !== module.id && permission === module.permission,
      ),
      'A permission cannot be reassigned to another module',
    );
    if (!previous) additions.push(module);
  }
  return additions;
}
export function permissionMigration(additions) {
  defineModules(
    additions.map((module) => ({ ...module, requires: ['foundation'], optionalIntegrations: [] })),
  );
  assert.ok(additions.length);
  return `-- Register module permissions; retired permissions and grants are retained.\nINSERT INTO turnstile.permission_catalog(permission,company_only) VALUES\n${additions.map((module) => `('${module.permission}',true)`).join(',\n')}\nON CONFLICT(permission) DO NOTHING;\n`;
}
export function checkModuleSources(modules) {
  for (const module of modules) {
    for (const path of [
      `apps/turnstile-api/src/features/${module.id}/${module.id}.module.ts`,
      `apps/turnstile-web/src/features/${module.id}/entry.tsx`,
    ])
      assert.ok(existsSync(path), `Registered module entrypoint missing: ${path}`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv.length === 3 && ['--check', '--sync'].includes(process.argv[2]));
  const ledger = JSON.parse(readFileSync(ledgerFile, 'utf8'));
  const additions = registrationChanges(MODULE_REGISTRY, ledger);
  checkModuleSources(ACTIVE_MODULE_REGISTRY);
  if (additions.length) {
    assert.equal(
      process.argv[2],
      '--sync',
      'Run pnpm modules:sync to generate the permission migration',
    );
    const directory = 'apps/turnstile-api/database/migrations';
    const before = new Set(readdirSync(directory));
    execFileSync(
      'pnpm',
      [
        '--filter',
        '@thaarei/turnstile-api',
        'exec',
        'drizzle-kit',
        'generate',
        '--config',
        'drizzle.turnstile.config.ts',
        '--custom',
        '--name',
        'module_permissions',
      ],
      { stdio: 'inherit' },
    );
    const created = readdirSync(directory).filter(
      (name) => name.endsWith('.sql') && !before.has(name),
    );
    assert.equal(created.length, 1, 'Expected exactly one new owning migration');
    writeFileSync(`${directory}/${created[0]}`, permissionMigration(additions));
    for (const module of additions) ledger[module.id] = module.permission;
    writeFileSync(ledgerFile, `${JSON.stringify(ledger, null, 2)}\n`);
  }
  if (process.argv[2] === '--sync') {
    execFileSync(
      'pnpm',
      [
        'exec',
        'turbo',
        'run',
        'build',
        '--filter=@thaarei/turnstile-contracts',
        '--filter=@thaarei/dms-contracts',
      ],
      { stdio: 'inherit' },
    );
    for (const script of ['generate-module-openapi.mjs', 'generate-user-management-openapi.mjs'])
      execFileSync(process.execPath, [`scripts/${script}`], { stdio: 'inherit' });
  }
  console.log(
    `Module registry verified: ${ACTIVE_MODULE_REGISTRY.length} active, ${Object.keys(ledger).length} retained permission identities.`,
  );
}
