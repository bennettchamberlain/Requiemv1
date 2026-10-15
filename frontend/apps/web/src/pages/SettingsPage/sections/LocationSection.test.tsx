import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocationSection } from './LocationSection';

const h = vi.hoisted(() => ({
  mode: 'off' as 'off' | 'when_in_use' | 'always',
  setMode: vi.fn(),
  needsSettingsUpgrade: false,
  isNativePlatform: vi.fn(() => false),
  isIosPlatform: vi.fn(() => false),
  isAndroidPlatform: vi.fn(() => false),
  fetchJson: vi.fn(),
  openNativeLocationSettings: vi.fn(),
}));

vi.mock('@/hooks', () => ({
  useAuth: () => [{ authToken: 'token', authenticated: true }, {}],
  useLocationTracking: () => ({
    mode: h.mode,
    setMode: h.setMode,
    needsSettingsUpgrade: h.needsSettingsUpgrade,
  }),
}));

vi.mock('@ci/common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ci/common')>()),
  fetchJson: h.fetchJson,
  isNativePlatform: h.isNativePlatform,
  isIosPlatform: h.isIosPlatform,
  isAndroidPlatform: h.isAndroidPlatform,
  openNativeLocationSettings: h.openNativeLocationSettings,
}));

beforeEach(() => {
  h.mode = 'off';
  h.needsSettingsUpgrade = false;
  h.setMode.mockReset();
  h.isNativePlatform.mockReset();
  h.isNativePlatform.mockReturnValue(false);
  h.isIosPlatform.mockReset();
  h.isIosPlatform.mockReturnValue(false);
  h.isAndroidPlatform.mockReset();
  h.isAndroidPlatform.mockReturnValue(false);
  h.fetchJson.mockReset();
  h.fetchJson.mockResolvedValue({ total: 0, byProvider: {}, lastFixAt: null });
  h.openNativeLocationSettings.mockReset();
});

describe('LocationSection', () => {
  it('offers Off and While using on web, not Always', async () => {
    render(<LocationSection />);
    await waitFor(() => expect(h.fetchJson).toHaveBeenCalled());

    expect(screen.getByRole('radio', { name: 'Off' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'While using' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Always' })).not.toBeInTheDocument();
    expect(screen.getByText(/Background location is on the mobile app/)).toBeInTheDocument();
  });

  it('offers Always on native (iOS or Android)', async () => {
    h.isNativePlatform.mockReturnValue(true);
    render(<LocationSection />);
    await waitFor(() => expect(h.fetchJson).toHaveBeenCalled());

    expect(screen.getByRole('radio', { name: 'Always' })).toBeInTheDocument();
    expect(screen.queryByText(/Background location is on the mobile app/)).not.toBeInTheDocument();
  });

  it('shows the While using disclosure with Agree before enabling', async () => {
    render(<LocationSection />);
    await waitFor(() => expect(h.fetchJson).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('radio', { name: 'While using' }));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/Use your location while using Companion/)).toBeInTheDocument();
    expect(h.setMode).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Agree' }));

    expect(h.setMode).toHaveBeenCalledWith('when_in_use');
  });

  it('shows the Always disclosure on native and requires Agree', async () => {
    h.isNativePlatform.mockReturnValue(true);
    h.isIosPlatform.mockReturnValue(true);
    render(<LocationSection />);
    await waitFor(() => expect(h.fetchJson).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('radio', { name: 'Always' }));

    expect(screen.getByText(/Remember places in the background/)).toBeInTheDocument();
    expect(screen.getByText(/no solid blue location indicator/)).toBeInTheDocument();
    expect(screen.getByText(/iOS asks twice/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Agree' }));

    expect(h.setMode).toHaveBeenCalledWith('always');
  });

  it('turns off without a disclosure', async () => {
    h.mode = 'when_in_use';
    render(<LocationSection />);
    await waitFor(() => expect(h.fetchJson).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('radio', { name: 'Off' }));

    expect(h.setMode).toHaveBeenCalledWith('off');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('offers Open Settings when Always was requested but the OS did not grant background access', async () => {
    h.isNativePlatform.mockReturnValue(true);
    h.mode = 'when_in_use';
    h.needsSettingsUpgrade = true;
    render(<LocationSection />);
    await waitFor(() => expect(h.fetchJson).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));

    expect(h.openNativeLocationSettings).toHaveBeenCalledTimes(1);
  });
});

describe('LocationSection background-location disclosure copy', () => {
  async function openAlwaysDialog() {
    h.isNativePlatform.mockReturnValue(true);
    render(<LocationSection />);
    await waitFor(() => expect(h.fetchJson).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('radio', { name: 'Always' }));

    return screen.getByRole('alertdialog');
  }

  it('on iOS explains the quiet indicator and the two-step prompt, and says nothing about Android', async () => {
    h.isIosPlatform.mockReturnValue(true);

    const dialog = await openAlwaysDialog();

    expect(dialog).toHaveTextContent('no solid blue location indicator');
    expect(dialog).toHaveTextContent('iOS asks twice');
    expect(dialog).not.toHaveTextContent('Android');
  });

  it('on Android explains moving-only recording, its notification and Allow all the time, and says nothing about iPhone or activity', async () => {
    h.isAndroidPlatform.mockReturnValue(true);

    const dialog = await openAlwaysDialog();

    expect(dialog).toHaveTextContent('only while you are on the move');
    expect(dialog).toHaveTextContent('A notification shows while that is happening');
    expect(dialog).toHaveTextContent('Allow all the time');
    expect(dialog).not.toHaveTextContent(/iPhone|iOS/);
    // Background sampling needs no "Physical activity" grant; the copy must not suggest one.
    expect(dialog).not.toHaveTextContent(/physical activity/i);
  });
});
