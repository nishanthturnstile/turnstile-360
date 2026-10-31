import { AsyncLocalStorage } from 'node:async_hooks';
import nodemailer from 'nodemailer';
import type { AuthorityConfiguration } from './authority-configuration.js';

export interface RecoveryDelivery {
  send(to: string, purpose: 'verify' | 'reset', url: string): Promise<void>;
  verify(): Promise<void>;
  run<T>(operation: () => Promise<T>): Promise<T>;
}

export function createRecoveryDelivery(config: AuthorityConfiguration): RecoveryDelivery {
  const deliveryState = new AsyncLocalStorage<{ failed: boolean }>();
  const transport = nodemailer.createTransport({
    host: config.AUTH_SMTP_HOST,
    port: config.AUTH_SMTP_PORT,
    secure: config.AUTH_SMTP_MODE === 'tls',
    requireTLS: config.AUTH_SMTP_MODE === 'starttls',
    ignoreTLS: config.AUTH_SMTP_MODE === 'plain',
    ...(config.AUTH_SMTP_USER && config.AUTH_SMTP_PASSWORD
      ? {
          auth: { user: config.AUTH_SMTP_USER, pass: config.AUTH_SMTP_PASSWORD },
        }
      : {}),
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    async verify() {
      try {
        await transport.verify();
      } catch {
        throw new Error('Account email delivery unavailable');
      }
    },
    async run(operation) {
      return deliveryState.run({ failed: false }, async () => {
        const result = await operation();
        // The pinned library catches background mail errors; retain a per-request failure signal.
        if (deliveryState.getStore()?.failed) throw new Error('Account email delivery unavailable');
        return result;
      });
    },
    async send(to, purpose, link) {
      try {
        const url = new URL(link);
        if (
          url.origin !== config.AUTH_PUBLIC_ORIGIN ||
          (purpose === 'verify'
            ? url.pathname !== '/identity/verify-email'
            : !url.pathname.startsWith('/identity/reset-password/'))
        ) {
          throw new Error('Invalid recovery destination');
        }
        const result = await transport.sendMail({
          from: config.AUTH_MAIL_FROM,
          to,
          subject:
            purpose === 'verify' ? 'Verify your account email' : 'Reset your account password',
          text: `${purpose === 'verify' ? 'Verify your email' : 'Reset your password'} using this link. It expires in 30 minutes.\n\n${url.href}\n\nIf you did not request this, contact your administrator.`,
        });
        if (result.rejected.length) throw new Error('Recipient rejected');
      } catch {
        const state = deliveryState.getStore();
        if (state) state.failed = true;
        // SMTP exceptions may include recipients, credentials or message contents.
        throw new Error('Account email delivery unavailable');
      }
    },
  };
}
