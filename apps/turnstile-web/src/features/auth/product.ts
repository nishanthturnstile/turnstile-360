import {
  type AuthErrorCode,
  accessAwareUserSessionSchema,
  CONFIGURATION_ERROR_STATUS,
  CONFIGURATION_LIMITS,
  type ConfigurationErrorDto,
  configurationErrorSchema,
  type DmsCapabilitiesDto,
  type DmsIntegrationErrorDto,
  type LogoutDto,
  type UserSessionDto,
} from '@thaarei/turnstile-contracts';

type ProductErrorCode =
  | 'MODULE_ACCESS_DENIED'
  | 'MODULE_UNAVAILABLE'
  | AuthErrorCode
  | DmsIntegrationErrorDto['code']
  | ConfigurationErrorDto['code'];
export class ProductError extends Error {
  readonly status: number;
  readonly code: ProductErrorCode;
  readonly detail: ConfigurationErrorDto | undefined;
  constructor(status: number, code: ProductErrorCode, detail?: ConfigurationErrorDto) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export async function productRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    csrf?: string;
    body?: unknown;
    schema?: { parse(value: unknown): T };
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const { method = 'GET', csrf, body, schema } = options;
  const unavailable =
    schema && path !== '/api/auth/session' ? 'CONFIGURATION_UNAVAILABLE' : 'AUTH_UNAVAILABLE';
  try {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(CONFIGURATION_LIMITS.requestTimeoutMs),
      headers: {
        accept: 'application/json',
        ...options.headers,
        ...(method !== 'GET'
          ? { 'x-csrf-token': csrf ?? '', 'content-type': 'application/json' }
          : {}),
      },
      ...(method !== 'GET' ? { body: JSON.stringify(body ?? {}) } : {}),
    });
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > CONFIGURATION_LIMITS.responseBytes)
      throw new Error('Invalid response');
    const value: unknown = JSON.parse(text);
    if (!response.ok) {
      const domain = configurationErrorSchema.safeParse(value);
      if (domain.success && CONFIGURATION_ERROR_STATUS[domain.data.code] === response.status)
        throw new ProductError(response.status, domain.data.code, domain.data);
      const known: ProductErrorCode[] = [
        'MODULE_ACCESS_DENIED',
        'MODULE_UNAVAILABLE',
        'DEPLOYMENT_RESTRICTED',
        'IDENTITY_REQUIRED',
        'LOGIN_REQUIRED',
        'PRODUCT_ACCESS_DENIED',
        'PERMISSION_DENIED',
        'CSRF_REJECTED',
        'ACCESS_CONTEXT_CHANGED',
        'AUTH_UNAVAILABLE',
        'REFRESH_IN_PROGRESS',
        'DMS_ACCESS_DENIED',
        'DMS_UNAVAILABLE',
      ];
      const code = value && typeof value === 'object' && 'code' in value ? value.code : undefined;
      throw new ProductError(
        response.status,
        known.includes(code as ProductErrorCode) ? (code as ProductErrorCode) : unavailable,
      );
    }
    return schema ? schema.parse(value) : (value as T);
  } catch (error) {
    if (error instanceof ProductError) throw error;
    throw new ProductError(503, unavailable);
  }
}
let sessionRequest: Promise<UserSessionDto> | undefined;
function startSessionRead(after?: Promise<UserSessionDto>): Promise<UserSessionDto> {
  const read = () => productRequest('/api/auth/session', { schema: accessAwareUserSessionSchema });
  const request = (after ? after.catch(() => {}).then(read) : read()).finally(() => {
    if (sessionRequest === request) sessionRequest = undefined;
  });
  sessionRequest = request;
  return request;
}
export function loadSession(options: { fresh?: boolean } = {}): Promise<UserSessionDto> {
  if (!options.fresh && sessionRequest) return sessionRequest;
  // Publish the post-mutation barrier to ordinary readers too. Drain the prior
  // response (including its cookies) before starting the authoritative new read.
  return startSessionRead(sessionRequest);
}
export const endSession = (csrf: string) =>
  productRequest<LogoutDto>('/api/auth/logout', { method: 'POST', csrf });
export const loadCapabilities = () => productRequest<DmsCapabilitiesDto>('/api/dms/capabilities');
