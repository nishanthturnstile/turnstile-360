import { catalogue, digest, moduleId, revision } from '@thaarei/module-catalog';
import { z } from 'zod';

export const CATALOGUE_ATTESTATION_TYPE = 'thaarei-module-catalogue+jwt';
export const CATALOGUE_ATTESTATION_AUDIENCE = 'urn:thaarei:module-catalogue';
export const MAX_CATALOGUE_BODY_BYTES = 262144;
const common = { requestId: z.uuid(), reason: z.string().trim().min(1).max(300) };
const proof = z.string().min(100).max(196608);
export const categories = z
  .array(z.object({ id: moduleId, category: z.enum(['core', 'individual']) }).strict())
  .min(1)
  .max(64)
  .refine((v) => new Set(v.map((m) => m.id)).size === v.length, 'Duplicate module');
export const catalogueCommand = z.discriminatedUnion('type', [
  z.object({ ...common, type: z.literal('code.import'), attestation: proof }).strict(),
  z
    .object({
      ...common,
      type: z.literal('draft.create'),
      id: z.uuid(),
      sourceId: z.uuid(),
      categories,
    })
    .strict(),
  z
    .object({ ...common, type: z.literal('draft.classify'), id: z.uuid(), revision, categories })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('catalogue.publish'),
      id: z.uuid(),
      revision,
      attestation: proof,
    })
    .strict(),
]);
export type CatalogueCommand = z.infer<typeof catalogueCommand>;
export const catalogueReceipt = z
  .object({ requestId: z.uuid(), resourceId: z.uuid(), revision, committedAt: z.iso.datetime() })
  .strict();
export const codeEvidence = z
  .object({ version: z.literal(1), kind: z.literal('code'), catalogue })
  .strict();
export const classificationEvidence = z
  .object({
    version: z.literal(1),
    kind: z.literal('classification'),
    catalogueId: z.uuid(),
    catalogueDigest: digest,
    codeCatalogueDigest: digest,
    draftRevision: revision,
  })
  .strict();
export const catalogueRecord = z
  .object({
    id: z.uuid(),
    sourceId: z.uuid(),
    digest,
    revision,
    status: z.enum(['draft', 'released']),
    catalogue,
    publishedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type CatalogueRecord = z.infer<typeof catalogueRecord>;
const summary = z
  .object({
    id: z.uuid(),
    digest,
    sourceDigest: digest,
    platform: z.string(),
    moduleCount: z.number().int().min(1).max(64),
    revision,
    status: z.enum(['code', 'draft', 'released']),
  })
  .strict();
export const catalogueList = z
  .object({
    codes: z.array(summary).max(50),
    catalogues: z.array(summary).max(50),
    nextCodeCursor: z.uuid().nullable(),
    nextCursor: z.uuid().nullable(),
  })
  .strict();
export type CatalogueList = z.infer<typeof catalogueList>;
export const catalogueQuery = z
  .object({ after: z.uuid().optional(), codeAfter: z.uuid().optional() })
  .strict();
