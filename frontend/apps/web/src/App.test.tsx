import { type ReactNode } from 'react';

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';

// Feature-gated routes (/stats, /tags, /prompts, …) are only added to the route
// table once `isFeatureEnabled` says yes, so a hard load of one of them matches
// the "*" fallback until the flags arrive. These tests pin the fallback's
// behaviour on both sides of that window.
const h = vi.hoisted(() => ({
  features: { loading: true, enabled: false },
}));

vi.mock('@/common/feature', () => ({
  FeaturesProvider: ({ children }: { children: ReactNode }) => children,
  useFeatures: () => ({
    isFeatureEnabled: () => h.features.enabled,
    loading: h.features.loading,
    refresh: async () => {},
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => [
    {
      expired: false,
      authToken: 'test-token',
      authenticated: true,
      loading: false,
      initializing: false,
      error: null,
    },
    { login: vi.fn(), logout: vi.fn(), signup: vi.fn() },
  ],
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: { id: '1', name: 'Test', email: 'test@example.com', onboarded: true },
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/hooks/useLocationTracking', () => ({
  useLocationTracking: () => {},
  isLocationTrackingEnabled: () => false,
}));

// The theme providers drive a canvas animation jsdom cannot run, and none of
// these assertions depend on them. Everything else in the module stays real.
vi.mock('@/components/ThemePicker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ThemePicker')>();

  return {
    ...actual,
    ColorPicker: () => null,
    TexturePicker: () => null,
    ThemeProvider: ({ children }: { children: ReactNode }) => children,
    BackgroundProvider: ({ children }: { children: ReactNode }) => children,
    useTheme: () => ({ themeState: { mode: 'light' }, setTheme: vi.fn() }),
  };
});

// A client whose link never emits: the pages under test are asserted on their
// route matching, not their data, and a pending query is the quietest stand-in.
vi.mock('@/api/ApolloProvider', async () => {
  const {
    ApolloClient,
    ApolloLink,
    ApolloProvider: Provider,
    InMemoryCache,
    Observable,
  } = await import('@apollo/client');

  const client = new ApolloClient({
    cache: new InMemoryCache(),
    link: new ApolloLink(() => new Observable(() => {})),
  });

  return {
    ApolloProvider: ({ children }: { children: ReactNode }) => (
      <Provider client={client}>{children}</Provider>
    ),
  };
});

const GATED_PATHS = ['/stats', '/tags', '/prompts'];

function renderAt(path: string, state?: unknown) {
  window.history.pushState(state ? { usr: state } : {}, '', path);

  return render(<App />);
}

function notFound() {
  return screen.queryByText(/the page you are looking for was not found/i);
}

beforeEach(() => {
  h.features = { loading: true, enabled: false };
});

describe('App routing', () => {
  it.each(GATED_PATHS)('does not flash 404 on %s while the flags are loading', (path) => {
    renderAt(path);

    expect(notFound()).not.toBeInTheDocument();
  });

  // The settings overlay keeps the page it was opened over in `location.state`,
  // and the browser restores history state across a reload — so refreshing on
  // /settings/* re-renders that background route, gated flags and all.
  it('does not flash 404 when a settings overlay is reloaded over a gated page', () => {
    renderAt('/settings/appearance', {
      backgroundLocation: { pathname: '/stats', search: '', hash: '', state: null, key: 'test' },
    });

    expect(notFound()).not.toBeInTheDocument();
  });

  it.each(GATED_PATHS)('mounts %s under the main layout once the flags arrive enabled', async (path) => {
    const { rerender } = renderAt(path);

    h.features = { loading: false, enabled: true };
    rerender(<App />);

    expect(await screen.findByLabelText('Stats')).toBeInTheDocument();
    expect(notFound()).not.toBeInTheDocument();
  });

  it.each(GATED_PATHS)('still renders 404 on %s when the flag is genuinely off', async (path) => {
    h.features = { loading: false, enabled: false };

    renderAt(path);

    await waitFor(() => expect(notFound()).toBeInTheDocument());
  });

  it('renders 404 for an unknown path once the flags have loaded', async () => {
    h.features = { loading: false, enabled: true };

    renderAt('/no-such-page');

    await waitFor(() => expect(notFound()).toBeInTheDocument());
  });
});
