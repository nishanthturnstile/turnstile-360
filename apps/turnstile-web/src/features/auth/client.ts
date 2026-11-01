import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import { createAuthClient } from 'better-auth/react';

// The supported plugin preserves the issuer-signed OAuth query on credential submission.
// Its redirect plugin follows the provider's response; the browser never exchanges codes.
export const identity = createAuthClient({
  baseURL: window.location.origin,
  basePath: '/identity',
  plugins: [oauthProviderClient()],
  fetchOptions: {
    credentials: 'same-origin',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    timeout: 10000,
    retry: 0,
  },
});

export function authMessage(code: string | undefined, status?: number) {
  if (status === 429) return 'Too many attempts. Wait a moment, then try again.';
  if (status && status >= 500) return 'Sign-in is temporarily unavailable. Please try again.';
  if (code === 'EMAIL_NOT_VERIFIED') return 'Verify your email before signing in.';
  if (code === 'INVALID_TOKEN' || code === 'TOKEN_EXPIRED')
    return 'This link has expired or has already been used. Request a new one.';
  if (code === 'INVALID_PASSWORD' || code === 'INVALID_EMAIL_OR_PASSWORD')
    return 'Check your email and password, then try again.';
  return 'We couldn’t complete that request. Please try again or start sign-in again.';
}

export function beginSignIn() {
  window.location.assign('/api/auth/login');
}

export function captureResetToken() {
  if (window.location.pathname !== '/reset-password') return undefined;
  const params = new URLSearchParams(window.location.search);
  const value = params.getAll('token');
  // Keep recovery material in memory only, and remove it before rendering or other requests.
  window.history.replaceState(null, '', '/reset-password');
  return value.length === 1 && /^[A-Za-z0-9_-]{10,512}$/.test(value[0] ?? '')
    ? value[0]
    : undefined;
}
