import { SetMetadata } from '@nestjs/common';
import type { DmsMachineScope, DmsPrincipalKind } from '@thaarei/dms-contracts';

export const DMS_PUBLIC = Symbol('dmsPublic');
export const DMS_POLICY = Symbol('dmsPolicy');
export const PublicDmsEndpoint = () => SetMetadata(DMS_PUBLIC, true);
export const RequireMachineScopes = (...scopes: DmsMachineScope[]) =>
  SetMetadata(DMS_POLICY, { kind: 'normal', scopes });
export const PendingEnrollment = () => SetMetadata(DMS_POLICY, { kind: 'enrollment' });
export interface MachinePrincipal {
  issuer: string;
  clientId: string;
  scopes: string[];
}
export interface ApplicationRegistration {
  id: string;
  tenant_id: string;
  issuer: string;
  client_id: string;
  name: string;
  status: 'pending' | 'active' | 'disabled';
  scope_ceiling: string[];
  principal_kind: DmsPrincipalKind;
}
declare module 'fastify' {
  interface FastifyRequest {
    machine?: MachinePrincipal;
    registration?: ApplicationRegistration;
  }
}
