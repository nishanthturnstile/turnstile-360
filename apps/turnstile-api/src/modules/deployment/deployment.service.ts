import { HttpException, Injectable } from '@nestjs/common';
import { ProductPersistenceService } from '../../infrastructure/database/product-persistence.service.js';
import { type DeploymentMode, deploymentPreflight } from './access.js';
@Injectable()
export class DeploymentService {
  constructor(private readonly persistence: ProductPersistenceService) {}
  async require(mode: DeploymentMode) {
    const { pool, config } = this.persistence;
    if (!pool || !config) throw new HttpException({ code: 'DEPLOYMENT_UNAVAILABLE' }, 503);
    await deploymentPreflight(pool, config.INSTALLATION_TENANT_ID, mode);
  }
}
