import { applyDecorators, SetMetadata } from '@nestjs/common';
import { DMS_PUBLIC_ROUTES, type DmsOperationId } from '@thaarei/dms-contracts/public';
import { PendingEnrollment, PublicDmsEndpoint, RequireMachineScopes } from './access-policy.js';

export const DMS_OPERATION = Symbol('dmsOperation');
export function DmsOperation(id: DmsOperationId) {
  const route = DMS_PUBLIC_ROUTES.find((candidate) => candidate.operationId === id);
  if (!route) throw new Error('Unknown DMS operation');
  return applyDecorators(
    SetMetadata(DMS_OPERATION, id),
    route.policy === 'public'
      ? PublicDmsEndpoint()
      : route.policy === 'enrollment'
        ? PendingEnrollment()
        : RequireMachineScopes(...route.scopes),
  );
}
