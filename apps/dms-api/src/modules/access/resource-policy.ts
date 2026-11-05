import type { PoolClient } from 'pg';
import type { ApplicationRegistration, MachinePrincipal } from './access-policy.js';
import { dmsError } from './dms-errors.js';

export interface MachineContext {
  readonly kind: 'machine';
  readonly tenantId: string;
  readonly application: ApplicationRegistration;
  readonly principal: MachinePrincipal;
}
export interface OperatorContext {
  readonly kind: 'operator';
  readonly tenantId: string;
  readonly subjectId: string;
}
export type DmsPrincipalContext = MachineContext | OperatorContext;
export interface DmsTransaction<C extends DmsPrincipalContext = DmsPrincipalContext> {
  readonly client: PoolClient;
  readonly context: C;
}
export interface OwnedResource {
  readonly tenantId: string;
  readonly ownerApplicationId: string;
}
// Audit is owner/operator only. Future document sharing does not imply audit access.
// Owning routes load the current resource/grants inside this same transaction.
export function requireResourceOwner(transaction: DmsTransaction, resource: OwnedResource) {
  const context = transaction.context;
  if (
    resource.tenantId !== context.tenantId ||
    (context.kind === 'machine' && resource.ownerApplicationId !== context.application.id)
  )
    return dmsError(403, 'OPERATION_DENIED');
}

export async function bindPrincipal(client: PoolClient, context: DmsPrincipalContext) {
  await client.query(
    "SELECT set_config('app.principal_kind',$1,true), set_config('app.application_id',$2,true), set_config('app.actor_id',$3,true)",
    [
      context.kind,
      context.kind === 'machine' ? context.application.id : '',
      context.kind === 'machine' ? context.principal.clientId : context.subjectId,
    ],
  );
}
