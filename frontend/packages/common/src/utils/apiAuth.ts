/**
 * Module-singleton holder for the native API key credential.
 *
 * On the native shell the app authenticates with a long-lived API key (sent in the
 * `x-api-key` header) instead of the browser's cookie/JWT session, which does not
 * survive cross-origin in a webview. The key lives here — outside React — so the
 * request layer (Apollo's auth link, `fetchJson`, and the raw `fetch` call sites)
 * can read it synchronously per request. `useAuth` keeps this in sync with its
 * React state and the OS keystore.
 *
 * On web the key is never set, so `apiKeyHeaders()` returns `{}` and nothing changes.
 */

const API_KEY_HEADER = 'x-api-key';

let apiKey: string | null = null;

/** Set (or clear, with null) the active API key used to authenticate requests. */
export function setApiKey(key: string | null): void {
  apiKey = key && key.length > 0 ? key : null;
}

/** The active API key, or null when authenticating by cookie/JWT (web). */
export function getApiKey(): string | null {
  return apiKey;
}

/**
 * Header fragment to merge into a request: the `x-api-key` header when an API key is
 * active, otherwise empty. Spread into any authenticated request's headers.
 */
export function apiKeyHeaders(): Record<string, string> {
  return apiKey ? { [API_KEY_HEADER]: apiKey } : {};
}
