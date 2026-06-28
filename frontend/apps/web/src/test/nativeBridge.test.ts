import {
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
