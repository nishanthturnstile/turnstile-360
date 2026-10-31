module.exports = {
  forbidden: [
    {
      name: 'no-unresolved-imports',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-circular-dependencies',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    ...['dms-api', 'dms-processing', 'turnstile-api', 'turnstile-web'].map((app) => ({
      name: `no-imports-into-${app}`,
      severity: 'error',
      from: { pathNot: `^apps/${app}/` },
      to: { path: `^apps/${app}/` },
    })),
    {
      name: 'contracts-are-framework-independent',
      severity: 'error',
      from: { path: '^packages/(dms-contracts|turnstile-contracts)/' },
      to: {
        path: '(^apps/|^packages/dms-client/|node_modules/(@nestjs|pg|drizzle-orm|better-auth|@better-auth|openid-client|@fastify)/)',
      },
    },
    {
      name: 'browser-auth-imports-are-client-only',
      severity: 'error',
      from: { path: '^apps/turnstile-web/' },
      to: {
        path: 'node_modules/(better-auth|@better-auth/oauth-provider)/',
        pathNot: '/dist/client(/|\\.)',
      },
    },
    {
      name: 'browser-must-not-import-node-builtins',
      severity: 'error',
      from: { path: '^apps/turnstile-web/' },
      to: {
        dependencyTypes: ['core'],
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'browser-must-not-import-server-packages',
      severity: 'error',
      from: { path: '^apps/turnstile-web/' },
      to: {
        path: '(^packages/dms-client/|^@thaarei/dms-client$|node_modules/(@nestjs|pg|drizzle-orm)/)',
      },
    },
    {
      name: 'browser-uses-turnstile-contracts',
      severity: 'error',
      from: { path: '^apps/turnstile-web/' },
      to: { path: '(^packages/(dms-client|dms-contracts)/|^@thaarei/(dms-client|dms-contracts)$)' },
    },
  ],
  options: {
    doNotFollow: { path: '(^|/)(node_modules|dist)/' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'node'] },
  },
};
