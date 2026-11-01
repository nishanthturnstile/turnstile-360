import { oauthProvider } from '@better-auth/oauth-provider';
import { DMS_MACHINE_SCOPES } from '@thaarei/dms-contracts';
import type { BetterAuthOptions } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { admin } from 'better-auth/plugins/admin';
import { jwt } from 'better-auth/plugins/jwt';
import type { AuthorityConfiguration } from './authority-configuration.js';
import { isOAuthOperator, managedClientId } from './oauth-operator-context.js';
import { enforceOAuthPolicy, LOGIN_SCOPES } from './oauth-policy.js';
import type { RecoveryDelivery } from './recovery-delivery.js';

// Pure options only: no pool, schema sync, listener, account creation or Nest bootstrap.
// AUTH-02 supplies the owned adapter and recovery delivery before mounting a handler.
export function createAuthorityOptions(
  config: AuthorityConfiguration,
  delivery?: RecoveryDelivery,
) {
  return {
    appName: 'Thaarei Identity',
    baseURL: config.AUTH_PUBLIC_ORIGIN,
    basePath: '/identity',
    secret: config.AUTH_SECRET,
    logger: { disabled: true },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        await enforceOAuthPolicy(context, config);
        if (['/request-password-reset', '/send-verification-email'].includes(context.path)) {
          if (!delivery) throw new Error('Recovery is unavailable in the CLI context');
          // Runs before account lookup for known and unknown addresses alike, after router rate limiting.
          await delivery.verify();
        }
      }),
    },
    trustedOrigins: [config.AUTH_PUBLIC_ORIGIN],
    disabledPaths: ['/token'],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: true,
      minPasswordLength: 15,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 1800,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
        if (!delivery) throw new Error('Recovery delivery is unavailable in the CLI context');
        await delivery.send(user.email, 'reset', url);
      },
    },
    emailVerification: {
      expiresIn: 1800,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
        if (!delivery) throw new Error('Recovery delivery is unavailable in the CLI context');
        await delivery.send(user.email, 'verify', url);
      },
    },
    session: { expiresIn: 28800, disableSessionRefresh: true, cookieCache: { enabled: false } },
    account: { encryptOAuthTokens: true, accountLinking: { enabled: false } },
    rateLimit: { enabled: true, storage: 'database' },
    advanced: {
      useSecureCookies: new URL(config.AUTH_PUBLIC_ORIGIN).protocol === 'https:',
      cookiePrefix: 'thaarei-identity',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
      crossSubDomainCookies: { enabled: false },
      disableCSRFCheck: false,
      disableOriginCheck: false,
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
    },
    plugins: [
      admin(),
      jwt({
        jwks: { keyPairConfig: { alg: config.AUTH_SIGNING_ALGORITHM } },
        jwt: { issuer: config.AUTH_ISSUER_URL, expirationTime: '5m' },
        disableSettingJwtHeader: true,
      }),
      oauthProvider({
        loginPage: `${config.AUTH_PUBLIC_ORIGIN}/sign-in`,
        consentPage: `${config.AUTH_PUBLIC_ORIGIN}/sign-in`,
        scopes: [...LOGIN_SCOPES, ...DMS_MACHINE_SCOPES],
        grantTypes: ['authorization_code', 'refresh_token', 'client_credentials'],
        accessTokenExpiresIn: 300,
        m2mAccessTokenExpiresIn: 300,
        idTokenExpiresIn: 300,
        codeExpiresIn: 300,
        refreshTokenExpiresIn: 28800,
        refreshTokenReuseInterval: 0,
        enforcePerClientResources: true,
        storeClientSecret: 'hashed',
        storeTokens: 'hashed',
        clientReference: () => config.INSTALLATION_TENANT_ID,
        generateClientId: managedClientId,
        allowDynamicClientRegistration: false,
        allowUnauthenticatedClientRegistration: false,
        validateRedirectUri: (uri, registeredUris, defaultResult) =>
          defaultResult && registeredUris.includes(uri),
        clientPrivileges: ({ user }) => isOAuthOperator() && user?.role === 'admin',
        resourcePrivileges: ({ user }) => isOAuthOperator() && user?.role === 'admin',
      }),
    ],
  } satisfies BetterAuthOptions;
}
