import { type ReactNode } from 'react';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FeaturesProvider, useFeatures } from './useFeatures';

const h = vi.hoisted(() => ({
  auth: { authToken: 'test-token' as string | null, initializing: false },
}));

// useFeatures pulls useAuth from the @/hooks barrel — mock just that surface so
// the real (heavy) hook barrel never loads.
vi.mock('@/hooks', () => ({
  useAuth: () => [{ ...h.auth, expired: false, loading: false, error: null }, {}],
}));

function setFetch() {
  const mock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.endsWith('/global') ? { 'files.page': true } : { 'enable.inventory.page': true };

    return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(body) } as Response);
  });
  vi.stubGlobal('fetch', mock);

  return mock;
}

beforeEach(() => {
  h.auth = { authToken: 'test-token', initializing: false };
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <FeaturesProvider args={[]}>{children}</FeaturesProvider>
);

afterEach(() => vi.unstubAllGlobals());

describe('useFeatures', () => {
  it('reports a per-user feature as enabled after fetch', async () => {
    setFetch();
    const { result } = renderHook(() => useFeatures(), { wrapper });

    await waitFor(() => expect(result.current.isFeatureEnabled('enable.inventory.page')).toBe(true));
  });

  it('reports a global feature as enabled', async () => {
    setFetch();
    const { result } = renderHook(() => useFeatures(), { wrapper });

    await waitFor(() => expect(result.current.isFeatureEnabled('files.page')).toBe(true));
  });

  it('reports unknown features as disabled', async () => {
    setFetch();
    const { result } = renderHook(() => useFeatures(), { wrapper });

    await waitFor(() => expect(result.current.isFeatureEnabled('enable.inventory.page')).toBe(true));
    expect(result.current.isFeatureEnabled('does.not.exist')).toBe(false);
  });

  it('reports loading until both flag sets have answered', async () => {
    setFetch();
    const { result } = renderHook(() => useFeatures(), { wrapper });

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isFeatureEnabled('enable.inventory.page')).toBe(true);
  });

  it('stops loading once a failed fetch has answered', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useFeatures(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isFeatureEnabled('enable.inventory.page')).toBe(false);
  });

  it('stays loading while the session handshake is still in flight', async () => {
    h.auth = { authToken: null, initializing: true };
    setFetch();

    const { result } = renderHook(() => useFeatures(), { wrapper });

    // The global set answers, but a token may still arrive and bring per-user
    // flags with it — calling that "all flags off" would be premature.
    await waitFor(() => expect(result.current.isFeatureEnabled('files.page')).toBe(true));
    expect(result.current.loading).toBe(true);
  });

  it('settles for a signed-out visitor once the handshake finishes with no token', async () => {
    h.auth = { authToken: null, initializing: false };
    setFetch();

    const { result } = renderHook(() => useFeatures(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('refresh forces a refetch', async () => {
    const fetchMock = setFetch();
    const { result } = renderHook(() => useFeatures(), { wrapper });
    await waitFor(() => expect(result.current.isFeatureEnabled('enable.inventory.page')).toBe(true));

    const featureCallsBefore = fetchMock.mock.calls.filter(([u]) =>
      String(u).endsWith('/api/_internal/features'),
    ).length;

    await act(async () => {
      await result.current.refresh();
    });

    const featureCallsAfter = fetchMock.mock.calls.filter(([u]) =>
      String(u).endsWith('/api/_internal/features'),
    ).length;
    expect(featureCallsAfter).toBeGreaterThan(featureCallsBefore);
  });
});
