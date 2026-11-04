import { Module } from '@nestjs/common';
import { ProductPersistenceModule } from '../../infrastructure/database/product-persistence.module.js';
import { IdentityModule } from '../../integrations/identity/identity.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdministrationController } from './administration.controller.js';
import { AdministrationService } from './administration.service.js';
import { InvitationService } from './invitation.service.js';
import { InvitationDeliveryService } from './invitation-delivery.service.js';
import { InvitationMailService } from './invitation-mail.service.js';
import { InvitationStoreService } from './invitation-store.service.js';
import { InvitationPolicyBindingsModule } from './invitation-structure-policy.js';
import { PeopleCommandsService } from './people-commands.service.js';
import { PeopleStoreService } from './people-store.service.js';
import { RecipientController } from './recipient.controller.js';
import { RecipientService } from './recipient.service.js';

@Module({
  imports: [AuthModule, ProductPersistenceModule, IdentityModule, InvitationPolicyBindingsModule],
  exports: [InvitationService, InvitationDeliveryService],
  providers: [
    InvitationService,
    InvitationDeliveryService,
    InvitationMailService,
    InvitationStoreService,
    RecipientService,
    AdministrationService,
    PeopleCommandsService,
    PeopleStoreService,
  ],
  controllers: [RecipientController, AdministrationController],
})
export class PeopleModule {}
