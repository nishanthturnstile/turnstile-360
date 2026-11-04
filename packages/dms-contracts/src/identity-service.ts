import { z } from 'zod';

// Separate from login and DMS machine scopes; implemented by the owning authority only.
export const IDENTITY_SERVICE_SCOPES = [
  'identity:invitation:prepare',
  'identity:subjects:read',
] as const;
export const IDENTITY_SERVICE_CLIENT_PURPOSE = 'identity_service';
export const IDENTITY_SERVICE_AUDIENCE_PATH = '/identity/services/accounts';
export const IDENTITY_SERVICE_LIMITS = {
  bodyBytes: 16_384,
  subjects: 100,
  setupSeconds: 1800,
  receiptSeconds: 86_400,
  tokenSeconds: 300,
} as const;
const id = z.uuid().toLowerCase();
const subject = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const version = z.number().int().min(1).max(2_147_483_647);
const instant = z.iso.datetime();
const opaque = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
const email = z
  .string()
  .max(254)
  .transform((value) => value.toLowerCase())
  .pipe(z.email());
const canonicalEmail = z
  .email()
  .max(254)
  .refine((value) => value === value.toLowerCase());
const binding = { tenantId: id, applicationId: id };
export const identityPreparationRequestSchema = z.strictObject({
  ...binding,
  purpose: z.literal('application_invitation'),
  operationId: id,
  invitationId: id,
  generation: version,
  email,
  expiresAt: instant,
});
export const identityPreparationSchema = z.discriminatedUnion('state', [
  z.strictObject({
    ...binding,
    id,
    operationId: id,
    invitationId: id,
    generation: version,
    state: z.literal('authorized'),
    expiresAt: instant,
    setupReceipt: opaque,
  }),
  z.strictObject({
    ...binding,
    id,
    operationId: id,
    invitationId: id,
    generation: version,
    state: z.literal('completed'),
    userId: subject,
    emailVerified: z.boolean(),
  }),
  z.strictObject({
    ...binding,
    id,
    operationId: id,
    invitationId: id,
    generation: version,
    state: z.literal('unavailable'),
  }),
]);
export const identityPreparationPathSchema = z.strictObject({ id });
export const linkedSubjectAssertionSchema = z.strictObject({
  userId: subject,
  memberId: id,
  memberVersion: version,
});
export const identityProjectionRequestSchema = z.strictObject({
  ...binding,
  purpose: z.literal('member_display'),
  subjects: z
    .array(linkedSubjectAssertionSchema)
    .min(1)
    .max(100)
    .refine(
      (rows) =>
        new Set(rows.map((row) => row.userId)).size === rows.length &&
        new Set(rows.map((row) => row.memberId)).size === rows.length,
    ),
});
export const identitySubjectProjectionSchema = z.discriminatedUnion('state', [
  z.strictObject({
    userId: subject,
    state: z.literal('present'),
    name: z.string().min(1).max(200),
    email: canonicalEmail,
    emailVerified: z.boolean(),
    checkedAt: instant,
  }),
  z.strictObject({ userId: subject, state: z.literal('deleted'), checkedAt: instant }),
]);
export const identityProjectionResponseSchema = z.strictObject({
  subjects: z
    .array(identitySubjectProjectionSchema)
    .max(100)
    .refine((rows) => new Set(rows.map((row) => row.userId)).size === rows.length),
});
export const identitySetupExchangeSchema = z.strictObject({ receipt: opaque });
export const identitySetupContextSchema = z.discriminatedUnion('phase', [
  z.strictObject({ phase: z.literal('ready'), csrfToken: opaque, expiresAt: instant }),
  z.strictObject({
    phase: z.literal('continue'),
    csrfToken: opaque,
    destination: z.literal('/sign-in'),
  }),
]);
const recipientName = z
  .string()
  .refine((value) => !/\p{Cs}/u.test(value) && [...value].length <= 1024)
  .meta({ maxLength: 1024 })
  .transform((value) =>
    value
      .normalize('NFC')
      .replace(/\p{White_Space}+/gu, ' ')
      .replace(/^ | $/g, ''),
  )
  .pipe(
    z
      .string()
      .regex(/[\p{L}\p{N}]/u)
      .regex(/^[^\p{Cc}\p{Cf}\p{Cs}]*$/u)
      .refine((value) => [...value].length <= 200)
      .meta({ minLength: 1, maxLength: 200 }),
  );
