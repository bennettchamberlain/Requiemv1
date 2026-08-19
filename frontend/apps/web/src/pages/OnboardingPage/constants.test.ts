import { describe, expect, it } from 'vitest';

import { buildOnboardingStepKeys } from './constants';

describe('buildOnboardingStepKeys', () => {
  it('includes identity when OIDC name is absent', () => {
    expect(buildOnboardingStepKeys({ needsIdentity: true, preferenceStepsEnabled: false })).toEqual([
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
    expect(buildOnboardingStepKeys({ needsIdentity: false, preferenceStepsEnabled: false })).toEqual([
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

  it('offers the import step when importing is enabled, right after connect-source', () => {
    const keys = buildOnboardingStepKeys({
      needsIdentity: false,
      preferenceStepsEnabled: false,
      importEnabled: true,
    });

    // Directly after connect-source: both answer "where does my memory come
    // from", and an export is the high-value one someone may already have.
    expect(keys.indexOf('import-archives')).toBe(keys.indexOf('connect-source') + 1);
    expect(keys.indexOf('import-archives')).toBeLessThan(keys.indexOf('trust-dial'));
  });

  it('leaves the step out when the appliance does not serve importing', () => {
    // Same flag /import is routed behind — otherwise the step leads nowhere.
    const keys = buildOnboardingStepKeys({
      needsIdentity: false,
      preferenceStepsEnabled: false,
      importEnabled: false,
    });

    expect(keys).not.toContain('import-archives');
  });

  it('never makes the import step the last one, so it is always skippable onward', () => {
    const keys = buildOnboardingStepKeys({
      needsIdentity: true,
      preferenceStepsEnabled: true,
      importEnabled: true,
    });

    expect(keys[keys.length - 1]).toBe('run-first-sync');
    expect(keys.indexOf('import-archives')).toBeGreaterThan(-1);
    expect(keys.indexOf('import-archives')).toBeLessThan(keys.length - 1);
  });
});
