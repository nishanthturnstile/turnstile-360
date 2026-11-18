import { z } from 'zod';
import { createAccessSchemas } from './access.js';
import { createPeopleSchemas } from './people.js';
import { COMPANY_ONLY_PERMISSIONS, PEOPLE_PERMISSIONS } from './people-common.js';
import { PEOPLE_ROUTES } from './people-routes.js';

// Definition only: the live catalogue, system templates and callers remain v2 until DV-I02.
export const DOCUMENTS_PERMISSIONS = [
  'turnstile:documents:read',
  'turnstile:documents:upload',
  'turnstile:documents:edit',
  'turnstile:documents:restore',
  'turnstile:documents:lifecycle',
  'turnstile:documents:share',
  'turnstile:documents:reprocess',
  'turnstile:documents:audit',
  'turnstile:documents:validate',
] as const;
export type DocumentsPermission = (typeof DOCUMENTS_PERMISSIONS)[number];
export const DOCUMENTS_ACCESS_CONTRACT = 3;
export const DOCUMENTS_ACCESS_HEADER = 'x-turnstile-access-contract';
export const V3_PERMISSIONS = [...PEOPLE_PERMISSIONS, ...DOCUMENTS_PERMISSIONS] as const;
export const v3PermissionSchema = z.enum(V3_PERMISSIONS);
export const v3AccessContracts = createAccessSchemas({
  permission: v3PermissionSchema,
  permissions: V3_PERMISSIONS,
  companyOnly: [...COMPANY_ONLY_PERMISSIONS, ...DOCUMENTS_PERMISSIONS],
  version: DOCUMENTS_ACCESS_CONTRACT,
});
export const v3PeopleContracts = createPeopleSchemas(v3AccessContracts, v3PermissionSchema);

// Conservative finite gate: includes commands which reference role IDs, retained receipts,
// recipient contexts and access inspection. Identity recovery/logout remain independent.
export const DOCUMENTS_ACCESS_GATED_ROUTES = [
  { method: 'GET', path: '/api/auth/session' },
  ...PEOPLE_ROUTES.filter(
    (route) => route.path.startsWith('/api/people/') || route.path.startsWith('/api/invitations/'),
  ).map(({ method, path }) => ({ method, path })),
] as const;

export const documentsAccessBarrierSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('dual'), documentsGrantsEnabled: z.literal(false) }),
  z.strictObject({ state: z.literal('v3_required'), minimumContract: z.literal(3) }),
]);
// Negotiation is a compatibility signal, never proof of access. The owning transaction
// must fence this decision with grant/activation; this helper performs no authorization.
export function documentsAccessWireVersion(
  header: unknown,
  barrier: z.infer<typeof documentsAccessBarrierSchema>,
) {
  if (header === '3') return 3;
  return barrier.state === 'dual' ? 2 : 'LOGIN_REQUIRED';
}
