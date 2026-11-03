import type { ConfigurationSnapshotDto } from '@thaarei/turnstile-contracts';
export const setupPaths = [
  '/onboarding/organization',
  '/onboarding/structure',
  '/onboarding/review',
  '/onboarding/paused',
] as const;
export function resumePath(snapshot: ConfigurationSnapshotDto) {
  return snapshot.setup.nextStep === 'organization'
    ? setupPaths[0]
    : snapshot.setup.nextStep === 'structure'
      ? setupPaths[1]
      : setupPaths[2];
}

export function setupRedirect(snapshot: ConfigurationSnapshotDto, path: string) {
  if (snapshot.setup.state === 'completed') return '/';
  if (
    !setupPaths.some((value) => value === path) ||
    (path === setupPaths[2] && snapshot.setup.nextStep !== 'review') ||
    (path === setupPaths[1] && snapshot.setup.nextStep === 'organization')
  )
    return resumePath(snapshot);
  return undefined;
}

export const settingsPaths = [
  '/settings',
  '/settings/organization',
  '/settings/organization/structure',
  '/settings/workspace',
] as const;
