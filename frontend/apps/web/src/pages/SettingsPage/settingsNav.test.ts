import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SETTINGS_SECTIONS, settingsPathToProfile, visibleSettingsSections } from './settingsNav';

const isIosPlatform = vi.hoisted(() => vi.fn(() => false));

vi.mock('@ci/common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ci/common')>()),
  isIosPlatform: () => isIosPlatform(),
}));

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
  beforeEach(() => {
    isIosPlatform.mockReturnValue(false);
  });

  it('starts with appearance', () => {
    expect(SETTINGS_SECTIONS[0]?.id).toBe('appearance');
  });

  it('hides Safari off iOS and shows it on the Memory iPhone app', () => {
    expect(visibleSettingsSections().some((section) => section.id === 'safari')).toBe(false);
    isIosPlatform.mockReturnValue(true);
    expect(visibleSettingsSections().some((section) => section.id === 'safari')).toBe(true);
  });
});
