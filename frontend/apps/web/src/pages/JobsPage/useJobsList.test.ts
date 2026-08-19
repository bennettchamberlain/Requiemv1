import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_JOB_FILTERS, useJobsList, type JobListResponse } from './useJobsList';

const h = vi.hoisted(() => ({ authToken: 'jwt-abc' as string | null }));

vi.mock('@/hooks', () => ({
  useAuth: () => [{ authToken: h.authToken }],
}));

const fetchJson = vi.hoisted(() => vi.fn());

vi.mock('@ci/common', () => ({ fetchJson }));

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
}

const EMPTY_RESPONSE: JobListResponse = {
  items: [],
  total: 0,
  limit: 50,
  offset: 0,
  queues: [],
  stateCounts: {},
};

beforeEach(() => {
  h.authToken = 'jwt-abc';
  fetchJson.mockReset();
  fetchJson.mockResolvedValue(EMPTY_RESPONSE);
  setVisibility('visible');
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useJobsList — search debounce', () => {
  it('does not requery on every keystroke — only after 300ms of quiet', async () => {
    const { rerender } = renderHook(({ filters }) => useJobsList(filters, 0), {
      initialProps: { filters: DEFAULT_JOB_FILTERS },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fetchJson.mockClear();

    rerender({ filters: { ...DEFAULT_JOB_FILTERS, search: 'f' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    rerender({ filters: { ...DEFAULT_JOB_FILTERS, search: 'fo' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    rerender({ filters: { ...DEFAULT_JOB_FILTERS, search: 'foo' } });

    // Still inside the 300ms quiet window from the last keystroke.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(fetchJson).not.toHaveBeenCalled();

    // The remaining 100ms of quiet elapses and the debounced value fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect((fetchJson.mock.calls[0] as unknown as [string])[0]).toContain('search=foo');
  });

  it('encodes every non-empty filter into the query string', async () => {
    renderHook(() =>
      useJobsList(
        {
          state: 'failed',
          queue: 'search-index',
          category: 'search',
          type: 'note.created',
          search: 'migration',
          offset: 50,
          limit: 25,
        },
        0,
      ),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    const url = (fetchJson.mock.calls[0] as unknown as [string])[0];
    expect(url).toContain('type=note.created');
    expect(url).toContain('state=failed');
    expect(url).toContain('queue=search-index');
    expect(url).toContain('category=search');
    expect(url).toContain('search=migration');
    expect(url).toContain('limit=25');
    expect(url).toContain('offset=50');
  });
});

describe('useJobsList — polling', () => {
  it('re-fetches on the given interval while the tab is visible', async () => {
    renderHook(() => useJobsList(DEFAULT_JOB_FILTERS, 1000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fetchJson).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it('skips the poll while the tab is hidden — it does not bill the appliance for a scan nobody sees', async () => {
    renderHook(() => useJobsList(DEFAULT_JOB_FILTERS, 1000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fetchJson).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchJson).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it('never polls at all when refreshIntervalMs is 0', async () => {
    renderHook(() => useJobsList(DEFAULT_JOB_FILTERS, 0));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fetchJson).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('does not fetch at all without a session', async () => {
    h.authToken = null;

    renderHook(() => useJobsList(DEFAULT_JOB_FILTERS, 1000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(fetchJson).not.toHaveBeenCalled();
  });
});

describe('useJobsList — result handling', () => {
  it('surfaces a readable error message and stops loading on failure', async () => {
    fetchJson.mockRejectedValue(new Error('502 Bad Gateway'));

    const { result } = renderHook(() => useJobsList(DEFAULT_JOB_FILTERS, 0));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(result.current.error).toBe('502 Bad Gateway');
    expect(result.current.loading).toBe(false);
  });

  it('exposes the fetched page and clears a previous error on the next success', async () => {
    fetchJson.mockRejectedValueOnce(new Error('first call failed'));

    const { result } = renderHook(() => useJobsList(DEFAULT_JOB_FILTERS, 0));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.error).toBe('first call failed');

    fetchJson.mockResolvedValueOnce({ ...EMPTY_RESPONSE, total: 3 });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data?.total).toBe(3);
  });
});
