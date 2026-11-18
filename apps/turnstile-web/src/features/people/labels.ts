import { isModuleEnabled, MODULE_REGISTRY } from '@thaarei/turnstile-contracts/runtime';
export const permissionLabel = (id: string) =>
  ({
    'turnstile:access': 'Workspace entry',
    'turnstile:people:manage': 'Manage people',
    'turnstile:roles:manage': 'Manage roles',
    ...Object.fromEntries(
      MODULE_REGISTRY.map((module) => [
        module.permission,
        `Read ${module.title}${isModuleEnabled(module) ? '' : ' (retired)'}`,
      ]),
    ),
    'turnstile:configuration:manage': 'Manage configuration',
    'turnstile:units:read': 'Read units',
    'turnstile:units:manage': 'Manage units',
    'turnstile:dms:capabilities:read': 'Document connection',
    'turnstile:documents:read': 'Documents: read',
    'turnstile:documents:upload': 'Documents: upload and versions',
    'turnstile:documents:edit': 'Documents: metadata and references',
    'turnstile:documents:restore': 'Documents: restore versions',
    'turnstile:documents:lifecycle': 'Documents: delete and restore documents',
    'turnstile:documents:share': 'Documents: application access',
    'turnstile:documents:reprocess': 'Documents: reprocess',
    'turnstile:documents:audit': 'Documents: activity',
    'turnstile:documents:validate': 'Documents: validation',
  })[id] ?? 'Unavailable permission';
