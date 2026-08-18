import type { RequestContext } from '@ci/common/context';
import type { LoggerService } from '@ci/common/logging';
import { CALIBRATION_BASIS } from '@ci/domains/predictions';
import type { CalibrationService, CalibrationScore } from '@ci/domains/predictions';

import { calibrationQualityStatement, ForecastCalibrationTool } from '../ForecastCalibrationTool';

const CONTEXT = { userId: '00000000-0000-0000-0000-0000000000aa' } as RequestContext;

function logger(): LoggerService {
  return {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as LoggerService;
}

const SCORE: CalibrationScore = {
  scoredAt: '2026-08-17T00:00:00Z',
  brier: 0.15,
  l0Top1Acc: 0.81,
  l1Top3Acc: 0.9,
  ece: 0.02,
  coverage: 0.95,
  driftFlag: false,
  nBuckets: 120,
  modelVersion: 'hmt-v2',
};

describe('calibrationQualityStatement', () => {
  it('names self-consistency vs pipeline labels, not ground-truth accuracy', () => {
    const statement = calibrationQualityStatement({
      scoredAt: '2026-08-17T00:00:00Z',
      brier: 0.2,
      l0Top1Acc: 0.72,
      l1Top3Acc: 0.8,
      ece: 0.2,
      coverage: 0.9,
      nBuckets: 80,
      driftFlag: true,
      modelVersion: 'b2',
    });

    expect(statement.toLowerCase()).not.toContain('accuracy');
    expect(statement).toContain('pipeline labels');
    expect(statement).toContain('Self-consistency has recently drifted');
    expect(statement).toContain('b2 baseline');
  });
});

describe('ForecastCalibrationTool', () => {
  it('maps the calibration report onto the tool output, including the basis constant', async () => {
    const getReport = jest
      .fn()
      .mockResolvedValue({ basis: CALIBRATION_BASIS, latest: SCORE, history: [SCORE] });
    const tool = new ForecastCalibrationTool({ getReport } as unknown as CalibrationService, logger());

    const result = await tool.execute(CONTEXT, {});

    expect(getReport).toHaveBeenCalledWith({ userId: CONTEXT.userId }, 1);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      scored: true,
      scoredAt: SCORE.scoredAt,
      brier: SCORE.brier,
      l0Top1Accuracy: SCORE.l0Top1Acc,
      l1Top3Accuracy: SCORE.l1Top3Acc,
      basis: CALIBRATION_BASIS,
      modelVersion: 'hmt-v2',
    });
    expect(result.data?.quality).toContain('pipeline labels');
  });

  it('reports unscored when the calibration report has no latest score', async () => {
    const getReport = jest.fn().mockResolvedValue({ basis: CALIBRATION_BASIS, latest: null, history: [] });
    const tool = new ForecastCalibrationTool({ getReport } as unknown as CalibrationService, logger());

    const result = await tool.execute(CONTEXT, {});

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ scored: false, scoredAt: null, brier: null, driftFlag: false });
    expect(result.data?.quality).toContain('No scored forecasts yet');
  });

  it('turns a CalibrationService failure into a failed tool result via BaseTool error handling', async () => {
    const getReport = jest.fn().mockRejectedValue(new Error('hbpe.prediction_score unavailable'));
    const tool = new ForecastCalibrationTool({ getReport } as unknown as CalibrationService, logger());

    const result = await tool.execute(CONTEXT, {});

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('hbpe.prediction_score unavailable');
  });
});
