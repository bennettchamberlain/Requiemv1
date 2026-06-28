import {
  addAppUrlOpenListener,
  addBackButtonListener,
  exitApp,
  hideSplashScreen,
  openExternalUrl,
  secureStorageGet,
  secureStorageRemove,
  secureStorageSet,
} from '@ci/common/src/utils/nativeBridge';
import { afterEach, describe, expect, it, vi } from 'vitest';

type GlobalWithWindow = { window?: unknown };

function setWindow(value: unknown): void {
  (globalThis as GlobalWithWindow).window = value;
}

afterEach(() => {
  delete (globalThis as GlobalWithWindow).window;
});

describe('nativeBridge — web (no Capacitor) falls back to localStorage', () => {
  function fakeLocalStorage() {
    const store = new Map<string, string>();

    return {
      store,
      ls: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
    };
  }

  it('set/get/remove use localStorage when not native', async () => {
    const { store, ls } = fakeLocalStorage();
    setWindow({ localStorage: ls });

    await secureStorageSet('k', 'v');
    expect(store.get('k')).toBe('v');
    expect(await secureStorageGet('k')).toBe('v');

    await secureStorageRemove('k');
    expect(await secureStorageGet('k')).toBeNull();
  });

  it('openExternalUrl navigates via location.assign on web', async () => {
    const assign = vi.fn();
    setWindow({ location: { assign } });

    await openExternalUrl('https://example.com/x');

    expect(assign).toHaveBeenCalledWith('https://example.com/x');
  });
});

describe('nativeBridge — native uses the Capacitor plugins', () => {
  function fakeNativeWindow() {
    const secureStore = new Map<string, string>();
    const browserOpen = vi.fn(async () => {});

    const win = {
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
          SecureStoragePlugin: {
            get: vi.fn(async ({ key }: { key: string }) => {
              if (!secureStore.has(key)) {
                throw new Error('not found');
              }

              return { value: secureStore.get(key)! };
            }),
            set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
              secureStore.set(key, value);

              return { value: true };
            }),
            remove: vi.fn(async ({ key }: { key: string }) => {
              secureStore.delete(key);

              return { value: true };
            }),
          },
          Browser: { open: browserOpen },
        },
      },
    };

    return { win, secureStore, browserOpen };
  }

  it('set/get/remove go through the SecureStoragePlugin (Keychain/Keystore)', async () => {
    const { win, secureStore } = fakeNativeWindow();
    setWindow(win);

    await secureStorageSet('apiKey', 'secret');
    expect(secureStore.get('apiKey')).toBe('secret');
    expect(await secureStorageGet('apiKey')).toBe('secret');

    await secureStorageRemove('apiKey');
    // The plugin throws on a missing key — the bridge maps that to null.
    expect(await secureStorageGet('apiKey')).toBeNull();
  });

  it('openExternalUrl opens the system browser', async () => {
    const { win, browserOpen } = fakeNativeWindow();
    setWindow(win);

    await openExternalUrl('https://idp.example.com/auth');

    expect(browserOpen).toHaveBeenCalledWith({ url: 'https://idp.example.com/auth' });
  });
});

describe('nativeBridge — app lifecycle (back button, exit, splash)', () => {
  function fakeShellWindow() {
    const remove = vi.fn();
    let backHandler: ((e: { canGoBack?: boolean }) => void) | undefined;
    const addListener = vi.fn(async (_event: string, listener: (e: { canGoBack?: boolean }) => void) => {
      backHandler = listener;

      return { remove };
    });
    const exit = vi.fn(async () => {});
    const splashHide = vi.fn(async () => {});

    const win = {
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
          App: { addListener, exitApp: exit },
          SplashScreen: { hide: splashHide },
        },
      },
    };

    return { win, remove, exit, splashHide, fireBack: (canGoBack: boolean) => backHandler?.({ canGoBack }) };
  }

  it('registers the back button, forwards canGoBack, and unsubscribes', async () => {
    const { win, remove, fireBack } = fakeShellWindow();
    setWindow(win);

    const seen: boolean[] = [];
    const unsubscribe = await addBackButtonListener((canGoBack) => seen.push(canGoBack));

    fireBack(true);
    fireBack(false);
    expect(seen).toEqual([true, false]);

    unsubscribe();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('exitApp and hideSplashScreen call the plugins', async () => {
    const { win, exit, splashHide } = fakeShellWindow();
    setWindow(win);

    await exitApp();
    await hideSplashScreen();

    expect(exit).toHaveBeenCalledTimes(1);
    expect(splashHide).toHaveBeenCalledTimes(1);
  });

  it('is inert on web: back listener is a no-op and exit/splash do not throw', async () => {
    setWindow({});

    const handler = vi.fn();
    const unsubscribe = await addBackButtonListener(handler);
    unsubscribe();

    await expect(exitApp()).resolves.toBeUndefined();
    await expect(hideSplashScreen()).resolves.toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('nativeBridge — deep links (appUrlOpen)', () => {
  function fakeUrlOpenWindow() {
    const remove = vi.fn();
    let urlHandler: ((e: { url?: string }) => void) | undefined;
    const addListener = vi.fn(async (_event: string, listener: (e: { url?: string }) => void) => {
      urlHandler = listener;

      return { remove };
    });

    const win = {
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
          App: { addListener },
        },
      },
    };

    return { win, remove, fireUrl: (url?: string) => urlHandler?.({ url }) };
  }

  it('forwards the opened URL and unsubscribes', async () => {
    const { win, remove, fireUrl } = fakeUrlOpenWindow();
    setWindow(win);

    const seen: string[] = [];
    const unsubscribe = await addAppUrlOpenListener((url) => seen.push(url));

    fireUrl('companion://oidc/callback?code=abc123');
    expect(seen).toEqual(['companion://oidc/callback?code=abc123']);

    unsubscribe();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('ignores events with no url', async () => {
    const { win, fireUrl } = fakeUrlOpenWindow();
    setWindow(win);

    const handler = vi.fn();
    await addAppUrlOpenListener(handler);

    fireUrl(undefined);
    expect(handler).not.toHaveBeenCalled();
  });

  it('is inert on web: returns a no-op unsubscribe and never fires', async () => {
    setWindow({});

    const handler = vi.fn();
    const unsubscribe = await addAppUrlOpenListener(handler);
    unsubscribe();

    expect(handler).not.toHaveBeenCalled();
  });
});
