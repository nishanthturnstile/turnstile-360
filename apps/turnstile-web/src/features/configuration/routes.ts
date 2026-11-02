import type { ConfigurationSnapshotDto } from '@thaarei/turnstile-contracts';
export const setupPaths = [
  '/onboarding/organization',
  '/onboarding/structure',
  '/onboarding/review',
  '/onboarding/paused',
] as const;
export function resumePath(snapshot: ConfigurationSnapshotDto) {
  return snapshot.setup.nextStep === 'organization' ? setupPaths[0] : setupPaths[2];
}

export const settingsPaths = [
  '/settings',
  '/settings/organization',
  '/settings/organization/structure',
  '/settings/workspace',
] as const;
