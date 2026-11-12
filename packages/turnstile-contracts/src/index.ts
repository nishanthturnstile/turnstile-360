import { z } from 'zod';
import type { AccessAwareUserSessionDto } from './access.js';
import { CONFIGURATION_MANAGE_PERMISSION, configurationActorSchema } from './onboarding.js';

// Legacy private replacement input only. Canonical reads use PEOPLE_PERMISSIONS /
// PeoplePermission; authority identity/operator roles never supply product permissions.
export const TURNSTILE_PERMISSIONS = [
  'turnstile:access',
  'turnstile:dms:capabilities:read',
  'turnstile:configuration:manage',
] as const;
export type TurnstilePermission = (typeof TURNSTILE_PERMISSIONS)[number];

export const accessAssignmentSchema = z.strictObject({
  operatorId: configurationActorSchema,
  userId: configurationActorSchema,
  enabled: z.boolean(),
  permissions: z
    .array(z.enum(TURNSTILE_PERMISSIONS))
    .max(TURNSTILE_PERMISSIONS.length)
    .refine((value) => new Set(value).size === value.length)
    .refine(
      (value) =>
        !value.includes(CONFIGURATION_MANAGE_PERMISSION) || value.includes('turnstile:access'),
    ),
});
export type AccessAssignmentDto = z.infer<typeof accessAssignmentSchema>;

export type UserSessionDto = AccessAwareUserSessionDto;

export interface LogoutDto {
  local: 'complete';
  authority: 'complete' | 'pending';
  retryUntil?: string;
}

export type AuthErrorCode =
  | 'DEPLOYMENT_RESTRICTED'
  | 'INVALID_AUTH_REQUEST'
  | 'LOGIN_TRANSACTION_INVALID'
  | 'IDENTITY_REQUIRED'
  | 'PRODUCT_ACCESS_DENIED'
  | 'PERMISSION_DENIED'
  | 'CSRF_REJECTED'
  | 'ACCESS_CONTEXT_CHANGED'
  | 'AUTH_UNAVAILABLE'
  | 'REFRESH_IN_PROGRESS'
  | 'LOGIN_REQUIRED';

export interface AuthErrorDto {
  code: AuthErrorCode;
}

// Product-facing capabilities omit DMS installation/client identity and operator limits.
export interface DmsCapabilitiesDto {
  deploymentAccess?: 'full' | 'existing-reads' | 'closed';
  formats: string[];
  profiles: string[];
  languages: string[];
}
export interface DmsIntegrationErrorDto {
  code: 'DMS_ACCESS_DENIED' | 'DMS_UNAVAILABLE';
}

export * from './access.js';
export * from './onboarding.js';
export * from './people.js';
export * from './people-common.js';
export * from './people-routes.js';
export { SUPPORTED_TIME_ZONES, TIME_ZONE_PROVENANCE } from './time-zones.js';

export const deploymentStatusSchema = z
  .object({
    access: z.enum(['full', 'existing-reads', 'closed']),
    state: z.string().min(1).max(64),
  })
  .strict();
export type DeploymentStatusDto = z.infer<typeof deploymentStatusSchema>;

export * from './modules.js';
