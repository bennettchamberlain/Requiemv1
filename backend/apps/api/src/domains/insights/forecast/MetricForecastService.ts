import { Injectable } from '@nestjs/common';

import type { UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';

import { shiftIso, todayIso } from '../dateUtil';
import { DailyMetricsService } from '../services/DailyMetricsService';
import { METRIC_KEYS, type MetricKey } from '../types';

import { forecastSeries, MIN_FORECAST_COVERAGE, type DailySample, type ForecastPoint } from './forecastMath';

/** How much daily_metrics history feeds the forecaster. */
const HISTORY_DAYS = 90;
const MAX_HORIZON_DAYS = 7;

export type MetricForecastStatus = 'OK' | 'NOT_ENOUGH_SIGNAL' | 'UNKNOWN_METRIC';

export interface MetricForecast {
  metric: string;
  status: MetricForecastStatus;
  /** Fraction of the history window that had a value for this metric. */
  coverage: number;
  horizonDays: number;
  points: ForecastPoint[];
}

export interface MetricForecastOptions {
  /** Anchor date (YYYY-MM-DD); forecasts start the day after. Defaults to today (UTC). */
  date?: string;
}

/** Every current metric is a non-negative quantity except sentiment. */
const SIGNED_METRICS: ReadonlySet<MetricKey> = new Set<MetricKey>(['avg_sentiment']);

/**
 * Forecasts a Daily Feature Store metric 1-7 days ahead: seasonal-naive
 * per-dow baseline blended with an overall EWMA, banded by empirical residual
 * quantiles (see forecastMath). Reads only ci_derived.daily_metrics — the
 * feature store is the single compute surface — and refuses to guess when the
 * history is too thin (NOT_ENOUGH_SIGNAL, never fake zeros).
 *
 * TODO(epic #49): persist these forecasts (a metric_forecast_log analogous to
 * ci_derived.place_forecast_log) so a scoring loop can measure pinball loss
 * and q10-q90 band coverage; the alpha computes on read only.
 */
@Injectable()
export class MetricForecastService {
  constructor(
    private readonly metricsService: DailyMetricsService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(MetricForecastService.name);
  }

  async forecast(
    context: UserServiceContext,
    metric: string,
    days = 3,
    options: MetricForecastOptions = {},
  ): Promise<MetricForecast> {
    const horizonDays = Math.min(Math.max(Math.trunc(days), 1), MAX_HORIZON_DAYS);

    if (!(METRIC_KEYS as readonly string[]).includes(metric)) {
      return { metric, status: 'UNKNOWN_METRIC', coverage: 0, horizonDays, points: [] };
    }

    const metricKey = metric as MetricKey;
    const anchor = options.date ?? todayIso();
    const from = shiftIso(anchor, -(HISTORY_DAYS - 1));
    const rows = await this.metricsService.getRange(context, from, anchor);

    const samples: DailySample[] = [];
    for (const row of rows) {
      const value = row.metrics[metricKey];
      if (value !== null && value !== undefined) {
        samples.push({ date: row.date, value });
      }
    }

    const coverage = Math.round((samples.length / HISTORY_DAYS) * 10_000) / 10_000;

    if (coverage < MIN_FORECAST_COVERAGE) {
      this.logger.log('Metric forecast skipped: not enough signal', {
        userId: context.userId,
        metric,
        coverage,
      });

      return { metric, status: 'NOT_ENOUGH_SIGNAL', coverage, horizonDays, points: [] };
    }

    const raw = forecastSeries(samples, anchor, horizonDays);
    const points = SIGNED_METRICS.has(metricKey)
      ? raw
      : raw.map((point) => ({
          date: point.date,
          q10: Math.max(0, point.q10),
          q50: Math.max(0, point.q50),
          q90: Math.max(0, point.q90),
        }));

    return { metric, status: 'OK', coverage, horizonDays, points };
  }
}
