import { randomBytes } from 'node:crypto';

export function authorityEnvironment(): NodeJS.ProcessEnv {
  return {
    AUTH_PROFILE: 'test',
    INSTALLATION_TENANT_ID: '11111111-1111-4111-8111-111111111111',
    INSTALLATION_CUSTOMER_KEY: 'test-customer',
    AUTH_SMTP_HOST: '127.0.0.1',
    AUTH_SMTP_PORT: '1',
    AUTH_SMTP_MODE: 'starttls',
    AUTH_MAIL_FROM: 'identity@example.test',
    AUTH_PUBLIC_ORIGIN: 'http://localhost:5173',
    AUTH_ISSUER_URL: 'http://localhost:5173/identity',
    AUTH_LOGIN_CALLBACK_URL: 'http://localhost:5173/api/auth/callback',
    DMS_RESOURCE_URL: 'http://localhost:3001/v1',
    AUTH_DATABASE_URL: 'postgresql://auth_test:unused@localhost:1/test',
    DMS_DATABASE_URL: 'postgresql://dms_test:unused@localhost:1/test',
    AUTH_SECRET: randomBytes(48).toString('base64url'),
    AUTH_LOGIN_CLIENT_ID: 'test-login',
    DMS_MACHINE_CLIENT_ID: 'test-machine',
  };
}
