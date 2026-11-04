import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { parseInvitationEnvironment } from './invitation-environment.js';
export const mailPayload = z.strictObject({
  email: z.email(),
  invitationId: z.uuid(),
  generation: z.number().int().positive(),
  expiresAt: z.iso.datetime(),
  link: z.url(),
  roles: z.array(z.string().max(200)).max(32),
});
export type InvitationMailPayload = z.infer<typeof mailPayload>;
export function sealPayload(
  config: ReturnType<typeof parseInvitationEnvironment>,
  payload: InvitationMailPayload,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(config.TURNSTILE_INVITATION_ENCRYPTION_KEY, 'hex'),
    iv,
  );
  cipher.setAAD(
    Buffer.from(
      `${config.INSTALLATION_TENANT_ID}:${payload.invitationId}:${payload.generation}:${config.recoveryEpoch}`,
    ),
  );
  return Buffer.concat([
    iv,
    cipher.update(JSON.stringify(payload)),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64url');
}
export function openPayload(
  config: ReturnType<typeof parseInvitationEnvironment>,
  id: string,
  generation: number,
  value: string,
) {
  const bytes = Buffer.from(value, 'base64url');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(config.TURNSTILE_INVITATION_ENCRYPTION_KEY, 'hex'),
    bytes.subarray(0, 12),
  );
  decipher.setAAD(
    Buffer.from(`${config.INSTALLATION_TENANT_ID}:${id}:${generation}:${config.recoveryEpoch}`),
  );
  decipher.setAuthTag(bytes.subarray(-16));
  const payload = mailPayload.parse(
    JSON.parse(
      Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString(),
    ),
  );
  const url = new URL(payload.link);
  if (
    payload.invitationId !== id ||
    payload.generation !== generation ||
    url.origin !== config.AUTH_PUBLIC_ORIGIN ||
    url.pathname !== '/invitations/join' ||
    url.search ||
    !/^#[A-Za-z0-9_-]{43}$/.test(url.hash)
  )
    throw new Error('Invalid delivery binding');
  return payload;
}
