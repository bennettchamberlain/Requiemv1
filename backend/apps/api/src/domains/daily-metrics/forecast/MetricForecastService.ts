import { Injectable } from '@nestjs/common';

import type { UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';

import { shiftIso, todayIsoInTimezone } from '../dateUtil';
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
  /** Fraction of the 90-day history window that had a value for this metric. */
  coverage: number;
  horizonDays: number;
  points: ForecastPoint[];
}

export interface MetricForecastOptions {
  /** Anchor date (YYYY-MM-DD); forecasts start the day after. Defaults to local today. */
  date?: string;
  timezone?: string;
}

/** Every current metric is a non-negative quantity except sentiment. */
const SIGNED_METRICS: ReadonlySet<MetricKey> = new Set<MetricKey>(['avg_sentiment']);

/**
 * Forecasts a Daily Feature Store metric 1–7 days ahead: seasonal-naive
 * per-dow baseline blended with an overall EWMA, banded by empirical residual
 * quantiles (see forecastMath). Refuses to guess when history is too thin.
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
    const anchor = options.date ?? todayIsoInTimezone(options.timezone ?? 'UTC');
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

  async forecastAll(context: UserServiceContext, days = 3, timezone = 'UTC'): Promise<MetricForecast[]> {
    const out: MetricForecast[] = [];
    for (const metric of METRIC_KEYS) {
      out.push(await this.forecast(context, metric, days, { timezone }));
    }

    return out;
  }
}
