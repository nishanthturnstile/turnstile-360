import { z } from 'zod';

// Trusted backend/authority contracts. Never included in the consumer explorer.
export * from './identity-service.js';
export * from './identity-service-routes.js';
export const DMS_PRINCIPAL_KINDS = ['consumer', 'publisher', 'scanner', 'extractor'] as const;
export type DmsPrincipalKind = (typeof DMS_PRINCIPAL_KINDS)[number];

const operatorCredentials = {
  operatorEmail: z.email(),
  operatorPassword: z.string().min(15).max(128).meta({ writeOnly: true }),
};
export const dmsOperatorCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...operatorCredentials, action: z.literal('bootstrap') }).strict(),
  z.object({ ...operatorCredentials, action: z.literal('recover') }).strict(),
  z
    .object({
      ...operatorCredentials,
      action: z.literal('assign'),
      subjectId: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      ...operatorCredentials,
      action: z.literal('revoke'),
      subjectId: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      ...operatorCredentials,
      action: z.literal('audit-read'),
      applicationId: z.uuid().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z
        .string()
        .min(1)
        .max(2048)
        .regex(/^[A-Za-z0-9_-]+$/)
        .optional(),
    })
    .strict(),
]);
export const dmsOperatorJsonSchema = z.toJSONSchema(dmsOperatorCommandSchema);
export const DMS_OPERATOR_COMMANDS = [
  'bootstrap',
  'assign',
  'revoke',
  'recover',
  'audit-read',
] as const;
