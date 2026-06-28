/**
 * Thin access layer over the native Capacitor plugins, used by the web app when it
 * runs inside the native shell. Plugins are reached through the runtime
 * `window.Capacitor.Plugins` bridge that Capacitor injects — deliberately NOT via
 * `@capacitor/*` imports — so the web bundle never pulls in native dependencies.
 * The native shell (frontend/apps/mobile) declares the actual plugin packages so
 * they are present at runtime.
 *
 * Every function degrades gracefully on web (no `window.Capacitor`): secure storage
 * falls back to `localStorage`, and external links fall back to a normal navigation.
 */

import { isNativePlatform } from './apiBase';

interface SecureStoragePlugin {
  get(options: { key: string }): Promise<{ value: string }>;
  set(options: { key: string; value: string }): Promise<{ value: boolean }>;
  remove(options: { key: string }): Promise<{ value: boolean }>;
}

interface BrowserPlugin {
  open(options: { url: string }): Promise<void>;
}

interface CapacitorPlugins {
  SecureStoragePlugin?: SecureStoragePlugin;
  Browser?: BrowserPlugin;
}

function plugins(): CapacitorPlugins | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return (window as unknown as { Capacitor?: { Plugins?: CapacitorPlugins } }).Capacitor?.Plugins;
}

/**
 * Read a value from the OS keystore (iOS Keychain / Android Keystore) on native, or
 * `localStorage` on web. Returns null when absent.
 */
export async function secureStorageGet(key: string): Promise<string | null> {
  const secure = plugins()?.SecureStoragePlugin;

  if (isNativePlatform() && secure) {
    try {
      const { value } = await secure.get({ key });

      return value ?? null;
    } catch {
      // The plugin throws when the key does not exist — treat as "no value".
      return null;
    }
  }

  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

/** Persist a value to the OS keystore on native, or `localStorage` on web. */
export async function secureStorageSet(key: string, value: string): Promise<void> {
  const secure = plugins()?.SecureStoragePlugin;

  if (isNativePlatform() && secure) {
    await secure.set({ key, value });

    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable — best-effort only.
  }
}

/** Remove a value from the OS keystore on native, or `localStorage` on web. */
export async function secureStorageRemove(key: string): Promise<void> {
  const secure = plugins()?.SecureStoragePlugin;

  if (isNativePlatform() && secure) {
    try {
      await secure.remove({ key });
    } catch {
      // Already gone — nothing to do.
    }

    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * Open a URL outside the app's webview: the system browser on native (so OAuth/OIDC
 * runs in a real browser, not the in-app webview), or a normal navigation on web.
 */
export async function openExternalUrl(url: string): Promise<void> {
  const browser = plugins()?.Browser;

  if (isNativePlatform() && browser) {
    await browser.open({ url });

    return;
  }

  if (typeof window !== 'undefined') {
    window.location.assign(url);
  }
}