export const identitySetupCompleteSchema = z.strictObject({
  name: recipientName,
  password: z.string().min(15).max(128),
});
export const identitySetupResultSchema = z.strictObject({
  state: z.literal('continue'),
  destination: z.literal('/sign-in'),
});
export const identityServiceEmptySchema = z.strictObject({});
export const IDENTITY_SERVICE_ERROR_STATUS = {
  IDENTITY_SERVICE_INVALID: 400,
  IDENTITY_SERVICE_IDENTITY_REQUIRED: 401,
  IDENTITY_SERVICE_DENIED: 403,
  CSRF_REJECTED: 403,
  IDENTITY_SERVICE_NOT_FOUND: 404,
  IDENTITY_SERVICE_CONFLICT: 409,
  IDENTITY_SETUP_UNAVAILABLE: 410,
  IDENTITY_SERVICE_RATE_LIMITED: 429,
  IDENTITY_SERVICE_UNAVAILABLE: 503,
} as const;
export const identityServiceErrorSchema = z
  .strictObject({
    code: z.enum(
      Object.keys(IDENTITY_SERVICE_ERROR_STATUS) as [
        keyof typeof IDENTITY_SERVICE_ERROR_STATUS,
        ...(keyof typeof IDENTITY_SERVICE_ERROR_STATUS)[],
      ],
    ),
    requestId: id,
    retryAfterSeconds: z.number().int().min(1).max(3600).optional(),
  })
  .refine(
    (value) =>
      (value.code === 'IDENTITY_SERVICE_RATE_LIMITED') === (value.retryAfterSeconds !== undefined),
  );

export const identityServiceSchemas = {
  IdentityPreparationRequest: identityPreparationRequestSchema,
  IdentityPreparation: identityPreparationSchema,
  IdentityPreparationPath: identityPreparationPathSchema,
  LinkedSubjectAssertion: linkedSubjectAssertionSchema,
  IdentityProjectionRequest: identityProjectionRequestSchema,
  IdentityProjectionResponse: identityProjectionResponseSchema,
  IdentitySubjectProjection: identitySubjectProjectionSchema,
  IdentitySetupExchange: identitySetupExchangeSchema,
  IdentitySetupContext: identitySetupContextSchema,
  IdentitySetupComplete: identitySetupCompleteSchema,
  IdentitySetupResult: identitySetupResultSchema,
  IdentityServiceEmpty: identityServiceEmptySchema,
  IdentityServiceError: identityServiceErrorSchema,
};
export function identityServiceJsonSchemas() {
  const registry = z.registry<{ id: string }>();
  for (const [name, schema] of Object.entries(identityServiceSchemas))
    registry.add(schema, { id: name });
  const result = z.toJSONSchema(registry, {
    io: 'input',
    uri: (id) => `#/components/schemas/${id}`,
  }).schemas;
  // OpenAPI owns schema locations; a fragment-valued JSON Schema $id is invalid.
  for (const schema of Object.values(result)) delete schema.$id;
  return result;
}
export type IdentityPreparationRequest = z.infer<typeof identityPreparationRequestSchema>;
export type IdentityPreparation = z.infer<typeof identityPreparationSchema>;
export type IdentityProjectionRequest = z.infer<typeof identityProjectionRequestSchema>;
export type IdentityProjectionResponse = z.infer<typeof identityProjectionResponseSchema>;
export type IdentitySetupComplete = z.infer<typeof identitySetupCompleteSchema>;
export type IdentityServiceContractDto<Name extends keyof typeof identityServiceSchemas> = z.infer<
  (typeof identityServiceSchemas)[Name]
>;
