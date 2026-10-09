import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type BackgroundGeolocationError,
  type LocationCaptureOutcome,
  type LocationSampler,
  type LocationTrackingMode,
  BACKGROUND_MAX_ACCURACY_METERS,
  BACKGROUND_MIN_DISTANCE_METERS,
  BACKGROUND_MIN_INTERVAL_MS,
  HOME_GEOFENCE_RADIUS_METERS,
  LOCATION_MODE_CHANGE_EVENT,
  LOCATION_NEEDS_SETTINGS_EVENT,
  MIN_DISTANCE_METERS,
  addAppStateListener,
  addBackgroundLocationWatcher,
  captureLocationFix,
  createLocationSampler,
  deviceSourceKey,
  fixFromBackgroundGeolocationLocation,
  fixFromGeolocationPosition,
  getNativeLocationAuthorization,
  isIosPlatform,
  isNativePlatform,
  outboxOwnerStamp,
  publishLocationNeedsSettingsUpgrade,
  publishLocationTrackingMode,
  readLocationTrackingMode,
  removeBackgroundLocationWatcher,
  requestNativeLocationAuthorization,
  startSignificantLocationUpdates,
  requestNotificationPermission,
  writeLocationTrackingMode,
} from '@ci/common';

import { useAuth } from './useAuth';

export { isLocationTrackingEnabled } from '@ci/common';

/**
 * iOS 13+ will not grant Always from `notDetermined` in one shot — it shows
 * When In Use first. Ask that, then escalate. Returns whether Always is held.
 */
async function ensureIosAlwaysAuthorization(): Promise<boolean> {
  let status = await getNativeLocationAuthorization();

  if (status === 'always') {
    return true;
  }

  if (status === 'denied' || status === 'restricted') {
    return false;
  }

  if (status === 'notDetermined') {
    status = await requestNativeLocationAuthorization({ always: false });
  }

  if (status === 'always') {
    return true;
  }

  if (status === 'whenInUse') {
    status = await requestNativeLocationAuthorization({ always: true });
  }

  return status === 'always';
}

/**
 * Location tracking: records `ci.position` fixes from this device.
 *
 * Native (iOS + Android) uses `@capacitor-community/background-geolocation` for the
 * foreground: a foreground-only watcher in every enabled mode. Its background flag is
 * never set. On Android it would hold a high-accuracy, once-per-second GPS request for as
 * long as the watcher exists, phone still or not (measured at about a quarter of a day's
 * battery); on iOS it turns on the solid blue indicator for the whole background session.
 *
 * `always` adds the LocalHub plugin's `startSignificantLocationUpdates` instead: on iOS,
 * significant-change monitoring, which records a real move and stays quiet while the phone
 * sits still; on Android, motion-gated sampling, where the fixes and an exit geofence
 * decide when the phone is moving and GPS runs only then. Android
 * queues each background fix natively, so it keeps recording after the WebView is gone; the
 * event is still handed to `captureLocationFix`, where the shared `source_id` makes the
 * second enqueue a no-op. Plain web falls back to `navigator.geolocation`.
 *
 * Consent is per-device (localStorage). Settings → Location owns the disclosure.
 */
