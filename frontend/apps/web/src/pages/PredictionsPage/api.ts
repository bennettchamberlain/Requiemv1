import { useQuery } from '@apollo/client';

import { gql } from '@/graphql';

// ── Documents ─────────────────────────────────────────────────────────────────

// Five aliased lookups so the whole past week arrives in one round trip. The
// selection is inlined per alias (no fragment) to keep the client-preset
// masking out of plain data-fetching hooks.
export const GET_FORECAST_WEEK_HISTORY = gql(`
  query GetForecastWeekHistory($d0: String!, $d1: String!, $d2: String!, $d3: String!, $d4: String!) {
    d0: forecastHistory(date: $d0) {
      date
      buckets { bucketIndex startTime actualL0 predictedL0 { label probability } }
    }
    d1: forecastHistory(date: $d1) {
      date
      buckets { bucketIndex startTime actualL0 predictedL0 { label probability } }
    }
    d2: forecastHistory(date: $d2) {
      date
      buckets { bucketIndex startTime actualL0 predictedL0 { label probability } }
    }
    d3: forecastHistory(date: $d3) {
      date
      buckets { bucketIndex startTime actualL0 predictedL0 { label probability } }
    }
    d4: forecastHistory(date: $d4) {
      date
      buckets { bucketIndex startTime actualL0 predictedL0 { label probability } }
    }
  }
`);

export const GET_CALIBRATION = gql(`
  query GetCalibration($windowDays: Int) {
    calibration(windowDays: $windowDays) {
      basis
      latest {
        scoredAt
        windowStart
        windowEnd
        nBuckets
        coverage
        brier
        l0Top1Acc
        l1Top3Acc
        ece
        driftFlag
        reliability { bin lower upper avgConfidence accuracy count }
      }
      history { scoredAt brier l0Top1Acc coverage driftFlag nBuckets }
    }
  }
`);

export const GET_METRIC_FORECAST = gql(`
  query GetMetricForecast($metric: String!, $days: Int) {
    metricForecast(metric: $metric, days: $days) {
      metric
      status
      coverage
      horizonDays
      points { date q10 q50 q90 }
    }
  }
`);

export const GET_PLACE_FORECAST = gql(`
  query GetPlaceForecast($horizonHours: Int, $k: Int) {
    placeForecast(horizonHours: $horizonHours, k: $k) {
      status
      horizonHours
      k
      predictedAt
      backoffLevel
      predictions { clusterId label lat lng probability }
    }
  }
`);

// ── Hooks ─────────────────────────────────────────────────────────────────────

export interface HistoryDates {
  d0: string;
  d1: string;
  d2: string;
  d3: string;
  d4: string;
}

/** Past-week forecast history for the five dates (oldest first as d0..d4). */
export function useForecastWeekHistory(dates: HistoryDates) {
  const { data, loading, error } = useQuery(GET_FORECAST_WEEK_HISTORY, {
    variables: dates,
    errorPolicy: 'all',
  });

  return { data, loading, error };
}

export function useCalibration(windowDays = 30) {
  const { data, loading, error } = useQuery(GET_CALIBRATION, {
    variables: { windowDays },
    errorPolicy: 'all',
  });

  return { calibration: data?.calibration ?? null, loading, error };
}

export function useMetricForecast(metric: string, days = 3) {
  const { data, loading, error } = useQuery(GET_METRIC_FORECAST, {
    variables: { metric, days },
    errorPolicy: 'all',
  });

  return { forecast: data?.metricForecast ?? null, loading, error };
}

export function usePlaceForecast(horizonHours = 4, k = 5) {
  const { data, loading, error } = useQuery(GET_PLACE_FORECAST, {
    variables: { horizonHours, k },
    errorPolicy: 'all',
  });

  return { forecast: data?.placeForecast ?? null, loading, error };
}
