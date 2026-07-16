import type { RequestContext } from '@ci/common/context';
import type { FeatureService } from '@ci/common/feature';
import type { LoggerService } from '@ci/common/logging';
import type { CalibrationService, PredictionScoreRow } from '@ci/domains/predictions';

import { CALIBRATION_BASIS } from '../types/PredictionCalibrationType';

import { PredictionCalibrationResolver } from './PredictionCalibrationResolver';

const USER_ID = '00000000-0000-0000-0000-0000000000aa';

function makeLogger(): LoggerService {
  return {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as LoggerService;
}

function makeRow(overrides: Partial<PredictionScoreRow> = {}): PredictionScoreRow {
  return {
    scored_at: new Date('2026-07-06T05:00:00.000Z'),
    window_start: new Date('2026-06-22T05:00:00.000Z'),
    window_end: new Date('2026-07-06T05:00:00.000Z'),
    brier: 0.42,
    l0_top1_acc: 0.75,
    l1_top3_acc: 0.5,
    ece: 0.08,
    coverage: 0.96,
    reliability_json: [{ bin: 9, lower: 0.9, upper: 1.0, count: 10, avg_confidence: 0.95, accuracy: 0.9 }],
    drift_flag: true,
    n_buckets: 120,
    ...overrides,
  };
}

function makeResolver(opts: { featureEnabled?: boolean; scores?: PredictionScoreRow[] | Error }) {
  const getScores =
    opts.scores instanceof Error
      ? jest.fn().mockRejectedValue(opts.scores)
      : jest.fn().mockResolvedValue(opts.scores ?? []);
  const getScoresSince =
    opts.scores instanceof Error
      ? jest.fn().mockRejectedValue(opts.scores)
      : jest.fn().mockResolvedValue(opts.scores ?? []);
  const calibrationService = { getScores, getScoresSince } as unknown as CalibrationService;
  const featureService = {
    isFeatureEnabled: jest.fn().mockResolvedValue(opts.featureEnabled ?? true),
  } as unknown as FeatureService;
  const logger = makeLogger();
  const resolver = new PredictionCalibrationResolver(calibrationService, featureService, logger);

  return { resolver, getScores, getScoresSince, featureService, logger };
}

const context = { userId: USER_ID } as RequestContext;

describe('PredictionCalibrationResolver', () => {
  it('returns null when the hbpe feature flag is disabled', async () => {
    const { resolver, getScores } = makeResolver({ featureEnabled: false });

    await expect(resolver.predictionCalibration(context, 14)).resolves.toBeNull();
    expect(getScores).not.toHaveBeenCalled();
  });

  it('maps rows to the typed result with the honesty basis', async () => {
    const { resolver, getScores } = makeResolver({
      scores: [makeRow(), makeRow({ scored_at: new Date('2026-07-05T05:00:00.000Z'), drift_flag: false })],
    });

    const result = await resolver.predictionCalibration(context, 14);

    expect(getScores).toHaveBeenCalledWith({ userId: USER_ID }, 14);
    expect(result).not.toBeNull();
    expect(result!.basis).toBe(CALIBRATION_BASIS);
    expect(result!.basis).toBe('self-consistency-vs-qwen-labels');
    expect(result!.history).toHaveLength(2);
    expect(result!.latest).toEqual(result!.history[0]);
    expect(result!.latest!.scoredAt).toBe('2026-07-06T05:00:00.000Z');
    expect(result!.latest!.brier).toBeCloseTo(0.42);
    expect(result!.latest!.l0Top1Acc).toBeCloseTo(0.75);
    expect(result!.latest!.l1Top3Acc).toBeCloseTo(0.5);
    expect(result!.latest!.ece).toBeCloseTo(0.08);
    expect(result!.latest!.coverage).toBeCloseTo(0.96);
    expect(result!.latest!.driftFlag).toBe(true);
    expect(result!.latest!.nBuckets).toBe(120);
    expect(result!.latest!.reliability).toEqual([
      { bin: 9, lower: 0.9, upper: 1.0, count: 10, avgConfidence: 0.95, accuracy: 0.9 },
    ]);
  });

  it('returns an empty-but-honest shape when there are no scores yet', async () => {
    const { resolver } = makeResolver({ scores: [] });

    const result = await resolver.predictionCalibration(context, 14);

    expect(result).toEqual({ basis: CALIBRATION_BASIS, latest: null, history: [] });
  });

  it('parses reliability_json arriving as a JSON string', async () => {
    const { resolver } = makeResolver({
      scores: [
        makeRow({
          reliability_json: JSON.stringify([
            { bin: 0, lower: 0, upper: 0.1, count: 0, avg_confidence: null, accuracy: null },
          ]),
        }),
      ],
    });

    const result = await resolver.predictionCalibration(context, 14);

    expect(result!.latest!.reliability).toEqual([
      { bin: 0, lower: 0, upper: 0.1, count: 0, avgConfidence: null, accuracy: null },
    ]);
  });

  it('returns null (and logs) when the service throws', async () => {
    const { resolver, logger } = makeResolver({ scores: new Error('boom') });

    await expect(resolver.predictionCalibration(context, 14)).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  describe('calibration (windowDays variant)', () => {
    it('returns null when the hbpe feature flag is disabled', async () => {
      const { resolver, getScoresSince } = makeResolver({ featureEnabled: false });

      await expect(resolver.calibration(context, 30)).resolves.toBeNull();
      expect(getScoresSince).not.toHaveBeenCalled();
    });

    it('reads the trailing window and maps rows through the same typed shape', async () => {
      const { resolver, getScoresSince } = makeResolver({ scores: [makeRow()] });

      const result = await resolver.calibration(context, 30);

      expect(getScoresSince).toHaveBeenCalledWith({ userId: USER_ID }, 30);
      expect(result).not.toBeNull();
      expect(result!.basis).toBe(CALIBRATION_BASIS);
      expect(result!.latest!.brier).toBeCloseTo(0.42);
      expect(result!.latest!.driftFlag).toBe(true);
      expect(result!.history).toHaveLength(1);
    });

    it('returns null (and logs) when the service throws', async () => {
      const { resolver, logger } = makeResolver({ scores: new Error('boom') });

      await expect(resolver.calibration(context, 30)).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
