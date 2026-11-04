import { Injectable } from '@nestjs/common';
import { withTenant } from '../../../infrastructure/database/postgres.js';
import { ProductPersistenceService } from '../../../infrastructure/database/product-persistence.service.js';
import { readAccess } from '../access-evaluator.js';

@Injectable()
export class AccessRepositoryService {
  constructor(private readonly persistence: ProductPersistenceService) {}

  async read(userId: string) {
    const { pool, config } = this.persistence;
    if (!pool || !config) throw new Error('Access persistence unavailable');
    return withTenant(pool, config.INSTALLATION_TENANT_ID, (client) =>
      readAccess(client, config.INSTALLATION_TENANT_ID, userId),
    );
  }
}
