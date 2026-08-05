import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchJson } from '@ci/common';

import { useAuth } from './useAuth';

const STORAGE_KEY = 'ci-location-tracking-enabled';
/** Keeps multiple hook instances (app-level watcher + settings toggle) in sync. */
const CHANGE_EVENT = 'ci:location-tracking-changed';

/** Don't send a new fix unless we moved this far... */
const MIN_DISTANCE_METERS = 50;
/** ...or this much time passed since the last sent fix. */
const MIN_INTERVAL_MS = 5 * 60 * 1000;

export function isLocationTrackingEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;

  return 6371000 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/**
 * Browser location tracking (issue #1811, LifeScope's location-tracking
 * feature rebuilt): while enabled, watches the browser's geolocation and
 * records fixes into ci.position via POST /api/position (source 'gps',
 * provider 'browser'), throttled to meaningful movement (>=50 m) or a 5-minute
 * heartbeat — deliberately better than LifeScope's one-snapshot-per-page-visit.
 *
 * The enable flag is per-device (localStorage): location consent is a property
 * of the device, not the account. Toggled from Settings -> Location.
 */
export function useLocationTracking(options: { watch?: boolean } = {}) {
  const { watch = true } = options;
  const [{ authToken, authenticated }] = useAuth();
  const [enabled, setEnabledState] = useState<boolean>(() => isLocationTrackingEnabled());
  const lastSent = useRef<{ lat: number; lng: number; at: number } | null>(null);

  const setEnabled = useCallback((value: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
    } catch {
      // Storage unavailable (private mode) — session-only toggle still works.
    }

    setEnabledState(value);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: value }));
  }, []);

  // The settings toggle and the app-level watcher are separate hook instances;
  // sync them through the change event.
  useEffect(() => {
    const onChange = (event: Event) => {
      setEnabledState(Boolean((event as CustomEvent).detail));
    };

    window.addEventListener(CHANGE_EVENT, onChange);

    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);

  useEffect(() => {
    // Gate on `authenticated`, NOT on authToken: the native shell authenticates
    // with an API key (fetchJson attaches x-api-key itself) and never populates
    // a JWT, so an authToken gate would silently disable tracking on mobile.
    if (!watch || !enabled || !authenticated || typeof navigator === 'undefined' || !navigator.geolocation) {
      return;
    }

    // The one-shot getCurrentPosition below can resolve long after the effect
    // is torn down (it blocks on the permission prompt), so a disabled toggle
    // must not still record a fix.
    let cancelled = false;

    const send = (position: GeolocationPosition) => {
      if (cancelled) {
        return;
      }

      const { latitude, longitude, accuracy, altitude, heading, speed } = position.coords;
      const now = Date.now();

      const prev = lastSent.current;
      if (prev) {
        const moved = haversineMeters(prev.lat, prev.lng, latitude, longitude);
        if (moved < MIN_DISTANCE_METERS && now - prev.at < MIN_INTERVAL_MS) {
          return;
        }
      }

      lastSent.current = { lat: latitude, lng: longitude, at: now };

      void fetchJson('/api/position', {
        method: 'POST',
        headers: {
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          {
            time: new Date(position.timestamp || now).toISOString(),
            location: { x: longitude, y: latitude },
            ...(accuracy && accuracy > 0 ? { accuracy_meters: accuracy } : {}),
            ...(altitude != null ? { altitude_meters: altitude } : {}),
            ...(heading != null && heading >= 0 && heading <= 360 ? { heading_degrees: heading } : {}),
            ...(speed != null && speed >= 0 ? { speed_meters_per_second: speed } : {}),
            source: 'gps',
            provider: 'browser',
          },
        ]),
      }).catch(() => {
        // A dropped fix is fine; the next watch callback retries naturally.
      });
    };

    // One immediate fix so enabling has a visible effect, then a watch.
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
    };
  }, [watch, enabled, authenticated, authToken]);

  return { enabled, setEnabled };
}
