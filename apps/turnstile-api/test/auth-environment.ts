import { randomBytes } from 'node:crypto';

export function productEnvironment(): NodeJS.ProcessEnv {
  return {
    AUTH_PROFILE: 'test',
    INSTALLATION_TENANT_ID: '11111111-1111-4111-8111-111111111111',
    INSTALLATION_CUSTOMER_KEY: 'test-customer',
    TURNSTILE_APPLICATION_ID: '22222222-2222-4222-8222-222222222222',
    AUTH_PUBLIC_ORIGIN: 'http://localhost:5173',
    AUTH_ISSUER_URL: 'http://localhost:5173/identity',
    AUTH_LOGIN_CALLBACK_URL: 'http://localhost:5173/api/auth/callback',
    AUTH_LOGIN_CLIENT_ID: 'test-login',
    AUTH_LOGIN_CLIENT_SECRET: randomBytes(48).toString('base64url'),
    DMS_MACHINE_CLIENT_ID: 'test-machine',
    DMS_MACHINE_CLIENT_SECRET: randomBytes(48).toString('base64url'),
    DMS_RESOURCE_URL: 'http://localhost:3001/v1',
    DMS_API_URL: 'http://localhost:3001/v1',
    TURNSTILE_DATABASE_URL: 'postgresql://turnstile_test:unused@localhost:1/test',
    TURNSTILE_COOKIE_SECRET: randomBytes(48).toString('base64url'),
    TURNSTILE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  };
}
