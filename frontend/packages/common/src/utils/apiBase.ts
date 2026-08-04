/**
 * Runtime-configurable API origin shared by the web and native (Capacitor) clients.
 *
 * Web: the base stays `''`, so every `/api/...` request is same-origin and keeps
 * flowing through the dev proxy (Vite) / Caddy exactly as before — zero behavior
 * change. Native: there is no same-origin server, so the Capacitor shell resolves
 * the user's CI-Server address at startup (from Capacitor Preferences, falling back
 * to the `VITE_API_BASE_URL` build default) and calls `setApiBaseUrl()` before the
 * app makes any request.
 *
 * This module intentionally does NOT import `@capacitor/*` — keeping it Capacitor-free
 * means the web bundle never pulls in native deps. The native bootstrap reads
 * Preferences and pushes the value in via `setApiBaseUrl()`.
 */

function readBuildDefault(): string {
  try {
    // Vite inlines `import.meta.env` at build time. Guard for non-Vite contexts
    // (e.g. Jest/Vitest node env, SSR) where `import.meta.env` is undefined.
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;

    return env?.VITE_API_BASE_URL ?? '';
  } catch {
    return '';
  }
}

let apiBaseUrl = normalize(readBuildDefault());

function normalize(url: string | null | undefined): string {
  // Drop trailing slashes so `buildApiUrl('/api/x')` never produces a `//`.
  return (url ?? '').replace(/\/+$/, '');
}

/**
 * Override the API origin at runtime. Called by the native bootstrap once the
 * stored server URL is known, and by the in-app server-settings screen when the
 * user changes it. Passing an empty value resets to same-origin (web behavior).
 */
export function setApiBaseUrl(url: string | null | undefined): void {
  apiBaseUrl = normalize(url);
}

/** The current API origin: `''` on web (same-origin), a full origin on native. */
export function getApiBaseUrl(): string {
  return apiBaseUrl;
}

/**
 * Resolve a relative API path (`/api/...`) against the configured origin.
 * Absolute URLs are returned untouched, so callers can pass either.
 */
export function buildApiUrl(path: string): string {
  if (/^[a-z]+:\/\//i.test(path)) {
    return path;
  }

  return `${apiBaseUrl}${path}`;
}

const STORAGE_KEY = 'ci.apiBaseUrl';

/**
 * Whether the app is running inside the native Capacitor shell. Detected via the
 * `window.Capacitor` bridge that Capacitor injects at runtime, so no `@capacitor/*`
 * import is pulled into the web bundle. Returns false in a plain browser/SSR/test.
 */
export function isNativePlatform(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;

  return Boolean(cap?.isNativePlatform?.());
}

/**
 * Initialize the API origin at startup. Call once from the app entrypoint before
 * rendering. On web this is a no-op (origin stays `''` → same-origin). On native it
 * loads the user-configured server origin from localStorage (which the Capacitor
 * webview persists), falling back to the `VITE_API_BASE_URL` build default.
 */
export function initApiBaseUrl(): void {
  if (!isNativePlatform()) {
    return;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);

    setApiBaseUrl(stored || readBuildDefault());
  } catch {
    setApiBaseUrl(readBuildDefault());
  }
}

/**
 * Persist and apply a new server origin. Used by the native server-settings screen.
 * No-ops storage failures (the in-memory base is still updated for the session).
 */
export function persistApiBaseUrl(url: string): void {
  setApiBaseUrl(url);

  try {
    window.localStorage.setItem(STORAGE_KEY, getApiBaseUrl());
  } catch {
    // Storage unavailable — keep the in-memory override for this session only.
  }
}
