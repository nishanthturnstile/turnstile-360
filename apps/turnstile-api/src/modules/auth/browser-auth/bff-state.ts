import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { TurnstilePermission } from '@thaarei/turnstile-contracts';
import type { Session } from 'fastify';

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
  permissions: TurnstilePermission[];
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
      expiresAt: number;
    }
  | { kind: 'consumed' }
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
    bffRevision?: number;
  }
  interface FastifyRequest {
    productUser?: { identity: UserIdentity; csrf: string };
  }
}

export function generation(session: Session, id: string): string {
  return (
    (session as Session & { __fastifySessionMetadata?: { generation: string } })
      .__fastifySessionMetadata?.generation ?? id
  );
}
