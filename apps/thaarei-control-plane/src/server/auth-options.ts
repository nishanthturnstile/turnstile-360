import type { BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins/two-factor';
import type { Configuration } from './config.ts';

export function authOptions(
  config: Configuration,
  send?: (email: string, kind: string, url: string) => Promise<void>,
  verifyMail?: () => Promise<unknown>,
) {
  const deliver = async (email: string, kind: string, url: string) => {
    if (!send) throw new Error('Email delivery unavailable');
    await send(email, kind, url);
  };
  return {
    appName: 'Thaarei Control Plane',
    baseURL: config.origin,
    basePath: '/api/auth',
    secret: config.secret,
    logger: { disabled: true },
    trustedOrigins: [config.origin],
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (!['/request-password-reset', '/send-verification-email'].includes(context.path)) return;
        // Native HTTP rate limiting runs before this hook. Check transport before account
        // lookup for known and unknown addresses alike, without letting rejected floods hit SMTP.
        try {
          if (!verifyMail) throw new Error('Recovery delivery unavailable');
          await verifyMail();
        } catch {
          throw new APIError('SERVICE_UNAVAILABLE', { message: 'Recovery delivery unavailable' });
        }
      }),
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: true,
      minPasswordLength: 15,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 1800,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) => deliver(user.email, 'Reset your password', url),
    },
    emailVerification: {
      expiresIn: 1800,
      autoSignInAfterVerification: false,
      sendVerificationEmail: ({ user, url }) => deliver(user.email, 'Verify your email', url),
    },
    session: { expiresIn: 28800, disableSessionRefresh: true, cookieCache: { enabled: false } },
    account: { accountLinking: { enabled: false } },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: {
        '/two-factor/verify-totp': { window: 60, max: 10 },
        '/two-factor/verify-backup-code': { window: 60, max: 10 },
      },
    },
    advanced: {
      cookiePrefix: 'thaarei-control-plane',
      useSecureCookies: config.origin.startsWith('https:'),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
      crossSubDomainCookies: { enabled: false },
      disableCSRFCheck: false,
      disableOriginCheck: false,
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
    },
    plugins: [
      twoFactor({ issuer: 'Thaarei', backupCodeOptions: { storeBackupCodes: 'encrypted' } }),
    ],
  } satisfies BetterAuthOptions;
}
