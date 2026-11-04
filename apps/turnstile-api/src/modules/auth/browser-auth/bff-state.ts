import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { PeoplePermission, UserAccessContextDto } from '@thaarei/turnstile-contracts';
import type { Session } from 'fastify';
import type { EffectiveAccess } from '../../access/access-evaluator.js';

export const IDLE_MS = 30 * 60 * 1000;
export const ABSOLUTE_MS = 8 * 60 * 60 * 1000;
export const TRANSACTION_MS = 5 * 60 * 1000;
export const REFRESH_LEASE_MS = 15_000;
export const opaque = () => randomBytes(32).toString('base64url');
export function equal(left: unknown, right: string) {
  return (
    typeof left === 'string' &&
    Buffer.byteLength(left) === Buffer.byteLength(right) &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}

export interface UserIdentity {
  user: { id: string; name: string; email: string };
  sid: string;
  accessToken: string;
  refreshToken: string;
  idToken: string;
  accessExpiresAt: number;
  absoluteExpiresAt: number;
  idleExpiresAt: number;
  permissions: PeoplePermission[];
  // Old encrypted sessions acquire their first canonical context on the next
  // verified request. It is mandatory in every current normal-session response.
  access?: UserAccessContextDto;
}
// Encrypted server-only purpose state. Its identity never authenticates normal routes.
export interface InvitationContinuation {
  id: string;
  invitationId: string;
  generation: number;
  credentialDigest: string;
  recoveryEpoch: string;
  csrf: string;
  expiresAt: number;
  setupOperationId: string;
  accepted?: boolean;
  identity?: { kind: 'invitation'; issuer: string; value: UserIdentity; expiresAt: number };
  parent?: UserIdentity;
  logout?: { sid: string; identity?: UserIdentity; expiresAt: number; complete: boolean };
}
export type BffState =
  | {
      kind: 'login';
      issuer: string;
      redirect: string;
      state: string;
      nonce: string;
      verifier: string;
      returnTo: string;
      invitation?: { id: string; invitationId: string; generation: number };
      expiresAt: number;
    }
  | { kind: 'consumed' }
  | { kind: 'restricted' }
  | {
      kind: 'user';
      csrf: string;
      identity: UserIdentity;
      refresh?: { fence: string; startedAt: number };
    }
  | {
      kind: 'logout';
      csrf: string;
      sid: string;
      identity?: UserIdentity;
      expiresAt: number;
      complete: boolean;
    };

declare module 'fastify' {
  interface Session {
    bff?: BffState;
    invitation?: InvitationContinuation;
    bffRevision?: number;
  }
  interface FastifyRequest {
    productUser?: { identity: UserIdentity; csrf: string; access: EffectiveAccess };
  }
}

export function generation(session: Session, id: string): string {
  return (
    (session as Session & { __fastifySessionMetadata?: { generation: string } })
      .__fastifySessionMetadata?.generation ?? id
  );
}
