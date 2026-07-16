import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET_FORECAST } from '@/api/useForecastService';
import { pastDateKeys } from '@/components/PredictionHeatmap';
import { renderWithProviders } from '@/test/renderWithProviders';

import { GET_CALIBRATION, GET_FORECAST_WEEK_HISTORY, GET_METRIC_FORECAST, GET_PLACE_FORECAST } from './api';
import { ONE_LINERS } from './calibrationModel';
import { METRIC_SPECS } from './MetricForecastPanel';
import { PredictionsPage } from './PredictionsPage';

// The page reads the feature flag synchronously; toggle per test via this knob.
let hbpeEnabled = true;

vi.mock('@/common/feature', () => ({
  useFeatures: () => ({
    isFeatureEnabled: (feature: string) => hbpeEnabled && feature === 'hbpe',
    refresh: async () => {},
  }),
}));

function probs(...entries: [string, number][]) {
  return entries.map(([label, probability]) => ({
    __typename: 'ProbabilityEntryType',
    label,
    probability,
  }));
}

function historyDayResult(dateKey: string, actualL0: string | null) {
  const [y, m, d] = dateKey.split('-').map(Number);

  return {
    __typename: 'ForecastHistoryType',
    date: dateKey,
    buckets: [
      {
        __typename: 'ForecastHistoryBucketType',
        bucketIndex: 18,
        startTime: new Date(y, m - 1, d, 9, 0).toISOString(),
        actualL0,
        predictedL0: probs(['WORK', 0.7], ['LEISURE', 0.3]),
      },
    ],
  };
}

function buildMocks(): MockedResponse[] {
  const [d0, d1, d2, d3, d4] = pastDateKeys(5);
  const inOneHour = new Date(Date.now() + 60 * 60_000).toISOString();

  const forecastMock: MockedResponse = {
    request: { query: GET_FORECAST, variables: { horizon: '24h' } },
    result: {
      data: {
        forecast: {
          __typename: 'ForecastType',
          horizon: '24h',
          generatedAt: new Date().toISOString(),
          systemStatus: 'READY',
          buckets: [
            {
              __typename: 'ForecastBucketType',
              bucketIndex: 20,
              startTime: inOneHour,
              l0Probs: probs(['WORK', 0.8], ['LEISURE', 0.2]),
              l1Probs: probs(['deep-focus', 0.4]),
              l2Probs: null,
              q10: 0.5,
              q50: 0.8,
              q90: 0.9,
            },
          ],
        },
      },
    },
  };

  const historyMock: MockedResponse = {
    request: { query: GET_FORECAST_WEEK_HISTORY, variables: { d0, d1, d2, d3, d4 } },
    result: {
      data: {
        // d0 diverged (predicted WORK, actual LEISURE); the rest have no log.
        d0: historyDayResult(d0, 'LEISURE'),
        d1: historyDayResult(d1, 'WORK'),
        d2: null,
        d3: null,
        d4: null,
      },
    },
  };

  const calibrationMock: MockedResponse = {
    request: { query: GET_CALIBRATION, variables: { windowDays: 30 } },
    result: {
      data: {
        calibration: {
          __typename: 'PredictionCalibrationType',
          basis: 'self-consistency-vs-qwen-labels',
          latest: {
            __typename: 'CalibrationScoreType',
            scoredAt: '2026-07-15T05:00:00Z',
            windowStart: '2026-07-14T00:00:00Z',
            windowEnd: '2026-07-15T00:00:00Z',
            nBuckets: 96,
            coverage: 0.9,
            brier: 0.25,
            l0Top1Acc: 0.8,
            l1Top3Acc: 0.6,
            ece: 0.05,
            driftFlag: false,
            reliability: [
              {
                __typename: 'ReliabilityBinType',
                bin: 0,
                lower: 0.5,
                upper: 0.6,
                avgConfidence: 0.55,
                accuracy: 0.52,
                count: 40,
              },
            ],
          },
          history: [
            {
              __typename: 'CalibrationScoreType',
              scoredAt: '2026-07-15T05:00:00Z',
              brier: 0.25,
              l0Top1Acc: 0.8,
              coverage: 0.9,
              driftFlag: false,
              nBuckets: 96,
            },
            {
              __typename: 'CalibrationScoreType',
              scoredAt: '2026-07-14T05:00:00Z',
              brier: 0.3,
              l0Top1Acc: 0.7,
              coverage: 0.8,
              driftFlag: false,
              nBuckets: 90,
            },
          ],
        },
      },
    },
  };

  const metricMocks: MockedResponse[] = METRIC_SPECS.map(({ metric }) => ({
    request: { query: GET_METRIC_FORECAST, variables: { metric, days: 3 } },
    result: {
      data: {
        metricForecast:
          metric === 'screen_minutes'
            ? {
                __typename: 'MetricForecastType',
                metric,
                status: 'OK',
                coverage: 0.9,
                horizonDays: 3,
                points: [
                  { __typename: 'MetricForecastPointType', date: '2026-07-16', q10: 100, q50: 180, q90: 260 },
                  { __typename: 'MetricForecastPointType', date: '2026-07-17', q10: 90, q50: 170, q90: 250 },
                  { __typename: 'MetricForecastPointType', date: '2026-07-18', q10: 95, q50: 175, q90: 255 },
                ],
              }
            : {
                __typename: 'MetricForecastType',
                metric,
                status: 'NOT_ENOUGH_SIGNAL',
                coverage: 0.1,
                horizonDays: 3,
                points: [],
              },
      },
    },
  }));

  const placeMock: MockedResponse = {
    request: { query: GET_PLACE_FORECAST, variables: { horizonHours: 4, k: 5 } },
    result: {
      data: {
        placeForecast: {
          __typename: 'PlaceForecastType',
          status: 'OK',
          horizonHours: 4,
          k: 5,
          predictedAt: '2026-07-16T12:00:00Z',
          backoffLevel: 'FROM_HOUR_DOW',
          predictions: [
            {
              __typename: 'PlacePredictionType',
              clusterId: 'c-1',
              label: 'Blue Bottle Coffee',
              lat: 40.7,
              lng: -73.9,
              probability: 0.62,
            },
            {
              __typename: 'PlacePredictionType',
              clusterId: 'c-2',
              label: null,
              lat: 40.71,
              lng: -73.95,
              probability: 0.21,
            },
          ],
        },
      },
    },
  };

  return [forecastMock, historyMock, calibrationMock, ...metricMocks, placeMock];
}

