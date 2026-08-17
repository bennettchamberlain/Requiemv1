import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchJson } from '@ci/common';

import { useAuth } from '@/hooks';

/** Why a job failed, lifted server-side out of `pgboss.job.output`. */
export interface JobFailure {
  readonly message: string;
  readonly stack?: string;
  readonly failedAt?: string;
}

/**
 * One job, as the API is willing to describe it.
 *
 * Job payloads are user content and this endpoint carries no owner predicate, so
 * the server projects each job down to what the dashboard actually needs — the
 * event name, the rotation work type, the payload's size, and a failure's
 * message and stack — rather than shipping `data` and `output` verbatim to
 * whoever happens to be signed in.
 */
export interface JobRecord {
  readonly id: string;
  readonly queue: string;
  readonly state: string;
  readonly priority: number;
  readonly retryLimit: number;
  readonly retryCount: number;
  readonly retryDelay: number;
  readonly retryBackoff: boolean;
  readonly createdOn: string;
  readonly startAfter: string;
  readonly startedOn?: string;
  readonly completedOn?: string;
  readonly deadLetter?: string | null;
  readonly policy?: string | null;
  readonly event: string | null;
  readonly workType: string | null;
  readonly payloadBytes: number;
  readonly failure: JobFailure | null;
}

export interface ArchivedJobRecord extends JobRecord {
  readonly archivedOn: string;
}

export interface JobSchedule {
  readonly name: string;
  readonly cron: string;
  readonly timezone?: string | null;
  readonly createdOn: string;
  readonly updatedOn: string;
  readonly data: Record<string, unknown> | null;
  readonly options: Record<string, unknown> | null;
}

export interface JobQueue {
  readonly name: string;
  readonly policy?: string | null;
  readonly retryLimit: number;
  readonly retryDelay: number;
  readonly retryBackoff: boolean;
  readonly expireInSeconds?: number | null;
  readonly retentionMinutes?: number | null;
  readonly deadLetter?: string | null;
  readonly createdOn: string;
  readonly updatedOn?: string;
}

export interface JobDistributionSegment {
  readonly jobName: string;
  readonly count: number;
}

/**
 * A recurring job as the appliance actually schedules them — a NestJS `@Cron`
 * method, read from the live scheduler registry. Distinct from `JobSchedule`,
 * which reads pg-boss's own `schedule` table; nothing writes that table here, so
 * it is always empty.
 */
export interface CronSchedule {
  readonly name: string;
  readonly cron: string;
  readonly timezone?: string | null;
  readonly running: boolean;
  readonly nextRunAt: string | null;
  readonly lastRunAt: string | null;
}

export interface JobsDashboardResponse {
  readonly summary: {
    readonly pending: number;
    readonly active: number;
    readonly retry: number;
    readonly completed: number;
    readonly failed: number;
    readonly cancelled: number;
    readonly deadLettered: number;
    readonly scheduled: number;
  };
  readonly archiveDistribution: readonly JobDistributionSegment[];
  readonly activeDistribution: readonly JobDistributionSegment[];
  readonly queueDistribution: Array<{ queue: string; count: number }>;
  readonly smartRotationDistribution: Array<{ workType: string; count: number }>;
  readonly jobs: readonly JobRecord[];
  readonly archive: readonly ArchivedJobRecord[];
  readonly schedules: readonly JobSchedule[];
  readonly crons: readonly CronSchedule[];
  readonly queues: readonly JobQueue[];
}

export function useJobsDashboard(refreshIntervalMs = 15000) {
  const [data, setData] = useState<JobsDashboardResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [staleSince, setStaleSince] = useState<Date | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const [{ authToken }] = useAuth();
  const isInitialLoad = useRef(true);

  const load = useCallback(async () => {
    if (!authToken) {
      return;
    }

    if (isInitialLoad.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const response = await fetchJson<JobsDashboardResponse>('/api/jobs/dashboard', {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      setData(response ?? null);
      setLoading(false);
      setError(null);
      setStaleSince(null);
      setUpdatedAt(new Date());
      isInitialLoad.current = false;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      if (isInitialLoad.current) {
        setError(message);
        setLoading(false);

        return;
      }

      // A refresh that fails after the first success used to be swallowed
      // entirely, leaving a page that looks live — auto-refreshing, timestamps
      // ticking — while showing numbers frozen at whenever the API last
      // answered. On a queue dashboard that is the worst possible failure: an
      // operator watching a backlog drain cannot tell "nothing changed" from
      // "nothing is being reported". Keep showing the last good data, but say
      // out loud that it is the last good data.
      setStaleSince((current) => current ?? new Date());
      setError(message);
    }
  }, [authToken]);

  useEffect(() => {
    if (!authToken) {
      return;
    }

    void load();

    if (refreshIntervalMs <= 0) {
      return;
    }

    const handle = window.setInterval(() => {
      // Polling a hidden tab bills the appliance for grouped scans over the job
      // tables that nobody is looking at. Refresh resumes on the next tick after
      // the tab is shown again.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }

      void load();
    }, refreshIntervalMs);

    return () => window.clearInterval(handle);
  }, [authToken, load, refreshIntervalMs]);

  return {
    data,
    loading,
    error,
    /** Set when refreshes are failing but stale data is still on screen. */
    staleSince,
    /** When the displayed data was last successfully fetched. */
    updatedAt,
    refresh: load,
  } as const;
}
