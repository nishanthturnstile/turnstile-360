import { Module } from '@nestjs/common';
import { AdmissionFeatures } from './admission-policy.js';
// Pure installed catalog; both access projection and upload admission share one provider.
@Module({ providers: [AdmissionFeatures], exports: [AdmissionFeatures] })
export class AdmissionFeaturesModule {}
