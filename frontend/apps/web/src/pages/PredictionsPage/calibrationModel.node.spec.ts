import { describe, expect, it } from 'vitest';

import { calibrationOneLiner, ONE_LINERS, type CalibrationSnapshot } from './calibrationModel';

function snapshot(over: Partial<CalibrationSnapshot> = {}): CalibrationSnapshot {
  return {
    brier: 0.3,
    l0Top1Acc: 0.8,
    ece: 0.05,
    coverage: 0.9,
    driftFlag: false,
    nBuckets: 200,
    ...over,
  };
}

describe('calibrationOneLiner', () => {
  it('reports no data for a missing or too-small snapshot', () => {
    expect(calibrationOneLiner(null)).toBe(ONE_LINERS.noData);
    expect(calibrationOneLiner(snapshot({ nBuckets: 10 }))).toBe(ONE_LINERS.noData);
    expect(calibrationOneLiner(snapshot({ l0Top1Acc: null }))).toBe(ONE_LINERS.noData);
  });

  it('puts drift ahead of every quality tier', () => {
    expect(calibrationOneLiner(snapshot({ driftFlag: true }))).toBe(ONE_LINERS.drift);
  });

  it('flags sparse coverage before judging accuracy', () => {
    expect(calibrationOneLiner(snapshot({ coverage: 0.2 }))).toBe(ONE_LINERS.sparse);
  });

  it('distinguishes well-calibrated strength from strength alone', () => {
    expect(calibrationOneLiner(snapshot({ l0Top1Acc: 0.8, ece: 0.05 }))).toBe(ONE_LINERS.strongCalibrated);
    expect(calibrationOneLiner(snapshot({ l0Top1Acc: 0.8, ece: 0.2 }))).toBe(ONE_LINERS.strong);
    expect(calibrationOneLiner(snapshot({ l0Top1Acc: 0.8, ece: null }))).toBe(ONE_LINERS.strong);
  });

  it('maps mid and low accuracy to building / learning', () => {
    expect(calibrationOneLiner(snapshot({ l0Top1Acc: 0.6 }))).toBe(ONE_LINERS.building);
    expect(calibrationOneLiner(snapshot({ l0Top1Acc: 0.3 }))).toBe(ONE_LINERS.learning);
  });
});
