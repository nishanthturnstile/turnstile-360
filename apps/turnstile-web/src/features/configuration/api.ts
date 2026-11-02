import {
  type ConfigurationSnapshotDto,
  configurationSnapshotSchema,
  type OrganizationPatch,
  organizationResponseSchema,
  organizationUnitsResponseSchema,
  setupSchema,
  type UnitCreate,
  type UnitMove,
  type UnitRename,
  unitCreateResponseSchema,
  workspaceStatusSchema,
} from '@thaarei/turnstile-contracts';
import { ProductError, productRequest } from '../auth/product';

let statusRequest: { userId: string; promise: ReturnType<typeof fetchStatus> } | undefined;
const fetchStatus = () =>
  productRequest('/api/workspace/status', { schema: workspaceStatusSchema });
export function loadWorkspaceStatus(userId: string) {
  if (statusRequest?.userId === userId) return statusRequest.promise;
  const promise = fetchStatus().finally(() => {
    if (statusRequest?.promise === promise) statusRequest = undefined;
  });
  statusRequest = { userId, promise };
  return promise;
}
export async function loadConfiguration(): Promise<ConfigurationSnapshotDto> {
  // Each owning GET is revisioned. Never combine projections from different revisions.
  for (let attempt = 0; attempt < 2; attempt++) {
    const [profile, structure, setup] = await Promise.all([
      productRequest('/api/organization', { schema: organizationResponseSchema }),
      productRequest('/api/organization/units', { schema: organizationUnitsResponseSchema }),
      productRequest('/api/setup', { schema: setupSchema }),
    ]);
    if (profile.revision === structure.revision && profile.revision === setup.revision)
      return configurationSnapshotSchema.parse({ ...profile, units: structure.units, setup });
  }
  throw new ProductError(503, 'CONFIGURATION_UNAVAILABLE');
}
export const saveOrganization = (body: OrganizationPatch, csrf: string) =>
  productRequest('/api/organization', {
    method: 'PATCH',
    body,
    csrf,
    schema: configurationSnapshotSchema,
  });
export const createUnit = (body: UnitCreate, key: string, csrf: string) =>
  createRequest(body, key, csrf);
async function createRequest(body: UnitCreate, key: string, csrf: string) {
  return productRequest('/api/organization/units', {
    method: 'POST',
    body,
    csrf,
    schema: unitCreateResponseSchema,
    headers: { 'idempotency-key': key },
  });
}
export const completeSetup = (expectedRevision: number, csrf: string) =>
  productRequest('/api/setup/complete', {
    method: 'POST',
    body: { expectedRevision },
    csrf,
    schema: configurationSnapshotSchema,
  });
export const renameUnit = (id: string, body: UnitRename, csrf: string) =>
  productRequest(`/api/organization/units/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
    csrf,
    schema: configurationSnapshotSchema,
  });
export const deleteUnit = (id: string, expectedRevision: number, csrf: string) =>
  productRequest(`/api/organization/units/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: { expectedRevision },
    csrf,
    schema: configurationSnapshotSchema,
  });
export const moveUnit = (id: string, body: UnitMove, csrf: string) =>
  productRequest(`/api/organization/units/${encodeURIComponent(id)}/parent`, {
    method: 'PATCH',
    body,
    csrf,
    schema: configurationSnapshotSchema,
  });
