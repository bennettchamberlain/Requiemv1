export const STATS_RANGES = ['30d', '90d', '1y', 'all'] as const;

export type StatsRange = (typeof STATS_RANGES)[number];

export const DEFAULT_STATS_RANGE: StatsRange = '90d';

export const STATS_RANGE_LABELS: Readonly<Record<StatsRange, string>> = {
  '30d': '30 days',
  '90d': '90 days',
  '1y': '1 year',
  all: 'All time',
};

/** ISO bounds for the life-series query. `all` omits both so the API is unbounded. */
export function rangeToBounds(range: StatsRange, now = new Date()): { from?: string; to?: string } {
  if (range === 'all') {
    return {};
  }

  const to = now.toISOString();
  const from = new Date(now.getTime());

  if (range === '30d') {
    from.setUTCDate(from.getUTCDate() - 30);
  } else if (range === '90d') {
    from.setUTCDate(from.getUTCDate() - 90);
  } else {
    from.setUTCFullYear(from.getUTCFullYear() - 1);
  }

  return { from: from.toISOString(), to };
}
