import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type LocationCaptureOutcome,
  type LocationSampler,
  type LocationTrackingMode,
  type NativeLocationStatus,
  LOCATION_MODE_CHANGE_EVENT,
  captureLocationFix,
  createLocationSampler,
  deviceSourceKey,
  fetchJson,
  fixFromGeolocationPosition,
  getNativeLocationStatus,
  isIosPlatform,
  isNativePlatform,
  publishLocationTrackingMode,
  readLocationTrackingMode,
  setNativeLocationHome,
  setNativeLocationMode,
  writeLocationTrackingMode,
} from '@ci/common';

import { useAuth } from './useAuth';

export { isLocationTrackingEnabled } from '@ci/common';

const HOME_QUERY = `query LocationHomePlace($kind: String) {
  knownPlaces(kind: $kind) {
    kind
    coordinates { lat lng }
  }
}`;

/**
 * Location tracking: records ci.position fixes from this device.
 *
 * Web and Android use `navigator.geolocation` while the app is open (50 m / 5 min).
 * iOS uses the Local Hub `LocationTracker` so Always can wake on significant-change
 * after the webview is suspended. One writer per platform — never both.
 *
 * Consent is per-device (localStorage). Settings → Location owns the disclosure.
 */
export function useLocationTracking(options: { watch?: boolean } = {}) {
  const { watch = true } = options;
  const [{ authToken, authenticated }] = useAuth();
  const [mode, setModeState] = useState<LocationTrackingMode>(() => readLocationTrackingMode());
  const [lastOutcome, setLastOutcome] = useState<LocationCaptureOutcome | null>(null);
  const [nativeStatus, setNativeStatus] = useState<NativeLocationStatus | null>(null);
  const [needsSettingsUpgrade, setNeedsSettingsUpgrade] = useState(false);

  const samplerRef = useRef<LocationSampler | null>(null);

  samplerRef.current ??= createLocationSampler();

  const setMode = useCallback((next: LocationTrackingMode) => {
    const resolved: LocationTrackingMode = next === 'always' && !isIosPlatform() ? 'when_in_use' : next;

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

  const enabled = mode !== 'off';

  // iOS native sampler — one writer. Restores Always across reboot via UserDefaults.
  useEffect(() => {
    if (!watch || !authenticated || !isIosPlatform()) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const status = await setNativeLocationMode({
        mode,
        deviceKey: deviceSourceKey(),
      });

      if (!cancelled) {
        setNativeStatus(status);
        reconcileOsAuthorization(mode, status, setMode, setNeedsSettingsUpgrade);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [watch, authenticated, mode, setMode]);

  useEffect(() => {
    if (!watch || mode !== 'always' || !authenticated || !isIosPlatform()) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const data = await fetchJson<{
          data?: { knownPlaces?: Array<{ kind: string; coordinates?: { lat: number; lng: number } | null }> };
        }>('/api/graphql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ query: HOME_QUERY, variables: { kind: 'home' } }),
        });
        const home = data?.data?.knownPlaces?.find((place) => place.kind === 'home' && place.coordinates);

        if (cancelled) {
          return;
        }

        if (home?.coordinates) {
          await setNativeLocationHome({ latitude: home.coordinates.lat, longitude: home.coordinates.lng });
        } else {
          await setNativeLocationHome(null);
        }
      } catch {
        // Significant-change still works without a home fence.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [watch, mode, authenticated, authToken]);

  useEffect(() => {
    if (!watch || !isIosPlatform() || mode === 'off') {
      return;
    }

    const id = window.setInterval(() => {
      void getNativeLocationStatus().then((status) => {
        setNativeStatus(status);
        reconcileOsAuthorization(mode, status, setMode, setNeedsSettingsUpgrade);
      });
    }, 15_000);

    return () => window.clearInterval(id);
  }, [watch, mode, setMode]);

  // Web + Android foreground watcher. iOS never starts this — native owns sampling.
  useEffect(() => {
    if (
      !watch ||
      mode === 'off' ||
      !authenticated ||
      isIosPlatform() ||
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
        provider: isNativePlatform() ? 'companion-mobile' : 'browser',
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
    nativeStatus,
    needsSettingsUpgrade,
  };
}

function reconcileOsAuthorization(
  requested: LocationTrackingMode,
  status: NativeLocationStatus | null,
  setMode: (mode: LocationTrackingMode) => void,
  setNeedsSettingsUpgrade: (value: boolean) => void,
): void {
  if (!status) {
    return;
  }

  if (status.authorization === 'denied' || status.authorization === 'restricted') {
    if (requested !== 'off') {
      setMode('off');
    }

    setNeedsSettingsUpgrade(false);

    return;
  }

  if (requested === 'always' && status.authorization === 'when_in_use' && !status.pendingAlways) {
    setMode('when_in_use');
    setNeedsSettingsUpgrade(true);

    return;
  }

  if (requested === 'always' && status.authorization === 'always') {
    setNeedsSettingsUpgrade(false);
  }
}
