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

interface PluginListenerHandle {
  remove(): Promise<void> | void;
}

interface AppPlugin {
  addListener(
    eventName: 'backButton',
    listener: (event: { canGoBack?: boolean }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'appStateChange',
    listener: (event: { isActive: boolean }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'appUrlOpen',
    listener: (event: { url?: string }) => void,
  ): Promise<PluginListenerHandle>;
  exitApp(): Promise<void>;
}

interface SplashScreenPlugin {
  hide(): Promise<void>;
}

interface StatusBarPlugin {
  setStyle(options: { style: 'DARK' | 'LIGHT' | 'DEFAULT' }): Promise<void>;
  setBackgroundColor(options: { color: string }): Promise<void>;
  show(): Promise<void>;
  hide(): Promise<void>;
}

interface LocalNotificationsPlugin {
  checkPermissions(): Promise<{ display: string }>;
  requestPermissions(): Promise<{ display: string }>;
  schedule(options: { notifications: LocalNotification[] }): Promise<unknown>;
}

interface CapacitorPlugins {
  SecureStoragePlugin?: SecureStoragePlugin;
  Browser?: BrowserPlugin;
  App?: AppPlugin;
  SplashScreen?: SplashScreenPlugin;
  StatusBar?: StatusBarPlugin;
  LocalNotifications?: LocalNotificationsPlugin;
}

export interface LocalNotification {
  id: number;
  title: string;
  body: string;
  /** Optional fire time; omit to deliver immediately. */
  schedule?: { at: Date };
}

const noop = () => {};

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

/**
 * Subscribe to the Android hardware back button. `handler` receives whether the
 * webview can navigate back. Returns an unsubscribe function. No-op on web/iOS (the
 * event never fires), where it returns a no-op cleanup.
 */
export async function addBackButtonListener(handler: (canGoBack: boolean) => void): Promise<() => void> {
  const app = plugins()?.App;

  if (!isNativePlatform() || !app) {
    return noop;
  }

  const handle = await app.addListener('backButton', (event) => handler(Boolean(event?.canGoBack)));

  return () => {
    void handle.remove();
  };
}

/**
 * Subscribe to foreground/background transitions. Returns an unsubscribe function.
 * No-op on web.
 */
export async function addAppStateListener(handler: (isActive: boolean) => void): Promise<() => void> {
  const app = plugins()?.App;

  if (!isNativePlatform() || !app) {
    return noop;
  }

  const handle = await app.addListener('appStateChange', (event) => handler(Boolean(event?.isActive)));

  return () => {
    void handle.remove();
  };
}

/**
 * Subscribe to deep links opened into the app (custom URL scheme / universal links),
 * delivered by `@capacitor/app` as `appUrlOpen`. `handler` receives the full URL string.
 * Used to complete native "Sign in with CI Portal": the system browser redirects to
 * `companion://oidc/callback?...` and that URL surfaces here. Returns an unsubscribe
 * function. No-op on web (the event never fires), where it returns a no-op cleanup.
 */
export async function addAppUrlOpenListener(handler: (url: string) => void): Promise<() => void> {
  const app = plugins()?.App;

  if (!isNativePlatform() || !app) {
    return noop;
  }

  const handle = await app.addListener('appUrlOpen', (event) => {
    if (event?.url) {
      handler(event.url);
    }
  });

  return () => {
    void handle.remove();
  };
}

/** Quit the native app (Android). No-op on web/iOS (iOS has no programmatic exit). */
export async function exitApp(): Promise<void> {
  const app = plugins()?.App;

  if (isNativePlatform() && app) {
    await app.exitApp();
  }
}

/** Dismiss the native splash screen once the web app has mounted. No-op on web. */
export async function hideSplashScreen(): Promise<void> {
  const splash = plugins()?.SplashScreen;

  if (isNativePlatform() && splash) {
    try {
      await splash.hide();
    } catch {
      // Splash may already be hidden — ignore.
    }
  }
}

/**
 * Apply the native status-bar appearance: glyph `style` ('DARK' = dark glyphs for a
 * light background, 'LIGHT' = light glyphs for a dark background) and, on Android, the
 * bar `backgroundColor`. The capacitor.config.ts StatusBar block sets the launch
 * default; call this to react to theme changes at runtime. No-op on web.
 */
export async function setStatusBarStyle(style: 'DARK' | 'LIGHT', backgroundColor?: string): Promise<void> {
  const statusBar = plugins()?.StatusBar;

  if (!isNativePlatform() || !statusBar) {
    return;
  }

  try {
    await statusBar.setStyle({ style });

    if (backgroundColor) {
      // Android-only; iOS ignores it (the bar is translucent over the webview).
      await statusBar.setBackgroundColor({ color: backgroundColor });
    }
  } catch {
    // Plugin unavailable or unsupported on this platform — ignore.
  }
}

/**
 * Whether OS notification permission is already granted. Returns false on web and
 * when the plugin is unavailable, so callers can gate a permission prompt.
 */
export async function hasNotificationPermission(): Promise<boolean> {
  const notifications = plugins()?.LocalNotifications;

  if (!isNativePlatform() || !notifications) {
    return false;
  }

  try {
    const { display } = await notifications.checkPermissions();

    return display === 'granted';
  } catch {
    return false;
  }
}

/**
 * Prompt for OS notification permission (no-op if already decided). Returns whether
 * permission is granted afterward. No-op → false on web.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const notifications = plugins()?.LocalNotifications;

  if (!isNativePlatform() || !notifications) {
    return false;
  }

  try {
    const current = await notifications.checkPermissions();
    const { display } = current.display === 'prompt' ? await notifications.requestPermissions() : current;

    return display === 'granted';
  } catch {
    return false;
  }
}

/**
 * Deliver a local notification (immediately, or at `at`). Requests permission first if
 * needed. Returns whether it was scheduled. No-op → false on web. For server-pushed
 * notifications the backend needs APNs/FCM wiring + a device-token endpoint (deferred).
 */
export async function scheduleLocalNotification(
  title: string,
  body: string,
  options: { id?: number; at?: Date } = {},
): Promise<boolean> {
  const notifications = plugins()?.LocalNotifications;

  if (!isNativePlatform() || !notifications) {
    return false;
  }

  if (!(await requestNotificationPermission())) {
    return false;
  }

  try {
    // A stable-ish default id derived from the title so repeat calls coalesce rather
    // than stack; callers that need distinct notifications should pass an explicit id.
    const id = options.id ?? (Math.abs(hashString(title)) % 2_000_000_000) + 1;

    await notifications.schedule({
      notifications: [{ id, title, body, ...(options.at ? { schedule: { at: options.at } } : {}) }],
    });

    return true;
  } catch {
    return false;
  }
}

/** Small deterministic string hash (djb2) for deriving stable notification ids. */
function hashString(value: string): number {
  let hash = 5381;

  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }

  return hash | 0;
}

// Keep in sync with apiBase.ts `STORAGE_KEY`. Native App Intents read the base URL
// from the OS keystore (they can't read the webview's localStorage), so we mirror it.
const API_BASE_URL_KEY = 'ci.apiBaseUrl';

/**
 * Mirror the configured API base URL from localStorage into the OS keystore, so native
 * App Intents (Siri/Shortcuts/Spotlight) — which run outside the webview — can reach
 * the same server. The API key is already persisted to the keystore by the auth flow,
 * so together they give an App Intent everything it needs. No-op on web.
 */
export async function syncNativeIntentConfig(): Promise<void> {
  if (!isNativePlatform() || typeof window === 'undefined') {
    return;
  }

  try {
    const baseUrl = window.localStorage.getItem(API_BASE_URL_KEY);

    if (baseUrl) {
      await secureStorageSet(API_BASE_URL_KEY, baseUrl);
    } else {
      // Keep the keystore consistent with localStorage: if the base URL was cleared,
      // drop the mirrored copy so App Intents don't keep using a stale server.
      await secureStorageRemove(API_BASE_URL_KEY);
    }
  } catch {
    // Best-effort — App Intents simply won't be configured until this succeeds.
  }
}
