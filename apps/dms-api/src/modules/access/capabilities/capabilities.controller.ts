import { Controller, Get, Req } from '@nestjs/common';
import { OCR_FORMATS } from '@thaarei/dms-contracts/private';
import { capabilitiesResponseSchema } from '@thaarei/dms-contracts/public';
import type { FastifyRequest } from 'fastify';
import {
  AdmissionFeatures,
  policyProjection,
  readAdmissionPolicy,
} from '../../uploads/admission-policy.js';
import { DmsDatabaseService } from '../dms-database/dms-database.service.js';
import { dmsError } from '../dms-errors.js';
import { DmsOperation } from '../dms-operation.js';

@Controller('capabilities')
export class CapabilitiesController {
  constructor(
    private readonly database: DmsDatabaseService,
    private readonly features: AdmissionFeatures,
  ) {}
  @Get()
  @DmsOperation('getDmsCapabilities')
  capabilities(@Req() request: FastifyRequest) {
    if (!request.machine) return dmsError(401, 'MACHINE_TOKEN_REQUIRED');
    return this.database.withMachine(
      request.machine,
      ['dms:capabilities:read'],
      async ({ context, client }) => {
        const policy = policyProjection(await readAdmissionPolicy(client), this.features);
        return capabilitiesResponseSchema.parse({
          contractVersion: 1,
          applicationId: context.application.id,
          tenantId: context.tenantId,
          operations: [
            'application-enrollment',
            'capabilities:read',
            ...(context.principal.scopes.includes('dms:audit:read') ? ['audit:read'] : []),
            ...(context.principal.scopes.includes('dms:documents:read')
              ? [
                  'documents:read',
                  'documents:download',
                  'versions:read',
                  'processing:read',
                  'discovery:search',
                  'admission-policy:read',
                  'uploads:read',
                  'upload-batches:read',
                ]
              : []),
            ...(context.principal.scopes.includes('dms:documents:write')
              ? [
                  'uploads:control',
                  'upload-batches:control',
                  'versions:write',
                  'documents:edit-metadata',
                  'documents:references',
                  'documents:permissions',
                  'documents:lifecycle',
                  ...(context.principal.scopes.includes('dms:documents:read')
                    ? ['versions:restore', 'processing:reprocess']
                    : []),
                ]
              : []),
          ],
          formats: policy.formats,
          profiles: policy.profiles,
          formatCapabilities: policy.formats.map((contentType) => ({
            contentType,
            securityAssessment: true,
            textExtraction:
              policy.profiles.includes('searchable') ||
              (policy.profiles.includes('structured') &&
                OCR_FORMATS.includes(contentType as (typeof OCR_FORMATS)[number])),
            ocr:
              (policy.profiles.includes('searchable') || policy.profiles.includes('structured')) &&
              OCR_FORMATS.includes(contentType as (typeof OCR_FORMATS)[number]),
            tabularData:
              policy.profiles.includes('searchable') &&
              (contentType === 'text/csv' ||
                contentType === 'text/tab-separated-values' ||
                contentType.includes('spreadsheet') ||
                contentType.includes('excel')),
            structuredLayout:
              policy.profiles.includes('structured') &&
              OCR_FORMATS.includes(contentType as (typeof OCR_FORMATS)[number]),
            preview: false,
          })),
          languages:
            (policy.profiles.includes('searchable') || policy.profiles.includes('structured')) &&
            policy.formats.some((type) =>
              OCR_FORMATS.includes(type as (typeof OCR_FORMATS)[number]),
            )
              ? ['en']
              : [],
          limits: { accessTokenSeconds: 300, idempotencyWindowSeconds: 86400 },
        });
      },
    );
  }
}