export function useLocationTracking(options: { watch?: boolean } = {}) {
  const { watch = true } = options;
  const [{ authToken, authenticated }] = useAuth();
  const [mode, setModeState] = useState<LocationTrackingMode>(() => readLocationTrackingMode());
  const [lastOutcome, setLastOutcome] = useState<LocationCaptureOutcome | null>(null);
  const [needsSettingsUpgrade, setNeedsSettingsUpgrade] = useState(false);

  const samplerRef = useRef<LocationSampler | null>(null);
  const backgroundSamplerRef = useRef<LocationSampler | null>(null);
  const isActiveRef = useRef(true);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  samplerRef.current ??= createLocationSampler();
  backgroundSamplerRef.current ??= createLocationSampler({
    minDistanceMeters: BACKGROUND_MIN_DISTANCE_METERS,
    minIntervalMs: BACKGROUND_MIN_INTERVAL_MS,
  });

  const setMode = useCallback((next: LocationTrackingMode) => {
    const resolved: LocationTrackingMode = next === 'always' && !isNativePlatform() ? 'when_in_use' : next;

    writeLocationTrackingMode(resolved);
    setModeState(resolved);
    publishLocationTrackingMode(resolved);
  }, []);

  const setEnabled = useCallback(
    (value: boolean) => {
      setMode(value ? 'when_in_use' : 'off');
    },
    [setMode],
  );

  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<LocationTrackingMode>).detail;

      if (detail === 'off' || detail === 'when_in_use' || detail === 'always') {
        setModeState(detail);
      }
    };

    window.addEventListener(LOCATION_MODE_CHANGE_EVENT, onChange);

    return () => window.removeEventListener(LOCATION_MODE_CHANGE_EVENT, onChange);
  }, []);

  useEffect(() => {
    const onNeeds = (event: Event) => {
      const detail = (event as CustomEvent<boolean>).detail;

      if (typeof detail === 'boolean') {
        setNeedsSettingsUpgrade(detail);
      }
    };

    window.addEventListener(LOCATION_NEEDS_SETTINGS_EVENT, onNeeds);

    return () => window.removeEventListener(LOCATION_NEEDS_SETTINGS_EVENT, onNeeds);
  }, []);

  const enabled = mode !== 'off';

  // Tracks foreground/background so the watcher callback can pick the right sampling
  // gate — the OS keeps delivering fixes on the same watcher across the transition.
  useEffect(() => {
    if (!watch || !isNativePlatform()) {
      return;
    }

    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    void addAppStateListener((isActive) => {
      isActiveRef.current = isActive;

      if (!isActive || modeRef.current !== 'always' || !isIosPlatform()) {
        return;
      }

      void getNativeLocationAuthorization().then((status) => {
        const needs = status !== 'always';
        setNeedsSettingsUpgrade(needs);
        publishLocationNeedsSettingsUpgrade(needs);
      });
    }).then((fn) => {
      if (cancelled) {
        void fn();

        return;
      }

      unsubscribe = fn;
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [watch]);

  // Native watcher — one writer for iOS + Android. Web never starts this; it uses
  // navigator.geolocation below instead.
  useEffect(() => {
    if (!watch) {
      return;
    }

    if (mode === 'off' || !authenticated || !isNativePlatform()) {
      setNeedsSettingsUpgrade(false);
      publishLocationNeedsSettingsUpgrade(false);

      return;
    }

    let cancelled = false;
    let watcherId: string | null = null;
    let stopSignificant: (() => Promise<void>) | null = null;

    const onLocation = (location: Parameters<typeof fixFromBackgroundGeolocationLocation>[0]) => {
      if (cancelled) {
        return;
      }

      const activeSampler = isActiveRef.current ? samplerRef.current : backgroundSamplerRef.current;

      void captureLocationFix(fixFromBackgroundGeolocationLocation(location), {
        sampler: activeSampler ?? undefined,
        authToken,
        provider: 'companion-mobile',
      })
        .then((outcome) => {
          if (!cancelled && outcome.status !== 'throttled') {
            setLastOutcome(outcome);
          }
        })
        .catch(() => {
          // captureLocationFix reports failures in its result rather than throwing.
        });
    };

    const onError = (error: BackgroundGeolocationError) => {
      if (!cancelled && error.code === 'NOT_AUTHORIZED') {
        setNeedsSettingsUpgrade(true);
        publishLocationNeedsSettingsUpgrade(true);
      }
    };

    void (async () => {
      if (mode === 'always') {
        // Android 13+ requires POST_NOTIFICATIONS before the tracking notification (the
        // OS's price of admission for a location foreground service; shown only while the
        // phone is moving) can show. iOS Always does not post that notification.
        if (!isIosPlatform()) {
          await requestNotificationPermission();
        }

        if (isIosPlatform()) {
          const granted = await ensureIosAlwaysAuthorization();

          if (cancelled) {
            return;
          }

          setNeedsSettingsUpgrade(!granted);
          publishLocationNeedsSettingsUpgrade(!granted);
        }
      } else {
        setNeedsSettingsUpgrade(false);
        publishLocationNeedsSettingsUpgrade(false);
      }

      // Always: the LocalHub plugin walks the location prompts (fine, then background)
      // itself, so it goes FIRST and the watcher below must not prompt. Android allows one
      // permission request at a time; two plugins asking at once lost the second request
      // outright ("Can request only one set of permissions at a time"), which is how the
      // background-location step never appeared on a device.
      if (mode === 'always') {
        stopSignificant = await startSignificantLocationUpdates(
          {
            // Android builds the wire record from these in a process that may have no
            // JavaScript; they are the same values captureLocationFix would use here.
            deviceKey: deviceSourceKey(),
            provider: 'companion-mobile',
            owner: outboxOwnerStamp(),
            minDistanceMeters: BACKGROUND_MIN_DISTANCE_METERS,
            minIntervalMs: BACKGROUND_MIN_INTERVAL_MS,
            maxAccuracyMeters: BACKGROUND_MAX_ACCURACY_METERS,
            geofenceRadiusMeters: HOME_GEOFENCE_RADIUS_METERS,
            notificationTitle: 'Recording location',
            notificationText: 'Per your request, Companion records your location while you are on the move.',
          },
          onLocation,
          onError,
        );

        if (cancelled) {
          void stopSignificant?.();

          return;
        }
      }

      const id = await addBackgroundLocationWatcher(
        {
          // Foreground-only on both platforms, in every mode. Background samples go
          // through startSignificantLocationUpdates above (see the hook docblock).
          background: false,
          distanceFilter: MIN_DISTANCE_METERS,
          // Always: location was just requested above (iOS: ensureIosAlwaysAuthorization;
          // Android: the LocalHub chain), so the plugin must not prompt again.
          requestPermissions: mode !== 'always',
        },
        onLocation,
        onError,
      );

      if (cancelled) {
        if (id) {
          void removeBackgroundLocationWatcher(id);
        }

        void stopSignificant?.();

        return;
      }

      watcherId = id;
    })();

    return () => {
      cancelled = true;

      if (watcherId) {
        void removeBackgroundLocationWatcher(watcherId);
      }

      void stopSignificant?.();

      samplerRef.current?.reset();
      backgroundSamplerRef.current?.reset();
    };
  }, [watch, mode, authenticated, authToken]);

  // Web-only foreground watcher. Native (iOS + Android) never starts this — the
  // background-geolocation watcher above owns sampling there.
  useEffect(() => {
    if (
      !watch ||
      mode === 'off' ||
      !authenticated ||
      isNativePlatform() ||
      typeof navigator === 'undefined' ||
      !navigator.geolocation
    ) {
      return;
    }

    let cancelled = false;
    const sampler = samplerRef.current;

    const send = (position: GeolocationPosition) => {
      if (cancelled) {
        return;
      }

      void captureLocationFix(fixFromGeolocationPosition(position), {
        sampler: sampler ?? undefined,
        authToken,
        provider: 'browser',
      })
        .then((outcome) => {
          if (!cancelled && outcome.status !== 'throttled') {
            setLastOutcome(outcome);
          }
        })
        .catch(() => {
          // captureLocationFix reports failures in its result rather than throwing.
        });
    };

    navigator.geolocation.getCurrentPosition(send, () => undefined, {
      enableHighAccuracy: false,
      maximumAge: 60_000,
      timeout: 15_000,
    });

    const watchId = navigator.geolocation.watchPosition(send, () => undefined, {
      enableHighAccuracy: false,
      maximumAge: 60_000,
    });

    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
      sampler?.reset();
    };
  }, [watch, mode, authenticated, authToken]);

  return {
    mode,
    setMode,
    enabled,
    setEnabled,
    lastOutcome,
    needsSettingsUpgrade,
  };
}
