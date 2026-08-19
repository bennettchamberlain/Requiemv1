import { useCallback, useEffect, useState } from 'react';

import { fetchJson } from '@ci/common';

import { useAuth } from '@/hooks';

export interface JobHistoryPoint {
  readonly at: string;
  /** Gauges — how much work was outstanding. */
  readonly pending: number;
  readonly active: number;
  readonly retry: number;
  readonly deadLettered: number;
  /** Deltas — how much work settled in the bucket. */
  readonly completed: number;
  readonly failed: number;
  readonly avgDurationMs: number | null;
  readonly p95DurationMs: number | null;
}

export interface JobHistoryResponse {
  readonly points: readonly JobHistoryPoint[];
  readonly queues: readonly string[];
  readonly bucketMinutes: number;
  readonly windowHours: number;
}

/** Windows the UI offers. Hours, because the API takes hours. */
export const HISTORY_WINDOWS = [
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 24 * 7 },
  { label: '30d', hours: 24 * 30 },
] as const;

/**
 * Job history for the charts.
 *
 * Backed by `ci.job_metrics`, which exists because pg-boss keeps roughly
 * thirty-six hours of working set and no history — a queue's behaviour
 * yesterday is only knowable because the collector wrote it down.
 *
 * Polls more slowly than the table: the collector samples every five minutes,
 * so a faster refresh would redraw the same points.
 */
export function useJobHistory(windowHours: number, queue: string, refreshIntervalMs = 60000) {
  const [data, setData] = useState<JobHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [{ authToken }] = useAuth();

  const load = useCallback(async () => {
    if (!authToken) {
      return;
    }

    const params = new URLSearchParams({ hours: String(windowHours) });

    if (queue) {
      params.set('queue', queue);
    }

    try {
      const response = await fetchJson<JobHistoryResponse>(`/api/jobs/history?${params}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      setData(response ?? null);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [authToken, windowHours, queue]);

  useEffect(() => {
    if (!authToken) {
      return;
    }

    void load();

    if (refreshIntervalMs <= 0) {
      return;
    }

    const handle = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }

      void load();
    }, refreshIntervalMs);

    return () => window.clearInterval(handle);
  }, [authToken, load, refreshIntervalMs]);

  return { data, loading, error, refresh: load } as const;
}
