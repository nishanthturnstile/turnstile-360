import type { DeploymentStatusDto, UserSessionDto } from '@thaarei/turnstile-contracts';
export const usersPaths = [
  '/people/members',
  '/people/invitations',
  '/people/roles',
  '/people/activity',
];
export const peoplePaths = [...usersPaths, '/structure'];
export const USERS_CONTEXT_MS = 30_000;
export interface UsersContextStamp {
  path: string;
  userId: string;
  fingerprint: string;
  checkedAt: number;
  complete: boolean;
  deployment: DeploymentStatusDto;
}
/** Reuse only non-auth context; the caller has already verified a live session/deployment. */
export function canReuseUsersContext(
  previous: UsersContextStamp,
  path: string,
  session: UserSessionDto,
  deployment: DeploymentStatusDto,
  now: number,
) {
  return (
    previous.complete &&
    previous.path !== path &&
    usersPaths.includes(previous.path) &&
    usersPaths.includes(path) &&
    previous.userId === session.user.id &&
    previous.fingerprint === session.access.fingerprint &&
    previous.deployment.access === deployment.access &&
    previous.deployment.state === deployment.state &&
    now >= previous.checkedAt &&
    now - previous.checkedAt < USERS_CONTEXT_MS
  );
}
