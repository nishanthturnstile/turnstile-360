import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import type { InvitationMailPayload } from './invitation-crypto.js';
import { parseInvitationEnvironment } from './invitation-environment.js';
export type MailOutcome = 'smtp_accepted' | 'smtp_rejected' | 'transport_unavailable' | 'deadline';
@Injectable()
export class InvitationMailService {
  private readonly config: ReturnType<typeof parseInvitationEnvironment> | undefined;
  constructor() {
    try {
      this.config = parseInvitationEnvironment(process.env);
    } catch {
      /* staged */
    }
  }
  async send(payload: InvitationMailPayload): Promise<MailOutcome> {
    const config = this.config;
    if (!config) return 'transport_unavailable';
    const transport = nodemailer.createTransport({
      host: config.TURNSTILE_SMTP_HOST,
      port: config.TURNSTILE_SMTP_PORT,
      secure: false,
      requireTLS: config.AUTH_PROFILE === 'production',
      ignoreTLS: config.AUTH_PROFILE !== 'production',
      connectionTimeout: 3000,
      greetingTimeout: 3000,
      socketTimeout: 8000,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        transport.sendMail({
          from: config.TURNSTILE_MAIL_FROM,
          to: payload.email,
          subject: 'Invitation to Turnstile 360',
          text: `You are invited to Turnstile 360. Review the current access before accepting.\nRoles: ${payload.roles.join(', ')}\nInvitation: ${payload.invitationId}\nGeneration: ${payload.generation}\nExpires: ${payload.expiresAt}\n\n${payload.link}\n\nThis invitation grants no access until you explicitly accept with your verified account.`,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('deadline')), 10000);
        }),
      ]);
      return result.rejected.length
        ? 'smtp_rejected'
        : result.accepted.length
          ? 'smtp_accepted'
          : 'deadline';
    } catch (error) {
      const e = error as {
        code?: string;
        command?: string;
        responseCode?: number;
        syscall?: string;
      };
      if (e.responseCode && e.responseCode >= 500) return 'smtp_rejected';
      if (e.responseCode && e.responseCode >= 400) return 'transport_unavailable';
      if (
        ['EHLO', 'HELO', 'STARTTLS', 'AUTH', 'MAIL FROM', 'RCPT TO'].includes(e.command ?? '') ||
        ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EDNS', 'ETLS'].includes(e.code ?? '') ||
        e.syscall === 'connect'
      )
        return 'transport_unavailable';
      // DATA or a lost final acknowledgement may already have been accepted. Never retry automatically.
      return 'deadline';
    } finally {
      clearTimeout(timer);
      transport.close();
    }
  }
}
