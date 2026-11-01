import { authorityEnvironment } from '../../../test/auth-environment.js';
import { parseAuthorityEnvironment } from './authority-configuration.js';
import { createAuthorityOptions } from './authority-options.js';

describe('authority configuration boundary', () => {
  it.each(['local', 'test', 'production'])('accepts the explicit %s profile', (profile) => {
    const env = authorityEnvironment();
    env.AUTH_PROFILE = profile;
    if (profile === 'production') {
      env.NODE_ENV = 'production';
      env.AUTH_PUBLIC_ORIGIN = 'https://platform.customer.example';
      env.AUTH_ISSUER_URL = `${env.AUTH_PUBLIC_ORIGIN}/identity`;
      env.AUTH_LOGIN_CALLBACK_URL = `${env.AUTH_PUBLIC_ORIGIN}/api/auth/callback`;
      env.DMS_RESOURCE_URL = 'https://dms.customer.example/v1';
    }
    const options = createAuthorityOptions(parseAuthorityEnvironment(env));
    expect(options.advanced.useSecureCookies).toBe(profile === 'production');
    expect(options.plugins.map((plugin) => plugin.id)).toEqual(['admin', 'jwt', 'oauth-provider']);
    expect(options.session.cookieCache.enabled).toBe(false);
    expect(options.disabledPaths).toContain('/token');
  });

  it.each([
    ['AUTH_SECRET', ''],
    ['AUTH_SECRET', 'a'.repeat(64)],
    ['AUTH_SECRET', 'replace-with-a-generated-example-secret'],
    ['AUTH_ISSUER_URL', 'http://localhost:5173/wrong'],
    ['AUTH_PUBLIC_ORIGIN', 'http://*.example.com'],
    ['AUTH_PUBLIC_ORIGIN', 'http://localhost:5173/'],
    ['AUTH_LOGIN_CALLBACK_URL', 'http://localhost:5173/api/auth/callback?redirect=elsewhere'],
    ['AUTH_LOGIN_CALLBACK_URL', 'http://attacker.example/api/auth/callback'],
    ['DMS_RESOURCE_URL', 'not-a-url'],
    ['DMS_RESOURCE_URL', 'http://user:secret@localhost:3001/v1'],
    ['AUTH_DATABASE_URL', 'https://localhost/auth'],
    ['DMS_DATABASE_URL', 'postgresql://auth_test:unused@localhost:1/test'],
    ['DMS_MACHINE_CLIENT_ID', 'test-login'],
    ['AUTH_SIGNING_ALGORITHM', 'HS256'],
    ['AUTH_PROFILE', 'production'],
    ['NODE_ENV', 'production'],
  ])('rejects unsafe %s without disclosing its value', (key, value) => {
    const env = { ...authorityEnvironment(), [key]: value };
    expect(() => parseAuthorityEnvironment(env)).toThrow(/Invalid DMS auth configuration:/);
    try {
      parseAuthorityEnvironment(env);
    } catch (error) {
      if (value) expect((error as Error).message).not.toContain(value);
    }
  });

  it('does not invent secrets or clients when unset', () => {
    expect(() => parseAuthorityEnvironment({})).toThrow(/AUTH_SECRET/);
  });
});
