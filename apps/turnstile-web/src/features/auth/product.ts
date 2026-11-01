import type {
  AuthErrorCode,
  DmsCapabilitiesDto,
  DmsIntegrationErrorDto,
  LogoutDto,
  UserSessionDto,
} from '@thaarei/turnstile-contracts';

type ProductErrorCode = AuthErrorCode | DmsIntegrationErrorDto['code'];
export class ProductError extends Error {
  readonly status: number;
  readonly code: ProductErrorCode;
  constructor(status: number, code: ProductErrorCode) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, csrf?: string): Promise<T> {
  try {
    const response = await fetch(path, {
      method: csrf ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: {
        accept: 'application/json',
        ...(csrf ? { 'x-csrf-token': csrf, 'content-type': 'application/json' } : {}),
      },
      ...(csrf ? { body: '{}' } : {}),
    });
    const value = await response.json();
    if (!response.ok) {
      const known: ProductErrorCode[] = [
        'IDENTITY_REQUIRED',
        'LOGIN_REQUIRED',
        'PRODUCT_ACCESS_DENIED',
        'PERMISSION_DENIED',
        'CSRF_REJECTED',
        'AUTH_UNAVAILABLE',
        'REFRESH_IN_PROGRESS',
        'DMS_ACCESS_DENIED',
        'DMS_UNAVAILABLE',
      ];
      throw new ProductError(
        response.status,
        known.includes(value?.code) ? value.code : 'AUTH_UNAVAILABLE',
      );
    }
    return value as T;
  } catch (error) {
    if (error instanceof ProductError) throw error;
    throw new ProductError(503, 'AUTH_UNAVAILABLE');
  }
}
let sessionRequest: Promise<UserSessionDto> | undefined;
export function loadSession() {
  // Share only the in-flight request (StrictMode, focus and visibility can overlap).
  // Drop it on completion; every subsequent check still asks the backend.
  sessionRequest ??= request<UserSessionDto>('/api/auth/session').finally(() => {
    sessionRequest = undefined;
  });
  return sessionRequest;
}
export const endSession = (csrf: string) => request<LogoutDto>('/api/auth/logout', csrf);
export const loadCapabilities = () => request<DmsCapabilitiesDto>('/api/dms/capabilities');
