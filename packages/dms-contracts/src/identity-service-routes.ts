import type { identityServiceSchemas } from './identity-service.js';

export interface IdentityServiceRouteContract {
  method: 'GET' | 'POST';
  path: string;
  policy: 'service_prepare' | 'service_projection' | 'setup_receipt' | 'setup_continuation';
  request?: keyof typeof identityServiceSchemas;
  response: keyof typeof identityServiceSchemas;
}
export const IDENTITY_SERVICE_ROUTES = [
  {
    method: 'POST',
    path: '/internal/identity/v1/invitation-preparations',
    policy: 'service_prepare',
    request: 'IdentityPreparationRequest',
    response: 'IdentityPreparation',
  },
  {
    method: 'GET',
    path: '/internal/identity/v1/invitation-preparations/{id}',
    policy: 'service_prepare',
    response: 'IdentityPreparation',
  },
  {
    method: 'POST',
    path: '/internal/identity/v1/subject-projections',
    policy: 'service_projection',
    request: 'IdentityProjectionRequest',
    response: 'IdentityProjectionResponse',
  },
  {
    method: 'POST',
    path: '/identity/invitation-setup/exchange',
    policy: 'setup_receipt',
    request: 'IdentitySetupExchange',
    response: 'IdentitySetupContext',
  },
  {
    method: 'GET',
    path: '/identity/invitation-setup/context',
    policy: 'setup_continuation',
    response: 'IdentitySetupContext',
  },
  {
    method: 'POST',
    path: '/identity/invitation-setup/complete',
    policy: 'setup_continuation',
    request: 'IdentitySetupComplete',
    response: 'IdentitySetupResult',
  },
  {
    method: 'POST',
    path: '/identity/invitation-setup/cancel',
    policy: 'setup_continuation',
    request: 'IdentityServiceEmpty',
    response: 'IdentitySetupResult',
  },
] as const satisfies readonly IdentityServiceRouteContract[];
