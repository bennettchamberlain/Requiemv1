import { describe, expect, it, beforeEach } from 'vitest';

import {
  POWER_SYNC_CACHE_BUDGET_BYTES,
  POWER_SYNC_DEFAULT_LOOKBACK_DAYS,
  clampLookbackDays,
  ensureCutoffCovers,
  getLookbackDays,
  getWorkingSetCutoffIso,
  setLookbackDays,
  shrinkToBudget,
} from './workingSet';

beforeEach(() => {
  window.localStorage.clear();
});

describe('PowerSync working set', () => {
  it('defaults to a 14-day window, not an unbounded replica', () => {
    window.localStorage.clear();
    expect(getLookbackDays()).toBe(POWER_SYNC_DEFAULT_LOOKBACK_DAYS);

    const cutoff = Date.parse(getWorkingSetCutoffIso(Date.parse('2026-08-18T00:00:00Z')));
    expect(cutoff).toBe(Date.parse('2026-08-04T00:00:00Z'));
  });

  it('expands lookback to cover an older row instead of adding a second cache', () => {
    window.localStorage.clear();
    setLookbackDays(14);
    expect(ensureCutoffCovers('2026-01-01T00:00:00Z', Date.parse('2026-08-18T00:00:00Z'))).toBe(true);
    expect(getLookbackDays()).toBeGreaterThan(200);
  });

  it('shrinks lookback when the file is over 8 GB', () => {
    window.localStorage.clear();
    setLookbackDays(120);
    expect(shrinkToBudget(POWER_SYNC_CACHE_BUDGET_BYTES + 1)).toBe(60);
    expect(getLookbackDays()).toBe(60);
  });

  it('clamps nonsense lookback values', () => {
    expect(clampLookbackDays(0)).toBe(1);
    expect(clampLookbackDays(99_000)).toBe(3650);
  });
});
