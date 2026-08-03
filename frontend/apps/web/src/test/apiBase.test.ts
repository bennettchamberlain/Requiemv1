import {
  buildApiUrl,
  getApiBaseUrl,
  initApiBaseUrl,
  isNativePlatform,
  persistApiBaseUrl,
  setApiBaseUrl,
} from '@ci/common/src/utils/apiBase';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Minimal stand-ins for the native Capacitor runtime + Web Storage, used to
// exercise the native code paths from the node test environment.
interface FakeWindow {
  Capacitor?: { isNativePlatform: () => boolean };
  localStorage: Pick<Storage, 'getItem' | 'setItem'>;
}

function installFakeWindow(opts: { native: boolean; stored?: string | null }): Map<string, string> {
  const store = new Map<string, string>();

  if (opts.stored != null) {
    store.set('ci.apiBaseUrl', opts.stored);
  }

  const fakeWindow: FakeWindow = {
    Capacitor: { isNativePlatform: () => opts.native },
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => {
        store.set(key, value);
      },
    },
  };

  (globalThis as unknown as { window?: unknown }).window = fakeWindow;

  return store;
}

describe('apiBase — origin resolution', () => {
  beforeEach(() => {
    // Reset the module singleton to the web default before each case.
    setApiBaseUrl('');
  });

  it('defaults to same-origin so relative paths are unchanged', () => {
    expect(getApiBaseUrl()).toBe('');
    expect(buildApiUrl('/api/graphql')).toBe('/api/graphql');
  });

  it('prefixes the configured origin and strips a trailing slash', () => {
    setApiBaseUrl('https://ci.example.com/');

    expect(getApiBaseUrl()).toBe('https://ci.example.com');
    expect(buildApiUrl('/api/graphql')).toBe('https://ci.example.com/api/graphql');
  });

  it('resetting to empty restores same-origin behavior', () => {
    setApiBaseUrl('https://ci.example.com');
    setApiBaseUrl('');

    expect(buildApiUrl('/api/x')).toBe('/api/x');
  });

  it('passes absolute URLs through untouched (e.g. signed media URLs)', () => {
    setApiBaseUrl('https://ci.example.com');

    expect(buildApiUrl('https://minio.example.com/file.png')).toBe('https://minio.example.com/file.png');
    expect(buildApiUrl('http://other.host/x')).toBe('http://other.host/x');
  });
});

describe('apiBase — native detection + persistence', () => {
  const hadWindow = 'window' in globalThis;

  afterEach(() => {
    if (!hadWindow) {
      delete (globalThis as unknown as { window?: unknown }).window;
    }

    setApiBaseUrl('');
  });

  it('isNativePlatform() is false without a Capacitor runtime', () => {
    delete (globalThis as unknown as { window?: unknown }).window;

    expect(isNativePlatform()).toBe(false);
  });

  it('isNativePlatform() reflects Capacitor.isNativePlatform()', () => {
    installFakeWindow({ native: true });
    expect(isNativePlatform()).toBe(true);

    installFakeWindow({ native: false });
    expect(isNativePlatform()).toBe(false);
  });

  it('initApiBaseUrl() is a no-op when not native (web keeps same-origin)', () => {
    delete (globalThis as unknown as { window?: unknown }).window;
    // Simulate a stale in-memory value; init must not clobber it on web.
    setApiBaseUrl('https://leftover.example.com');

    initApiBaseUrl();

    expect(getApiBaseUrl()).toBe('https://leftover.example.com');
  });

  it('initApiBaseUrl() loads the stored origin on native', () => {
    installFakeWindow({ native: true, stored: 'https://stored.example.com' });
    setApiBaseUrl('');

    initApiBaseUrl();

    expect(getApiBaseUrl()).toBe('https://stored.example.com');
    expect(buildApiUrl('/api/graphql')).toBe('https://stored.example.com/api/graphql');
  });

  it('persistApiBaseUrl() writes the normalized origin to localStorage and applies it', () => {
    const store = installFakeWindow({ native: true });

    persistApiBaseUrl('https://new.example.com/');

    expect(getApiBaseUrl()).toBe('https://new.example.com');
    expect(store.get('ci.apiBaseUrl')).toBe('https://new.example.com');
  });
});
