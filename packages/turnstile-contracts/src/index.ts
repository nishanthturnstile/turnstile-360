// Product permissions are assigned locally, independently of identity/operator roles.
export const TURNSTILE_PERMISSIONS = [
  'turnstile:access',
  'turnstile:dms:capabilities:read',
] as const;
export type TurnstilePermission = (typeof TURNSTILE_PERMISSIONS)[number];

export interface UserSessionDto {
  user: { id: string; name: string; email: string };
  permissions: TurnstilePermission[];
  session: { expiresAt: string; idleExpiresAt: string };
  csrfToken: string;
}

export interface LogoutDto {
  local: 'complete';
  authority: 'complete' | 'pending';
  retryUntil?: string;
}

export type AuthErrorCode =
  | 'INVALID_AUTH_REQUEST'
  | 'LOGIN_TRANSACTION_INVALID'
  | 'IDENTITY_REQUIRED'
  | 'PRODUCT_ACCESS_DENIED'
  | 'PERMISSION_DENIED'
  | 'CSRF_REJECTED'
  | 'AUTH_UNAVAILABLE'
  | 'REFRESH_IN_PROGRESS'
  | 'LOGIN_REQUIRED';

export interface AuthErrorDto {
  code: AuthErrorCode;
}

// Product-facing capabilities omit DMS installation/client identity and operator limits.
export interface DmsCapabilitiesDto {
  formats: string[];
  profiles: string[];
  languages: string[];
}
export interface DmsIntegrationErrorDto {
  code: 'DMS_ACCESS_DENIED' | 'DMS_UNAVAILABLE';
}
