// Trusted source ownership, never supplied by staff or release request free text.
export const foundationFeatures = Object.freeze({
  'turnstile-api': [],
  'turnstile-web': ['auth', 'configuration', 'onboarding', 'people', 'settings'],
});

import { ACTIVE_MODULE_REGISTRY } from '../packages/turnstile-contracts/src/module-registry.ts';
export const moduleSources = Object.freeze(
  Object.fromEntries(
    ACTIVE_MODULE_REGISTRY.map((m) => [
      m.id,
      {
        apiClass: `${m.id
          .split('-')
          .map((part) => part[0].toUpperCase() + part.slice(1))
          .join('')}Module`,
        apiModule: `${m.id}.module`,
        version: m.version,
      },
    ]),
  ),
);
export const codeModules = [
  {
    id: 'foundation',
    label: 'Foundation',
    version: '1.0.0',
    category: 'core',
    requires: [],
    optionalIntegrations: [],
  },
  ...ACTIVE_MODULE_REGISTRY.map((m) => ({
    id: m.id,
    label: m.title,
    version: m.version,
    category: 'individual',
    requires: [...m.requires],
    optionalIntegrations: [...m.optionalIntegrations],
  })),
];
