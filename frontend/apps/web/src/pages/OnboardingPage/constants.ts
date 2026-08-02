export const ONBOARDING_STEP_KEYS = [
  'intro',
  'identity',
  'time-and-place',
  'focus-areas',
  'people',
  'preferences-food',
  'preferences-movie',
  'preferences-activity',
  'connect-source',
  'trust-dial',
  'run-first-sync',
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number];

/** Set before OAuth top-level navigation; cleared when onboarding restores the connect step. */
export const ONBOARDING_OAUTH_RESUME_KEY = 'onboarding-resume';

export const CHROME_EXTENSION_URL =
  'https://chromewebstore.google.com/detail/companion-intelligence/bcocflgkdeimninckpmdifcniajoneih?authuser=3&hl=en';

export const CI_DOWNLOAD_URL = 'https://ci.computer/download';

export const IMPORT_TOOLS_URL = 'https://hub.ci.computer/store/ci-import-tools';

export const BROWSER_TIMEZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

export function buildOnboardingStepKeys(options: {
  needsIdentity: boolean;
  preferenceStepsEnabled: boolean;
}): OnboardingStepKey[] {
  const keys: OnboardingStepKey[] = ['intro'];

  if (options.needsIdentity) {
    keys.push('identity');
  }

  keys.push('time-and-place', 'focus-areas', 'people');

  if (options.preferenceStepsEnabled) {
    keys.push('preferences-food', 'preferences-movie', 'preferences-activity');
  }

  keys.push('connect-source', 'trust-dial', 'run-first-sync');

  return keys;
}
