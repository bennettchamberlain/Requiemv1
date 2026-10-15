import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isLocationTrackingEnabled, useLocationTracking } from './useLocationTracking';

const STORAGE_KEY = 'ci-location-tracking-enabled';

const h = vi.hoisted(() => ({
  authToken: null as string | null,
  authenticated: false,
  isNativePlatform: vi.fn(() => false),
  isIosPlatform: vi.fn(() => false),
  captureLocationFix: vi.fn(),
  createLocationSampler: vi.fn(),
  startSignificantLocationUpdates: vi.fn(),
  addAppStateListener: vi.fn(),
  requestNotificationPermission: vi.fn(),
  getNativeLocationAuthorization: vi.fn(),
  requestNativeLocationAuthorization: vi.fn(),
}));

vi.mock('./useAuth', () => ({
  useAuth: () => [{ authToken: h.authToken, authenticated: h.authenticated }, {}],
}));

// The @ci/common seams useLocationTracking pulls on, overridden over the real module so
// nothing rendered here loses an unrelated export. `fixFrom*` adapters are given small
// real-ish implementations (rather than bare mocks) so the fix objects reaching
// `captureLocationFix` reflect the position/location passed to the callback — that's the
// seam this hook actually owns.
vi.mock('@ci/common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ci/common')>()),
  captureLocationFix: h.captureLocationFix,
  createLocationSampler: h.createLocationSampler,
  fixFromGeolocationPosition: (position: GeolocationPosition) => ({
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    capturedAtMs: position.timestamp,
  }),
  fixFromNativeLocationEvent: (location: { latitude: number; longitude: number; time: number }) => ({
    latitude: location.latitude,
    longitude: location.longitude,
    capturedAtMs: location.time,
  }),
  isNativePlatform: h.isNativePlatform,
  isIosPlatform: h.isIosPlatform,
  startSignificantLocationUpdates: h.startSignificantLocationUpdates,
  addAppStateListener: h.addAppStateListener,
  requestNotificationPermission: h.requestNotificationPermission,
  getNativeLocationAuthorization: h.getNativeLocationAuthorization,
  requestNativeLocationAuthorization: h.requestNativeLocationAuthorization,
}));

interface FakeSampler {
  shouldCapture: ReturnType<typeof vi.fn>;
  accept: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  last: null;
}

function newSampler(): FakeSampler {
  return { shouldCapture: vi.fn(() => true), accept: vi.fn(), reset: vi.fn(), last: null };
}

function fakeBackgroundLocation() {
  return {
    latitude: 37.7749,
    longitude: -122.4194,
    accuracy: 10,
    altitude: null,
    altitudeAccuracy: null,
    bearing: null,
    speed: null,
    time: 1_723_500_000_000,
  };
}

/** Installs a fake `navigator.geolocation`, configurable so each test can start clean. */
function installGeolocation() {
  const getCurrentPosition = vi.fn();
  const watchPosition = vi.fn(() => 42);
  const clearWatch = vi.fn();

  Object.defineProperty(globalThis.navigator, 'geolocation', {
    value: { getCurrentPosition, watchPosition, clearWatch },
    configurable: true,
    writable: true,
  });

  return { getCurrentPosition, watchPosition, clearWatch };
}

beforeEach(() => {
  localStorage.clear();
  h.authToken = null;
  h.authenticated = false;
  h.isNativePlatform.mockReset();
  h.isNativePlatform.mockReturnValue(false);
  h.isIosPlatform.mockReset();
  h.isIosPlatform.mockReturnValue(false);
  h.captureLocationFix.mockReset();
  h.captureLocationFix.mockResolvedValue({ status: 'queued', record: {}, id: 'row-1' });
  h.createLocationSampler.mockReset();
  h.createLocationSampler.mockImplementation(newSampler);
  h.startSignificantLocationUpdates.mockReset();
  h.startSignificantLocationUpdates.mockResolvedValue(async () => {});
  h.addAppStateListener.mockReset();
  h.addAppStateListener.mockResolvedValue(() => {});
  h.requestNotificationPermission.mockReset();
  h.requestNotificationPermission.mockResolvedValue(true);
  h.getNativeLocationAuthorization.mockReset();
  h.getNativeLocationAuthorization.mockResolvedValue('notDetermined');
  h.requestNativeLocationAuthorization.mockReset();
  h.requestNativeLocationAuthorization.mockResolvedValue('whenInUse');
});

