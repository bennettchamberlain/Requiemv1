import { calibrationQualityStatement } from '../ForecastCalibrationTool';

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
    });

    expect(statement.toLowerCase()).not.toContain('accuracy');
    expect(statement).toContain('pipeline labels');
    expect(statement).toContain('Self-consistency has recently drifted');
  });
});
