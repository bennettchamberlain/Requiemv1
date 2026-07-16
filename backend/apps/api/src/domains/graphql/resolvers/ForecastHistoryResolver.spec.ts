import { BadRequestException } from '@nestjs/common';

import type { RequestContext } from '@ci/common/context';
import type { FeatureService } from '@ci/common/feature';
import type { LoggerService } from '@ci/common/logging';
import type { ForecastHistoryBucketRow, ForecastHistoryService } from '@ci/domains/predictions';

import { ForecastHistoryResolver } from './ForecastHistoryResolver';

const USER_ID = '00000000-0000-0000-0000-0000000000aa';
const DATE = '2026-07-10';

function makeLogger(): LoggerService {
  return {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as LoggerService;
}

function makeRow(overrides: Partial<ForecastHistoryBucketRow> = {}): ForecastHistoryBucketRow {
  return {
    bucket_index: 0,
    horizon_start: new Date('2026-07-10T00:00:00.000Z'),
    predicted_at: new Date('2026-07-09T21:12:00.000Z'),
    l0_probs: { WORK: 0.7, LEISURE: 0.3 },
    actual_l0: 'WORK',
    ...overrides,
  };
}

function makeResolver(opts: { featureEnabled?: boolean; rows?: ForecastHistoryBucketRow[] | Error }) {
  const getHistory =
    opts.rows instanceof Error
      ? jest.fn().mockRejectedValue(opts.rows)
      : jest.fn().mockResolvedValue(opts.rows ?? []);
  const historyService = { getHistory } as unknown as ForecastHistoryService;
  const featureService = {
    isFeatureEnabled: jest.fn().mockResolvedValue(opts.featureEnabled ?? true),
  } as unknown as FeatureService;
  const logger = makeLogger();
  const resolver = new ForecastHistoryResolver(historyService, featureService, logger);

  return { resolver, getHistory, logger };
}

const context = { userId: USER_ID } as RequestContext;

describe('ForecastHistoryResolver', () => {
  it('returns null when the hbpe feature flag is disabled', async () => {
    const { resolver, getHistory } = makeResolver({ featureEnabled: false });

    await expect(resolver.forecastHistory(context, DATE)).resolves.toBeNull();
    expect(getHistory).not.toHaveBeenCalled();
  });

  it('rejects a malformed date as a GraphQL-visible error', async () => {
    const { resolver, getHistory } = makeResolver({ rows: [] });

    await expect(resolver.forecastHistory(context, 'not-a-date')).rejects.toThrow(BadRequestException);
    expect(getHistory).not.toHaveBeenCalled();
  });

  it('shapes each joined row into a bucket: index, derived startTime, sorted predictedL0, actualL0', async () => {
    const { resolver, getHistory } = makeResolver({
      rows: [makeRow(), makeRow({ bucket_index: 3, l0_probs: { SLEEP: 0.9, WORK: 0.1 }, actual_l0: null })],
    });

    const result = await resolver.forecastHistory(context, DATE);

    expect(getHistory).toHaveBeenCalledWith({ userId: USER_ID }, DATE);
    expect(result).not.toBeNull();
    expect(result!.date).toBe(DATE);
    expect(result!.buckets).toHaveLength(2);

    const [first, second] = result!.buckets;
    expect(first.bucketIndex).toBe(0);
    // Bucket 0 starts at horizon_start (midnight UTC of the forecast day).
    expect(first.startTime).toBe('2026-07-10T00:00:00.000Z');
    expect(first.predictedL0).toEqual([
      { label: 'WORK', probability: 0.7 },
      { label: 'LEISURE', probability: 0.3 },
    ]);
    expect(first.actualL0).toBe('WORK');

    // Bucket 3 starts 3 × 30 minutes after midnight; its actual is still unfilled.
    expect(second.bucketIndex).toBe(3);
    expect(second.startTime).toBe('2026-07-10T01:30:00.000Z');
    expect(second.predictedL0[0]).toEqual({ label: 'SLEEP', probability: 0.9 });
    expect(second.actualL0).toBeNull();
  });

  it('parses l0_probs arriving as a JSON string and sorts entries by probability', async () => {
    const { resolver } = makeResolver({
      rows: [makeRow({ l0_probs: JSON.stringify({ LEISURE: 0.2, WORK: 0.5, SLEEP: 0.3 }) })],
    });

    const result = await resolver.forecastHistory(context, DATE);

    expect(result!.buckets[0].predictedL0.map((entry) => entry.label)).toEqual(['WORK', 'SLEEP', 'LEISURE']);
  });

  it('returns an empty bucket list when no forecast was issued for the date', async () => {
    const { resolver } = makeResolver({ rows: [] });

    await expect(resolver.forecastHistory(context, DATE)).resolves.toEqual({ date: DATE, buckets: [] });
  });

  it('returns null (and logs) when the service throws', async () => {
    const { resolver, logger } = makeResolver({ rows: new Error('boom') });

    await expect(resolver.forecastHistory(context, DATE)).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });
});
