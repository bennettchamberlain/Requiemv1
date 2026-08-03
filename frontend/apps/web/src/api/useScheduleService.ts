import { gql, useQuery } from '@apollo/client';

import type { ProbabilityEntry } from './useForecastService';

// Committed time changes when a connector syncs, not second-to-second; the
// rhythm layer only moves on the nightly pipeline. Hourly is plenty.
const REFRESH_INTERVAL_MS = 60 * 60_000;

const GET_SCHEDULE = gql(`
  query GetSchedule($from: DateTime!, $to: DateTime!) {
    eventsInRange(from: $from, to: $to) {
      id
      title
      startTime
      endTime
      isAllDay
      status
      category
      locationName
    }
    weekForecast(includeToday: true) {
      generatedAt
      days {
        date
        dow
        clusters {
          clusterId
          name
          l0Class
          pOccur
          scheduled
          daypartProbs { label probability }
        }
      }
    }
  }
`);

/** A committed event — something that is actually on the calendar. */
export interface ScheduleEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string | null;
  isAllDay: boolean;
  status: string;
  category: string | null;
  locationName: string | null;
}

export interface RhythmCluster {
  clusterId: string;
  name: string;
  l0Class: string;
  pOccur: number;
  scheduled: boolean;
  daypartProbs: ProbabilityEntry[];
}

export interface RhythmDay {
  date: string;
  dow: string;
  clusters: RhythmCluster[];
}

interface ScheduleResult {
  events: ScheduleEvent[];
  rhythm: RhythmDay[];
  generatedAt: string | null;
  loading: boolean;
  error: boolean;
  /** Re-read committed time — call after something is placed on the grid. */
  refetch: () => void;
}

interface QueryData {
  eventsInRange?: ScheduleEvent[] | null;
  weekForecast?: { generatedAt: string; days: RhythmDay[] } | null;
}

/**
 * The schedule surface's two data layers.
 *
 * `events` is committed fact; `rhythm` is the HBPE occurrence climate. They are
 * fetched together but never merged — the whole point of the page is that the
 * user can tell them apart. The rhythm layer is nullable by design: the forecast
 * resolver returns null when the `hbpe` flag is off or the engine is cold, and
 * the page still has something true to show without it.
 */
export function useScheduleService(from: Date, to: Date): ScheduleResult {
  const { data, loading, error, refetch } = useQuery<QueryData>(GET_SCHEDULE, {
    variables: { from: from.toISOString(), to: to.toISOString() },
    pollInterval: REFRESH_INTERVAL_MS,
    fetchPolicy: 'cache-and-network',
  });

  return {
    events: data?.eventsInRange ?? [],
    rhythm: data?.weekForecast?.days ?? [],
    generatedAt: data?.weekForecast?.generatedAt ?? null,
    loading,
    error: Boolean(error),
    refetch: () => {
      void refetch();
    },
  };
}
