// Trusted source ownership, never supplied by staff or release request free text.
export const foundationFeatures = Object.freeze({
  'turnstile-api': [],
  'turnstile-web': ['auth', 'configuration', 'onboarding', 'people', 'settings'],
});
export const moduleSources = Object.freeze({
  'incident-management': {
    apiClass: 'IncidentManagementModule',
    apiModule: 'incident-management.module',
    version: '1.0.0',
  },
  'risk-management': {
    apiClass: 'RiskManagementModule',
    apiModule: 'risk-management.module',
    version: '1.0.0',
  },
});
export const codeModules = [
  {
    id: 'foundation',
    label: 'Foundation',
    version: '1.0.0',
    category: 'core',
    requires: [],
    optionalIntegrations: [],
  },
  ...Object.entries(moduleSources).map(([id, m]) => ({
    id,
    label: id === 'incident-management' ? 'Incident Management' : 'Risk Management',
    version: m.version,
    category: 'individual',
    requires: ['foundation'],
    optionalIntegrations: [],
  })),
];
