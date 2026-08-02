import { describe, expect, it } from 'vitest';

import { buildOnboardingStepKeys } from './constants';

describe('buildOnboardingStepKeys', () => {
  it('includes identity when OIDC name is absent', () => {
    expect(
      buildOnboardingStepKeys({ needsIdentity: true, preferenceStepsEnabled: false }),
    ).toEqual([
      'intro',
      'identity',
      'time-and-place',
      'focus-areas',
      'people',
      'connect-source',
      'trust-dial',
      'run-first-sync',
    ]);
  });

  it('skips identity when name came from OIDC', () => {
    expect(
      buildOnboardingStepKeys({ needsIdentity: false, preferenceStepsEnabled: false }),
    ).toEqual([
      'intro',
      'time-and-place',
      'focus-areas',
      'people',
      'connect-source',
      'trust-dial',
      'run-first-sync',
    ]);
  });

  it('inserts preference steps when feature flag is on', () => {
    const keys = buildOnboardingStepKeys({ needsIdentity: false, preferenceStepsEnabled: true });

    expect(keys).toContain('preferences-food');
    expect(keys).toContain('preferences-movie');
    expect(keys).toContain('preferences-activity');
    expect(keys.indexOf('people')).toBeLessThan(keys.indexOf('preferences-food'));
    expect(keys.indexOf('preferences-activity')).toBeLessThan(keys.indexOf('connect-source'));
  });
});
