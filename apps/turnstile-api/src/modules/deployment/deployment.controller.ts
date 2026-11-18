import { Controller, Get, Header } from '@nestjs/common';
import { RequirePermissions } from '../../infrastructure/access-policy.js';
import { withTenant } from '../../infrastructure/database/postgres.js';
import { ProductPersistenceService } from '../../infrastructure/database/product-persistence.service.js';
import {
  DeploymentExempt,
  WorkspaceReadinessExempt,
} from '../../infrastructure/workspace-access.js';
import { deploymentPreflight, deploymentStatus } from './access.js';
@Controller('deployment')
export class DeploymentController {
  constructor(private readonly persistence: ProductPersistenceService) {}
  @Get('status')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermissions('turnstile:access')
  @WorkspaceReadinessExempt()
  @DeploymentExempt()
  async status() {
    const { pool, config } = this.persistence;
    if (!pool || !config) return { access: 'closed', state: 'unavailable' };
    try {
      await deploymentPreflight(pool, config.INSTALLATION_TENANT_ID, 'read').catch(() => {});
      return await withTenant(pool, config.INSTALLATION_TENANT_ID, deploymentStatus);
    } catch {
      return { access: 'closed', state: 'unavailable' };
    }
  }
}
