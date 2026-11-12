import assert from 'node:assert/strict';
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createProfile,
  profileDigest,
  validateDeliveryRequest,
} from '../packages/module-catalog/dist/index.js';
import {
  assertCodeCatalogue,
  hash,
  sourceCatalogue,
  sourceInventory,
} from './module-build-source.mjs';
import { foundationFeatures, moduleSources } from './module-source-map.mjs';

// Destructive source selection is supported only in the isolated /workspace Docker build stage.
assert.ok(
  existsSync('/.thaarei-module-build') && process.cwd() === '/workspace',
  'Composition requires the isolated Docker build stage',
);
assert.deepEqual(
  readdirSync('apps/turnstile-web/public')
    .filter((n) => n !== '.gitkeep')
    .sort(),
  ['third-party-notices.txt'],
  'Unowned public assets',
);
const source = sourceInventory(),
  sourceDigest = hash(JSON.stringify(source));
let request;
if (process.argv[3]) {
  request = await validateDeliveryRequest(
    JSON.parse(Buffer.from(process.argv[3], 'base64').toString('utf8')),
  );
  assert.equal(request.profile.sourceDigest, sourceDigest, 'Build source differs from request');
  assertCodeCatalogue(request.catalogue);
} else {
  const ids = (process.argv[2] || '').split(',').filter(Boolean);
  const c = sourceCatalogue(sourceDigest, process.arch === 'arm64' ? 'linux/arm64' : 'linux/amd64');
  const p = await createProfile(c, { requestedIndividualIds: ids }, ['foundation', ...ids]);
  request = { version: 1, catalogue: c, profile: p, profileDigest: await profileDigest(p) };
}
assert.equal(
  request.profile.platform,
  process.arch === 'arm64' ? 'linux/arm64' : 'linux/amd64',
  'Wrong build platform',
);
const ids = request.profile.modules.map((m) => m.id).filter((id) => id !== 'foundation');
for (const app of ['turnstile-api', 'turnstile-web']) {
  const root = `apps/${app}/src/features`;
  assert.deepEqual(
    readdirSync(root)
      .filter((name) => name !== '.gitkeep')
      .sort(),
    [...foundationFeatures[app], ...Object.keys(moduleSources)].sort(),
    'Unowned feature source',
  );
  for (const id of Object.keys(moduleSources))
    if (!ids.includes(id)) rmSync(join(root, id), { recursive: true });
}
writeFileSync(
  'apps/turnstile-api/src/module-release-profile.ts',
  `export const installedModuleProfile: unknown = ${JSON.stringify(request.profile)};\n`,
);
const imports = ids
  .map(
    (id) =>
      `import { ${moduleSources[id].apiClass} } from './features/${id}/${moduleSources[id].apiModule}.js';`,
  )
  .join('\n');
writeFileSync(
  'apps/turnstile-api/src/module-composition.ts',
  `${imports}\nexport const selectedModules = [${ids.map((id) => moduleSources[id].apiClass).join(',')}];\n`,
);
writeFileSync(
  'apps/turnstile-web/src/module-composition.ts',
  `
import {${ids.length ? 'lazy,' : ''}type ComponentType,type LazyExoticComponent} from 'react';
import type {BusinessModuleId} from '@thaarei/turnstile-contracts';
import type {ModulePageProps} from './components/module-entry';
export type SelectedModuleRoute={id:BusinessModuleId;path:string;Component:LazyExoticComponent<ComponentType<ModulePageProps>>};
export const selectedModuleRoutes:SelectedModuleRoute[]=[${ids.map((id) => `{id:${JSON.stringify(id)},path:${JSON.stringify('/modules/' + id)},Component:lazy(()=>import('./features/${id}/entry'))}`).join(',')}];
`,
);
writeFileSync(
  'apps/turnstile-web/module-build-inputs.json',
  JSON.stringify(ids.map((id) => `src/features/${id}/entry.tsx`)),
);
for (const app of ['turnstile-api', 'turnstile-web'])
  writeFileSync(
    `apps/${app}/module-selection.json`,
    JSON.stringify({
      version: 1,
      modules: request.profile.modules.map((m) => m.id),
      request,
      source,
    }),
  );
