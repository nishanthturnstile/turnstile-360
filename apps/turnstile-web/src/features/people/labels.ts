import { isModuleEnabled, MODULE_REGISTRY } from '@thaarei/turnstile-contracts';
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
  })[id] ?? 'Unavailable permission';
