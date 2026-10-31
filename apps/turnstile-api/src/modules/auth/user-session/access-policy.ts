import { SetMetadata } from '@nestjs/common';
import type { TurnstilePermission } from '@thaarei/turnstile-contracts';

export const PUBLIC_ENDPOINT = Symbol('publicEndpoint');
export const REQUIRED_PERMISSIONS = Symbol('requiredPermissions');
export const PublicEndpoint = () => SetMetadata(PUBLIC_ENDPOINT, true);
export const RequirePermissions = (...permissions: TurnstilePermission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);
