/**
 * Connection-mode resolver: determines which data source the app is currently
 * backed by, so the UI can tell the user whether they're talking to the
 * configured CI-Server appliance, an on-device LocalHub fallback, a stale
 * local cache, or nothing at all yet. Mirrors the design doc's degradation
 * ladder (2g / A3 stories):
 *
 *   1. "connected" — the configured remote CI-Server origin (the existing
 *      `buildApiUrl()` target) answers its health endpoint.
 *   2. "local"     — the remote is unreachable, but the on-device LocalHub
 *      sidecar (native only — see `frontend/packages/capacitor-local-hub`)
 *      is running and answers its own health endpoint.
 *   3. "cached"    — neither is reachable, but there is local data to show.
 *   4. "fresh"     — nothing is available yet.
 *
 * Detection races two probes — remote health and (on native) the LocalHub
 * sidecar health — each bounded by a short timeout, and resolves to whichever
 * succeeds first. Neither succeeding falls through toward "fresh".
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { buildApiUrl, isNativePlatform } from './apiBase';
import { createHookContext } from './createHookContext';
import { fetchJson } from './fetchJson';
import { localHubHeaders, localHubSession } from './localHub';

export type ConnectionMode = 'connected' | 'local' | 'cached' | 'fresh';

// Each probe gets a timeout so the indicator settles instead of hanging on a
// dead connection. The sidecar is on the device itself, so the design doc's
// 300-800ms window applies to it: anything slower than that is not a healthy
// local server.
export const LOCAL_PROBE_TIMEOUT_MS = 500;

// The remote appliance is not on-device, and the same 500ms budget made the
// indicator wrong for every deployment reached over a WAN: an appliance served
// through a Cloudflare tunnel answers /api/health in ~600-700ms, so the probe
// was aborted while healthy and the chip read "Not synced yet" against a server
// the rest of the app was talking to perfectly well. This bounds an unreachable
// server without calling a reachable-but-distant one dead.
export const REMOTE_PROBE_TIMEOUT_MS = 3_000;

// A mode resolved once at mount goes stale the moment anything changes, and the
// `online`/`offline` events do not fire for the failure that matters most here
// (the appliance going away while the network stays up). Re-probe on a timer so
// the chip — and the outbox drain it gates — recover on their own.
export const CONNECTION_REPROBE_INTERVAL_MS = 30_000;

/** Probes the configured remote CI-Server origin's `/api/health` endpoint. */
async function probeRemote(): Promise<boolean> {
  try {
    await fetchJson(buildApiUrl('/api/health'), { timeout: REMOTE_PROBE_TIMEOUT_MS });

    return true;
  } catch {
    return false;
  }
}

/**
 * Probes the on-device LocalHub sidecar (native only). `localHubSession()`
 * calls the plugin's idempotent `start()` — if the sidecar is already running
 * it returns the existing baseUrl/token without restarting or regenerating the
 * token — so calling it here both ensures the sidecar is up and gets the bearer
 * token its endpoints require, with no risk of disrupting a running server.
 *
 * `skipApiKey`: the appliance's `x-api-key` has no business going to the
 * sidecar, and it is not in the sidecar's CORS allowlist — sending it would
 * fail the WebView's preflight and the probe would never leave the browser.
 */
