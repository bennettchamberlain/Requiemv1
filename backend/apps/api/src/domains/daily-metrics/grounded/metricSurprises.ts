import type { DailyMetrics, MetricKey } from '../types';

const MIN_COVERAGE = 0.5;
const MIN_WEEK_DAYS = 3;

export interface MetricSurprise {
  id: string;
  /** Spoken-note for the selector generator. Numbers are already computed. */
  label: string;
}

function coverageOf(row: DailyMetrics, metric: MetricKey): number {
  return row.coverage[metric] ?? 0;
}

function weekAverage(week: DailyMetrics[], metric: MetricKey): number | null {
  const values = week
    .filter((row) => coverageOf(row, metric) >= MIN_COVERAGE && row.metrics[metric] !== null)
    .map((row) => row.metrics[metric] as number);

  if (values.length < MIN_WEEK_DAYS) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function covered(row: DailyMetrics | null, metric: MetricKey): row is DailyMetrics {
  return row !== null && coverageOf(row, metric) >= MIN_COVERAGE && row.metrics[metric] !== null;
}

function whole(value: number): string {
  return String(Math.round(value));
}

function oneDecimal(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

/**
 * At most one coverage-gated surprise from yesterday vs the trailing week.
 * The label injects the SQL numbers so a model can only choose phrasing.
 */
export function pickMetricSurprise(
  yesterday: DailyMetrics | null,
  week: DailyMetrics[],
): MetricSurprise | null {
  if (covered(yesterday, 'n_conversations')) {
    const typical = weekAverage(week, 'n_conversations');
    const actual = yesterday.metrics.n_conversations as number;
    if (typical !== null && typical >= 3 && actual <= typical * 0.4) {
      return {
        id: 'conversations_low',
        label:
          `You had ${whole(actual)} conversations yesterday vs about ${whole(typical)} most days. ` +
          'Want to reach out? Prefer person_picker. Do not change the numbers.',
      };
    }
  }

  if (covered(yesterday, 'n_places')) {
    const places = yesterday.metrics.n_places as number;
    if (places === 1) {
      return {
        id: 'one_place',
        label:
          'You stayed in one place yesterday. Was that home? Prefer home_work_other. ' +
          'Do not invent a different place count.',
      };
    }
  }

  if (covered(yesterday, 'avg_sentiment')) {
    const typical = weekAverage(week, 'avg_sentiment');
    const actual = yesterday.metrics.avg_sentiment as number;
    if (typical !== null && actual <= typical - 0.25) {
      return {
        id: 'sentiment_dip',
        label:
          `Tone looked low yesterday (${oneDecimal(actual)} vs about ${oneDecimal(typical)} most days). ` +
          'How did the day feel? Prefer feeling_grid. Do not change the numbers.',
      };
    }
  }

  if (covered(yesterday, 'screen_minutes')) {
    const typical = weekAverage(week, 'screen_minutes');
    const actual = yesterday.metrics.screen_minutes as number;
    if (typical !== null && typical >= 30 && actual >= typical * 1.6) {
      return {
        id: 'screen_spike',
        label:
          `You spent about ${whole(actual)} minutes on the web yesterday vs about ${whole(typical)} most days. ` +
          'Was that a focus day or a drift day? Prefer segmented_truth. Do not change the numbers.',
      };
    }
  }

  return null;
}
