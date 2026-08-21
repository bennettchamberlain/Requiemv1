import { describe, expect, it } from 'vitest';

import { SETTINGS_SECTIONS, settingsPathToProfile } from './settingsNav';

describe('settingsPathToProfile', () => {
  it('sends the settings root to the profile hub', () => {
    expect(settingsPathToProfile('/settings')).toBe('/profile');
    expect(settingsPathToProfile('/settings/')).toBe('/profile');
  });

  it('keeps the section on the profile page', () => {
    expect(settingsPathToProfile('/settings/appearance')).toBe('/profile/appearance');
    expect(settingsPathToProfile('/settings/account')).toBe('/profile/account');
  });
});

describe('SETTINGS_SECTIONS', () => {
  it('starts with appearance', () => {
    expect(SETTINGS_SECTIONS[0]?.id).toBe('appearance');
  });
});
