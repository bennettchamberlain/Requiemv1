import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerNativePushToken } from './registerNativePushToken';

const h = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
}));

vi.mock('@ci/common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ci/common')>();

  return {
    ...actual,
    isNativePlatform: h.isNativePlatform,
  };
});

afterEach(() => {
  h.isNativePlatform.mockReturnValue(false);
  vi.unstubAllGlobals();
});

describe('registerNativePushToken', () => {
  it('is a no-op on web', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await registerNativePushToken();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('registers the token and POSTs /api/devices on native', async () => {
    h.isNativePlatform.mockReturnValue(true);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ device_id: 'dev-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    window.fetch = fetchMock as typeof fetch;

    const remove = vi.fn();
    const register = vi.fn().mockResolvedValue(undefined);
    const requestPermissions = vi.fn().mockResolvedValue({ receive: 'granted' });
    const addListener = vi.fn(async (_event: string, cb: (token: { value: string }) => void) => {
      cb({ value: 'apns-token' });

      return { remove };
    });

    vi.stubGlobal('Capacitor', {
      getPlatform: () => 'ios',
      Plugins: { PushNotifications: { requestPermissions, register, addListener } },
    });
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      getPlatform: () => 'ios',
      Plugins: { PushNotifications: { requestPermissions, register, addListener } },
    };

    await registerNativePushToken();

    await waitFor(() => {
      expect(register).toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalled();
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(init?.body)).push_token).toBe('apns-token');
  });
});