afterEach(() => {
  // Unmount any still-watching hook (via the shared setup.ts `cleanup()`) BEFORE removing
  // `navigator.geolocation` below — its own effect cleanup calls `clearWatch` on it, and
  // hook-teardown ordering across files is not something this file controls.
  cleanup();
  Reflect.deleteProperty(globalThis.navigator, 'geolocation');
  localStorage.clear();
});

describe('isLocationTrackingEnabled', () => {
  it('defaults to false with nothing persisted', () => {
    expect(isLocationTrackingEnabled()).toBe(false);
  });

  it('is true only for the literal stored string "true"', () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    expect(isLocationTrackingEnabled()).toBe(true);

    localStorage.setItem(STORAGE_KEY, 'yes');
    expect(isLocationTrackingEnabled()).toBe(false);
  });
});

describe('useLocationTracking — the enable/disable consent toggle', () => {
  it('persists the choice to localStorage under the per-device key and reflects it immediately', () => {
    const { result } = renderHook(() => useLocationTracking({ watch: false }));

    expect(result.current.enabled).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    act(() => result.current.setEnabled(true));

    expect(result.current.enabled).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');

    act(() => result.current.setEnabled(false));

    expect(result.current.enabled).toBe(false);
    expect(result.current.mode).toBe('off');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
  });

  it('migrates a stored "true" to when_in_use, not always', () => {
    localStorage.setItem(STORAGE_KEY, 'true');

    const { result } = renderHook(() => useLocationTracking({ watch: false }));

    expect(result.current.enabled).toBe(true);
    expect(result.current.mode).toBe('when_in_use');
  });

  it('downgrades always to when_in_use on web', () => {
    h.isNativePlatform.mockReturnValue(false);
    const { result } = renderHook(() => useLocationTracking({ watch: false }));

    act(() => result.current.setMode('always'));

    expect(result.current.mode).toBe('when_in_use');
  });

  it('keeps always on native (iOS or Android)', () => {
    h.isNativePlatform.mockReturnValue(true);
    const { result } = renderHook(() => useLocationTracking({ watch: false }));

    act(() => result.current.setMode('always'));

    expect(result.current.mode).toBe('always');
  });

  it('reads a choice persisted by a previous session on mount', () => {
    localStorage.setItem(STORAGE_KEY, 'true');

    const { result } = renderHook(() => useLocationTracking({ watch: false }));

    expect(result.current.enabled).toBe(true);
  });
});

describe('useLocationTracking — cross-instance sync', () => {
  it('a toggle in one instance (the settings screen) is reflected in another (the app-level watcher)', () => {
    const settingsToggle = renderHook(() => useLocationTracking({ watch: false }));
    const appWatcher = renderHook(() => useLocationTracking({ watch: false }));

    expect(appWatcher.result.current.enabled).toBe(false);

    act(() => settingsToggle.result.current.setEnabled(true));

    // Neither instance called the other directly — this only works if the CustomEvent
    // dispatched by setEnabled is actually picked up by the other instance's listener.
    expect(appWatcher.result.current.enabled).toBe(true);
    expect(settingsToggle.result.current.enabled).toBe(true);

    act(() => appWatcher.result.current.setEnabled(false));

    expect(settingsToggle.result.current.enabled).toBe(false);
  });
});

