import { z } from 'zod';

import { ACTIVE_MODULE_REGISTRY } from './module-registry.js';
export const BUSINESS_MODULES = ACTIVE_MODULE_REGISTRY.map((module) => ({
  ...module,
  path: `/modules/${module.id}` as const,
}));
const activeModuleIds = ACTIVE_MODULE_REGISTRY.map((module) => module.id);
export const businessModuleIdSchema = activeModuleIds.length ? z.enum(activeModuleIds) : z.never();
export type BusinessModuleId = z.infer<typeof businessModuleIdSchema>;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const moduleLinkSchema = z
  .object({
    id: businessModuleIdSchema,
    title: z.string().min(1).max(100),
    path: z.string().max(100),
  })
  .strict()
  .refine((v) =>
    BUSINESS_MODULES.some((m) => m.id === v.id && m.title === v.title && m.path === v.path),
  );
export const moduleContextSchema = z
  .object({
    catalogueDigest: digest,
    profileDigest: digest,
    releaseId: digest,
    policyRevision: z.number().int().positive(),
    assignmentRevision: z.number().int().positive(),
  })
  .strict();
export const moduleCapabilitiesSchema = z
  .object({
    version: z.literal(1),
    modules: z
      .array(moduleLinkSchema)
      .max(ACTIVE_MODULE_REGISTRY.length)
      .refine((v) => new Set(v.map((m) => m.id)).size === v.length),
    context: moduleContextSchema.nullable(),
  })
  .strict()
  .refine((v) => v.context !== null || v.modules.length === 0);
export const moduleEntrySchema = z
  .object({
    id: businessModuleIdSchema,
    title: z.string().min(1).max(100),
    message: z.string().min(1).max(300),
  })
  .strict()
  .refine((v) => BUSINESS_MODULES.some((m) => m.id === v.id && m.title === v.title));
export type ModuleCapabilitiesDto = z.infer<typeof moduleCapabilitiesSchema>;
export type ModuleEntryDto = z.infer<typeof moduleEntrySchema>;

export const moduleErrorSchema = z
  .object({
    code: z.enum([
      'MODULE_ACCESS_DENIED',
      'MODULE_UNAVAILABLE',
      'MODULE_INVALID_INPUT',
      'IDENTITY_REQUIRED',
      'LOGIN_REQUIRED',
      'PRODUCT_ACCESS_DENIED',
      'PERMISSION_DENIED',
      'DEPLOYMENT_RESTRICTED',
      'AUTH_UNAVAILABLE',
      'SETUP_REQUIRED',
      'CONFIGURATION_UNAVAILABLE',
      'REFRESH_IN_PROGRESS',
      'ACCESS_CONTEXT_CHANGED',
    ]),
    requestId: z.string().max(128).optional(),
    accessRevision: z.number().int().nonnegative().optional(),
    reason: z.string().max(128).optional(),
  })
  .strict();

export const moduleSchemas = {
  ModuleCapabilities: moduleCapabilitiesSchema,
  ModuleEntry: moduleEntrySchema,
  ModuleError: moduleErrorSchema,
};
export const moduleJsonSchemas = Object.fromEntries(
  Object.entries(moduleSchemas).map(([name, schema]) => [
    name,
    z.toJSONSchema(schema, { io: 'input' }),
  ]),
);
