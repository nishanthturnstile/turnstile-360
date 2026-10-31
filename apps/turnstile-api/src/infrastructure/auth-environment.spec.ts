import { productEnvironment } from '../../test/auth-environment.js';
import {
  parseMachineEnvironment,
  parseProductEnvironment,
  productCookiePolicy,
} from './auth-environment.js';

describe('product and machine configuration', () => {
  it.each(['local', 'test', 'production'])('accepts %s with host-only cookie policy', (profile) => {
    const env = productEnvironment();
    env.AUTH_PROFILE = profile;
    if (profile === 'production') {
      env.NODE_ENV = 'production';
      env.AUTH_PUBLIC_ORIGIN = 'https://platform.customer.example';
      env.AUTH_ISSUER_URL = `${env.AUTH_PUBLIC_ORIGIN}/identity`;
      env.AUTH_LOGIN_CALLBACK_URL = `${env.AUTH_PUBLIC_ORIGIN}/api/auth/callback`;
      env.DMS_RESOURCE_URL = 'https://dms.customer.example/v1';
      env.DMS_API_URL = 'http://dms-api:3001/v1';
    }
    expect(parseMachineEnvironment(env).DMS_API_URL).toBe(env.DMS_API_URL);
    expect(productCookiePolicy(parseProductEnvironment(env))).toEqual({
      cookieName: profile === 'production' ? '__Host-turnstile' : 'turnstile',
      secure: profile === 'production',
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
  });

  it.each([
    ['AUTH_LOGIN_CLIENT_SECRET', ''],
    ['TURNSTILE_COOKIE_SECRET', 'short'],
    ['TURNSTILE_TOKEN_ENCRYPTION_KEY', 'bad-key'],
    ['AUTH_LOGIN_CALLBACK_URL', 'https://attacker.example/api/auth/callback'],
    ['AUTH_ISSUER_URL', 'not-a-url'],
    ['TURNSTILE_DATABASE_URL', 'postgresql://localhost/test'],
    ['DMS_MACHINE_CLIENT_ID', 'test-login'],
    ['NODE_ENV', 'production'],
  ])('rejects unsafe product %s', (key, value) => {
    expect(() => parseProductEnvironment({ ...productEnvironment(), [key]: value })).toThrow(
      /Invalid Turnstile auth configuration/,
    );
  });

  it.each([
    ['DMS_MACHINE_CLIENT_SECRET', ''],
    ['DMS_MACHINE_CLIENT_ID', 'test-login'],
    ['DMS_RESOURCE_URL', 'http://attacker.example/v1'],
    ['DMS_API_URL', 'http://localhost:3001/v1#fragment'],
    ['DMS_API_URL', 'not-a-url'],
  ])('rejects unsafe machine %s', (key, value) => {
    expect(() => parseMachineEnvironment({ ...productEnvironment(), [key]: value })).toThrow(
      /Invalid Turnstile DMS configuration/,
    );
  });

  it('rejects reused client/cookie secrets', () => {
    const env = productEnvironment();
    env.DMS_MACHINE_CLIENT_SECRET = env.AUTH_LOGIN_CLIENT_SECRET;
    expect(() => parseMachineEnvironment(env)).toThrow(/DMS_MACHINE_CLIENT_SECRET/);
    env.TURNSTILE_COOKIE_SECRET = env.AUTH_LOGIN_CLIENT_SECRET;
    expect(() => parseProductEnvironment(env)).toThrow(/TURNSTILE_COOKIE_SECRET/);
  });
});