describe('useLocationTracking — watch gating', () => {
  it('does not touch geolocation while disabled', () => {
    const { getCurrentPosition } = installGeolocation();
    h.authenticated = true;

    renderHook(() => useLocationTracking());

    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('does not touch geolocation when not authenticated, even if enabled', () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    const { getCurrentPosition } = installGeolocation();
    h.authenticated = false;

    renderHook(() => useLocationTracking());

    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('does not watch for an instance that opted out with watch:false, even if enabled and authenticated', () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    const { getCurrentPosition } = installGeolocation();
    h.authenticated = true;

    renderHook(() => useLocationTracking({ watch: false }));

    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('records nothing on web even when enabled and authenticated: a browser has no trail', () => {
    // The browser trail went on 2026-10-13 with the on-screen trail on phones. The only web
    // location use left is the on-demand high-accuracy fix, which lives outside this hook.
    localStorage.setItem(STORAGE_KEY, 'true');
    const { getCurrentPosition, watchPosition } = installGeolocation();
    h.authenticated = true;

    renderHook(() => useLocationTracking());

    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(watchPosition).not.toHaveBeenCalled();
  });
});

describe('useLocationTracking — the native background monitor is the only recorder', () => {
  it('records nothing on native in when_in_use: no navigator.geolocation, no background monitor', async () => {
    // A stored "true" migrates to when_in_use. Since 2026-10-13 that mode has no on-screen trail:
    // a current location is fetched on request instead, so nothing starts here.
    localStorage.setItem(STORAGE_KEY, 'true');
    const { getCurrentPosition, watchPosition } = installGeolocation();
    h.authenticated = true;
    h.isNativePlatform.mockReturnValue(true);

    const { result } = renderHook(() => useLocationTracking());

    expect(result.current.mode).toBe('when_in_use');
    await act(async () => {});
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(watchPosition).not.toHaveBeenCalled();
    expect(h.startSignificantLocationUpdates).not.toHaveBeenCalled();
    expect(h.requestNotificationPermission).not.toHaveBeenCalled();
  });

  it('on Android hands Always to motion-gated sampling, the one recorder', async () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    const { getCurrentPosition, watchPosition } = installGeolocation();
    h.authenticated = true;
    h.isNativePlatform.mockReturnValue(true);

    const { result } = renderHook(() => useLocationTracking());

    act(() => result.current.setMode('always'));

    await waitFor(() => expect(h.startSignificantLocationUpdates).toHaveBeenCalled());

    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(watchPosition).not.toHaveBeenCalled();
    // The notification is still needed, for the moving-only foreground service.
    expect(h.requestNotificationPermission).toHaveBeenCalled();
    // Android builds the wire record natively from exactly what captureLocationFix would
    // use here, so the two enqueues of one fix share a source_id.
    expect(h.startSignificantLocationUpdates).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceKey: expect.any(String),
        provider: 'companion-mobile',
        owner: null,
        minDistanceMeters: 150,
        minIntervalMs: 5 * 60 * 1000,
        maxAccuracyMeters: 200,
        geofenceRadiusMeters: 100,
        notificationTitle: expect.any(String),
        notificationText: expect.any(String),
      }),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('on iOS asks When In Use then Always before starting the background monitor', async () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    h.authenticated = true;
    h.isNativePlatform.mockReturnValue(true);
    h.isIosPlatform.mockReturnValue(true);
    h.getNativeLocationAuthorization.mockResolvedValue('notDetermined');
    h.requestNativeLocationAuthorization.mockResolvedValueOnce('whenInUse').mockResolvedValueOnce('always');

    const { result } = renderHook(() => useLocationTracking());

    act(() => result.current.setMode('always'));

    await waitFor(() => expect(h.startSignificantLocationUpdates).toHaveBeenCalled());
    expect(h.requestNotificationPermission).not.toHaveBeenCalled();
    expect(h.requestNativeLocationAuthorization).toHaveBeenNthCalledWith(1, { always: false });
    expect(h.requestNativeLocationAuthorization).toHaveBeenNthCalledWith(2, { always: true });
    expect(result.current.needsSettingsUpgrade).toBe(false);
  });

  it('on iOS records a significant move and stops monitoring when Always turns off', async () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    h.authenticated = true;
    h.isNativePlatform.mockReturnValue(true);
    h.isIosPlatform.mockReturnValue(true);
    h.getNativeLocationAuthorization.mockResolvedValue('always');

    const stop = vi.fn(async () => {});
    let deliver: ((location: ReturnType<typeof fakeBackgroundLocation>) => void) | undefined;

    h.startSignificantLocationUpdates.mockImplementation(async (_options, onLocation) => {
      deliver = onLocation;

      return stop;
    });

    const { result } = renderHook(() => useLocationTracking());

    act(() => result.current.setMode('always'));

    await waitFor(() => expect(h.startSignificantLocationUpdates).toHaveBeenCalled());

    await act(async () => {
      deliver?.(fakeBackgroundLocation());
    });

    expect(h.captureLocationFix).toHaveBeenCalled();

    act(() => result.current.setMode('off'));

    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  it('on iOS shows Open Settings when Always is requested but the OS stays on When In Use', async () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    h.authenticated = true;
    h.isNativePlatform.mockReturnValue(true);
    h.isIosPlatform.mockReturnValue(true);
    h.getNativeLocationAuthorization.mockResolvedValue('whenInUse');
    h.requestNativeLocationAuthorization.mockResolvedValue('whenInUse');

    const { result } = renderHook(() => useLocationTracking());

    act(() => result.current.setMode('always'));

    await waitFor(() => expect(result.current.needsSettingsUpgrade).toBe(true));
    expect(h.startSignificantLocationUpdates).toHaveBeenCalled();
  });

  it('shares needsSettingsUpgrade with a settings instance that is not watching', async () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    h.authenticated = true;
    h.isNativePlatform.mockReturnValue(true);
    h.isIosPlatform.mockReturnValue(true);
    h.getNativeLocationAuthorization.mockResolvedValue('whenInUse');
    h.requestNativeLocationAuthorization.mockResolvedValue('whenInUse');

    const settings = renderHook(() => useLocationTracking({ watch: false }));
    const watcher = renderHook(() => useLocationTracking());

    act(() => watcher.result.current.setMode('always'));

    await waitFor(() => expect(settings.result.current.needsSettingsUpgrade).toBe(true));
  });

  it('clears Open Settings on the settings page when tracking is turned off', async () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    h.authenticated = true;
    h.isNativePlatform.mockReturnValue(true);
    h.isIosPlatform.mockReturnValue(true);
    h.getNativeLocationAuthorization.mockResolvedValue('whenInUse');
    h.requestNativeLocationAuthorization.mockResolvedValue('whenInUse');

    const settings = renderHook(() => useLocationTracking({ watch: false }));
    const watcher = renderHook(() => useLocationTracking());

    act(() => watcher.result.current.setMode('always'));
    await waitFor(() => expect(settings.result.current.needsSettingsUpgrade).toBe(true));

    act(() => watcher.result.current.setMode('off'));
    await waitFor(() => expect(settings.result.current.needsSettingsUpgrade).toBe(false));
  });

  it('feeds a delivered location into captureLocationFix tagged as companion-mobile', async () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    h.authenticated = true;
    h.isNativePlatform.mockReturnValue(true);

    let deliver: ((location: ReturnType<typeof fakeBackgroundLocation>) => void) | undefined;

    h.startSignificantLocationUpdates.mockImplementation(async (_options, onLocation) => {
      deliver = onLocation;

      return async () => {};
    });

    const { result } = renderHook(() => useLocationTracking());

    act(() => result.current.setMode('always'));

    await waitFor(() => expect(h.startSignificantLocationUpdates).toHaveBeenCalled());

    await act(async () => {
      deliver?.(fakeBackgroundLocation());
    });

    expect(h.captureLocationFix).toHaveBeenCalledTimes(1);
    const calls = h.captureLocationFix.mock.calls as unknown as Array<
      [{ latitude: number; longitude: number }, Record<string, unknown>]
    >;
    const [fix, options] = calls[0];

    expect(fix).toMatchObject({ latitude: 37.7749, longitude: -122.4194 });
    expect(options).toMatchObject({ provider: 'companion-mobile' });
  });

  it('stops the background monitor on unmount', async () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    h.authenticated = true;
    h.isNativePlatform.mockReturnValue(true);
    const stop = vi.fn(async () => {});
    h.startSignificantLocationUpdates.mockResolvedValue(stop);

    const { result, unmount } = renderHook(() => useLocationTracking());

    act(() => result.current.setMode('always'));

    await waitFor(() => expect(h.startSignificantLocationUpdates).toHaveBeenCalled());

    unmount();

    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  it('sets needsSettingsUpgrade when the monitor reports NOT_AUTHORIZED', async () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    h.authenticated = true;
    h.isNativePlatform.mockReturnValue(true);

    let deliverError: ((error: { code: string; message: string }) => void) | undefined;

    h.startSignificantLocationUpdates.mockImplementation(async (_options, _onLocation, onError) => {
      deliverError = onError;

      return async () => {};
    });

    const { result } = renderHook(() => useLocationTracking());

    act(() => result.current.setMode('always'));

    await waitFor(() => expect(h.startSignificantLocationUpdates).toHaveBeenCalled());

    await act(async () => {
      deliverError?.({ code: 'NOT_AUTHORIZED', message: 'denied' });
    });

    expect(result.current.needsSettingsUpgrade).toBe(true);
  });
});
