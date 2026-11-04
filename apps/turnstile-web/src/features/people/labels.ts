export const permissionLabel = (id: string) =>
  ({
    'turnstile:access': 'Workspace entry',
    'turnstile:people:manage': 'Manage people',
    'turnstile:roles:manage': 'Manage roles',
    'turnstile:configuration:manage': 'Manage configuration',
    'turnstile:units:read': 'Read units',
    'turnstile:units:manage': 'Manage units',
    'turnstile:dms:capabilities:read': 'Document connection',
  })[id] ?? 'Unavailable permission';
