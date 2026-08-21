import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocationSection } from './LocationSection';

const h = vi.hoisted(() => ({
  mode: 'off' as 'off' | 'when_in_use' | 'always',
  setMode: vi.fn(),
  needsSettingsUpgrade: false,
  isIosPlatform: vi.fn(() => false),
  fetchJson: vi.fn(),
  openNativeAppSettings: vi.fn(),
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
  isIosPlatform: h.isIosPlatform,
  openNativeAppSettings: h.openNativeAppSettings,
}));

beforeEach(() => {
  h.mode = 'off';
  h.needsSettingsUpgrade = false;
  h.setMode.mockReset();
  h.isIosPlatform.mockReset();
  h.isIosPlatform.mockReturnValue(false);
  h.fetchJson.mockReset();
  h.fetchJson.mockResolvedValue({ total: 0, byProvider: {}, lastFixAt: null });
  h.openNativeAppSettings.mockReset();
});

describe('LocationSection', () => {
  it('offers Off and While using on web, not Always', async () => {
    render(<LocationSection />);
    await waitFor(() => expect(h.fetchJson).toHaveBeenCalled());

    expect(screen.getByRole('radio', { name: 'Off' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'While using' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Always' })).not.toBeInTheDocument();
    expect(screen.getByText(/Background location is on the iPhone app/)).toBeInTheDocument();
  });

  it('offers Always on iPhone', async () => {
    h.isIosPlatform.mockReturnValue(true);
    render(<LocationSection />);
    await waitFor(() => expect(h.fetchJson).toHaveBeenCalled());

    expect(screen.getByRole('radio', { name: 'Always' })).toBeInTheDocument();
    expect(screen.queryByText(/Background location is on the iPhone app/)).not.toBeInTheDocument();
  });

  it('shows the While using disclosure with Agree before enabling', async () => {
    render(<LocationSection />);
    await waitFor(() => expect(h.fetchJson).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('radio', { name: 'While using' }));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/Record your location while using Companion/)).toBeInTheDocument();
    expect(h.setMode).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Agree' }));

    expect(h.setMode).toHaveBeenCalledWith('when_in_use');
  });

  it('shows the Always disclosure on iPhone and requires Agree', async () => {
    h.isIosPlatform.mockReturnValue(true);
    render(<LocationSection />);
    await waitFor(() => expect(h.fetchJson).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('radio', { name: 'Always' }));

    expect(screen.getByText(/Remember places in the background/)).toBeInTheDocument();
    expect(screen.getByText(/blue location indicator/)).toBeInTheDocument();

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

  it('offers Open iOS Settings when Always was requested but the OS stayed on While Using', async () => {
    h.isIosPlatform.mockReturnValue(true);
    h.mode = 'when_in_use';
    h.needsSettingsUpgrade = true;
    render(<LocationSection />);
    await waitFor(() => expect(h.fetchJson).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Open iOS Settings' }));

    expect(h.openNativeAppSettings).toHaveBeenCalledTimes(1);
  });
});
