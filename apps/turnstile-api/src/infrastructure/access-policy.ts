import { SetMetadata } from '@nestjs/common';
import type { PeoplePermission } from '@thaarei/turnstile-contracts';

export const PUBLIC_ENDPOINT = Symbol('publicEndpoint');
export const REQUIRED_PERMISSIONS = Symbol('requiredPermissions');
export const REQUIRED_RESOURCE_ACCESS = Symbol('requiredResourceAccess');
export const PublicEndpoint = () => SetMetadata(PUBLIC_ENDPOINT, true);
// Whole-company (or scope-neutral shell) authority. A permission name found only
// in a unit-scoped grant never satisfies a company route.
export const RequirePermissions = (...permissions: PeoplePermission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);
export interface ResourceAccessPolicy {
  action: 'turnstile:units:read' | 'turnstile:units:manage';
  unitParam: string;
  includeChildren: boolean;
}
export const RequireResourceAccess = (policy: ResourceAccessPolicy) =>
  SetMetadata(REQUIRED_RESOURCE_ACCESS, policy);
