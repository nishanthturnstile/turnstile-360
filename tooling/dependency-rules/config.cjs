const { resolve } = require('node:path');

module.exports = {
  forbidden: [
    {
      name: 'installer-engine-is-private-operator-only',
      severity: 'error',
      from: { path: '^apps/' },
      to: { path: '(^packages/installation-engine/|^@thaarei/installation-engine$)' },
    },
    {
      name: 'module-catalog-has-no-node-runtime',
      severity: 'error',
      from: { path: '^packages/module-catalog/' },
      to: { dependencyTypes: ['core'], dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'central-browser-no-server-package',
      severity: 'error',
      from: {
        path: '^apps/thaarei-control-plane/src/app/(access/|modules/CatalogueEditor|staff/StaffEditor|clients/(ClientRegistry|ClientWorkspace|ModuleAssignment|ModuleDependencyGraph|PairingControls|registry-client))',
      },
      to: { path: '(^packages/deployment-control/|^@thaarei/deployment-control$)' },
    },
    {
      name: 'central-client-cannot-import-server',
      severity: 'error',
      from: {
        path: '^apps/thaarei-control-plane/src/app/(access/|modules/CatalogueEditor|staff/StaffEditor|clients/(ClientRegistry|ClientWorkspace|ModuleAssignment|ModuleDependencyGraph|PairingControls|registry-client))',
      },
      to: { path: '^apps/thaarei-control-plane/src/server/' },
    },

    {
      name: 'public-dms-client-uses-consumer-contracts-only',
      severity: 'error',
      from: { path: '^packages/dms-client/' },
      to: { path: '^packages/dms-contracts/(src|dist)/(index|private|identity-service)' },
    },
    ...['turnstile-api', 'turnstile-web'].flatMap((app) =>
      ['incident-management', 'risk-management'].map((id) => ({
        name: `${app}-${id}-private-source`,
        severity: 'error',
        from: {
          path: `^apps/${app}/src/`,
          pathNot: `^apps/${app}/src/(features/${id}/|module-composition\\.ts$)`,
        },
        to: { path: `^apps/${app}/src/features/${id}/` },
      })),
    ),
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
    ...['dms-api', 'dms-processing', 'turnstile-api', 'turnstile-web', 'thaarei-control-plane'].map(
      (app) => ({
        name: `no-imports-into-${app}`,
        severity: 'error',
        from: { pathNot: `^apps/${app}/` },
        to: { path: `^apps/${app}/` },
      }),
    ),
    {
      name: 'contracts-are-framework-independent',
      severity: 'error',
      from: {
        path: '^packages/(dms-contracts|turnstile-contracts|control-plane-contracts|module-catalog)/',
      },
      to: {
        path: '(^apps/|^packages/(dms-client|deployment-control)/|node_modules/(@nestjs|pg|drizzle-orm|better-auth|@better-auth|openid-client|@fastify)/)',
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
        path: '(^packages/(dms-client|deployment-control|installation-engine)/|^@thaarei/(dms-client|deployment-control|installation-engine)$|node_modules/(@nestjs|pg|drizzle-orm)/)',
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
    // The resolver plugin interprets paths from the repository working directory.
    tsConfig: { fileName: resolve(__dirname, '../../tsconfig.boundaries.json') },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'node'],
    },
  },
};