async function probeLocal(): Promise<boolean> {
  const session = await localHubSession();

  if (!session) {
    return false;
  }

  try {
    await fetchJson(`${session.baseUrl}/api/health`, {
      timeout: LOCAL_PROBE_TIMEOUT_MS,
      skipApiKey: true,
      headers: localHubHeaders(session),
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves to the first probe that yields a non-null value (whichever
 * responds first genuinely wins the race — "connected" has no fixed
 * priority over "local"), or `null` once every probe has settled to null.
 * The probes above already swallow their own errors and resolve
 * `false`/`null` on failure or timeout, so there is nothing to reject here.
 */
function firstSuccess<T>(probes: Array<Promise<T | null>>): Promise<T | null> {
  if (probes.length === 0) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let remaining = probes.length;

    for (const probe of probes) {
      void probe.then((value) => {
        if (value != null) {
          resolve(value);

          return;
        }

        remaining -= 1;

        if (remaining === 0) {
          resolve(null);
        }
      });
    }
  });
}

/**
 * Runs the raced health check and resolves the current {@link ConnectionMode}.
 * Called on network-change events and on-demand via `refresh()` from
 * {@link useConnectionMode}.
 */
export async function resolveConnectionMode(): Promise<ConnectionMode> {
  const probes: Array<Promise<ConnectionMode | null>> = [
    probeRemote().then((ok) => (ok ? 'connected' : null)),
  ];

  if (isNativePlatform()) {
    probes.push(probeLocal().then((ok) => (ok ? 'local' : null)));
  }

  const resolved = await firstSuccess(probes);

  if (resolved) {
    return resolved;
  }

  // TODO(cached-detection): once a durable local cache/outbox exists (LocalHub
  // Phase 2+ SQLite outbox, or the PowerSync local DB), check here whether it
  // holds any data and resolve "cached" instead of "fresh". There is no such
  // signal yet, so — per this pass's scope — we do not invent one and always
  // fall through to "fresh".
  return 'fresh';
}

interface ConnectionModeState {
  mode: ConnectionMode;
  /**
   * False until the first probe settles. `mode` starts at "fresh" because it
   * has to start somewhere, but that initial value is an absence of an answer,
   * not an answer — surfacing it as one makes every load flash "Not synced yet"
   * before the health check has had a chance to reply. UI that reports the mode
   * to the user should render nothing until this is true; consumers that act on
   * it (the outbox drain) need no change, since they only act on "connected".
   */
  isResolved: boolean;
  refresh: () => void;
}

function useConnectionModeState(): ConnectionModeState {
  const [mode, setMode] = useState<ConnectionMode>('fresh');
  const [isResolved, setIsResolved] = useState(false);

  // Coalesces overlapping refreshes (e.g. an `online` event firing while a
  // previous check is still in flight) into a single run.
  const inFlightRef = useRef<Promise<void> | null>(null);
  // Set when a refresh is requested while one is already running. The in-flight
  // probe started before whatever prompted that request, so its answer may
  // already be stale — without a trailing re-run, an `offline`/`online` pair
  // that straddles a single probe leaves the mode pinned to the offline answer
  // until the next event, and the outbox drain never sees the reconnect.
  const requeuedRef = useRef(false);

  const refresh = useCallback(() => {
    if (inFlightRef.current) {
      requeuedRef.current = true;

      return;
    }

    const run = resolveConnectionMode()
      .then((resolved) => {
        setMode(resolved);
        setIsResolved(true);
      })
      .finally(() => {
        inFlightRef.current = null;

        if (requeuedRef.current) {
          requeuedRef.current = false;
          refresh();
        }
      });

    inFlightRef.current = run;
  }, []);

  useEffect(() => {
    refresh();

    if (typeof window === 'undefined') {
      return;
    }

    // Re-probe on both network-change events. `offline` matters even though no
    // probe can reach the appliance while it is down: the mode is what drives
    // the outbox drain, and a drop that leaves `mode` sitting on "connected"
    // makes the subsequent recovery a non-transition — `online` re-probes,
    // resolves "connected" again, React bails out on the identical state, and
    // nothing ever drains the queue the outage filled. Re-probing here moves
    // the mode to "local" (native, sidecar still up) or "fresh", so coming back
    // is a real transition. It is a probe, not an assumption, because reaching
    // the sidecar is exactly what distinguishes those two.
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);

    // Neither event covers the appliance itself going away (or coming back)
    // while the network stays up, and a single mount-time probe that lost a
    // race — a slow first paint, a tunnel still warming up — would otherwise
    // pin the mode to that one answer for the life of the page. Poll, and skip
    // the tick while the document is hidden: a backgrounded tab has nothing to
    // show, and `visibilitychange` re-probes the moment it comes back.
    //
    // `document` is read through a local binding because this module also runs
    // where it is not declared at all (SSR, node tests) — a bare reference
    // there is a ReferenceError, not `undefined`.
    const doc = typeof document === 'undefined' ? undefined : document;

    const tick = () => {
      if (doc?.visibilityState === 'hidden') {
        return;
      }

      refresh();
    };

    const onVisibilityChange = () => {
      if (doc?.visibilityState === 'visible') {
        refresh();
      }
    };

    const timer = setInterval(tick, CONNECTION_REPROBE_INTERVAL_MS);

    doc?.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(timer);
      doc?.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
    };
  }, [refresh]);

  return { mode, isResolved, refresh };
}

const { Provider, useHookContext } = createHookContext(useConnectionModeState, 'useConnectionMode');

export { Provider as ConnectionModeProvider, useHookContext as useConnectionMode };