describe('PredictionsPage', () => {
  beforeEach(() => {
    hbpeEnabled = true;
  });

  it('renders the hbpe empty state when the feature is off', () => {
    hbpeEnabled = false;
    renderWithProviders(<PredictionsPage />, { mocks: [] });

    expect(screen.getByText(/enable the "hbpe" feature/i)).toBeInTheDocument();
    expect(screen.queryByText('Week at a Glance')).not.toBeInTheDocument();
  });

  it('renders every panel with mocked data', async () => {
    const { container } = renderWithProviders(<PredictionsPage />, { mocks: buildMocks() });

    // Panel shells appear immediately.
    expect(screen.getByText('Week at a Glance')).toBeInTheDocument();
    expect(screen.getByText('Next Up')).toBeInTheDocument();
    expect(screen.getByText('Metric Forecasts')).toBeInTheDocument();
    expect(screen.getByText('Calibration')).toBeInTheDocument();
    expect(screen.getByText('Next Places')).toBeInTheDocument();

    // Heatmap: history resolved, including a divergent cell (predicted ≠ actual).
    await waitFor(() => expect(container.querySelector('[data-divergent]')).toBeInTheDocument());

    // Next Up: the upcoming WORK bucket with its top L1 context.
    expect(await screen.findByText(/deep-focus/)).toBeInTheDocument();

    // Metric strips: one live chart, three honest "not enough signal" rows.
    expect(await screen.findAllByText('Not enough signal yet')).toHaveLength(3);
    expect(screen.getByText('Screen time')).toBeInTheDocument();

    // Calibration: threshold one-liner + drift badge + coverage.
    expect(await screen.findByText(ONE_LINERS.strongCalibrated)).toBeInTheDocument();
    expect(screen.getByText('No drift')).toBeInTheDocument();

    // Next places list.
    expect(await screen.findByText('Blue Bottle Coffee')).toBeInTheDocument();
    expect(screen.getByText('40.710, -73.950')).toBeInTheDocument();
  });

  it('keeps other panels alive when one query fails', async () => {
    const [forecastMock, historyMock, calibrationMock, ...rest] = buildMocks();
    const failingCalibration: MockedResponse = {
      request: (calibrationMock as { request: MockedResponse['request'] }).request,
      error: new Error('calibration exploded'),
    };

    renderWithProviders(<PredictionsPage />, {
      mocks: [forecastMock, historyMock, failingCalibration, ...rest],
    });

    // Calibration degrades to its empty state…
    expect(await screen.findByText(/No scoring runs yet/)).toBeInTheDocument();
    expect(screen.getByText(ONE_LINERS.noData)).toBeInTheDocument();

    // …while the rest of the dashboard still renders data.
    expect(await screen.findByText('Blue Bottle Coffee')).toBeInTheDocument();
    expect(await screen.findByText(/deep-focus/)).toBeInTheDocument();
  });
});
