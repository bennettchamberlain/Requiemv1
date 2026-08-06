import { describe, expect, it } from 'vitest';

import { intensityCeiling, intensityLevel } from './intensity';

const MAX_LEVEL = 4;

/** A plausible month of ordinary activity: single digits up to a few hundred. */
const ORDINARY = [4, 6, 9, 11, 14, 18, 22, 27, 31, 40, 55, 68, 90, 120, 180, 260, 340, 500];

describe('intensityCeiling', () => {
  it('returns 0 when nothing is active', () => {
    expect(intensityCeiling([])).toBe(0);
    expect(intensityCeiling([0, 0, 0])).toBe(0);
  });

  it('uses the plain maximum when no day is an outlier', () => {
    expect(intensityCeiling([10, 12, 14, 16, 18, 20])).toBe(20);
  });

  it('uses the plain maximum when there are too few active days to judge', () => {
    // Four days: quartiles would be noise, so the 5,000 is taken at face value.
    expect(intensityCeiling([3, 7, 12, 5000])).toBe(5000);
  });

  it('ignores zero-count days when taking the quartiles', () => {
    const withEmptyDays = [...ORDINARY, ...Array.from({ length: 200 }, () => 0)];

    expect(intensityCeiling(withEmptyDays)).toBe(intensityCeiling(ORDINARY));
  });

  it('clamps a bulk-import day to the highest ordinary day', () => {
    const ceiling = intensityCeiling([...ORDINARY, 18_000]);

    expect(ceiling).toBeLessThanOrEqual(500);
    expect(ceiling).toBeGreaterThan(0);
    // The import must not set the top of the ramp.
    expect(ceiling).not.toBe(18_000);
  });

  it('is unmoved by how extreme the outlier is', () => {
    expect(intensityCeiling([...ORDINARY, 18_000])).toBe(intensityCeiling([...ORDINARY, 900_000]));
  });

  it('never lets an outlier become the ceiling, however many there are', () => {
    // The fence itself does shift as more extreme values enter the upper
    // quartile — that is inherent to Q3 + 1.5 × IQR — so this asserts the
    // property that matters rather than an exact ceiling: the imports stay off
    // the top of the ramp and the ceiling remains an ordinary day.
    const imports = [18_000, 22_000, 31_000];
    const ceiling = intensityCeiling([...ORDINARY, ...imports]);

    expect(imports).not.toContain(ceiling);
    expect(ceiling).toBeLessThanOrEqual(Math.max(...ORDINARY));
  });

  it('always returns a value that actually occurs in the data', () => {
    const counts = [...ORDINARY, 18_000];

    expect(counts).toContain(intensityCeiling(counts));
  });

  it('handles an identical-value distribution without collapsing to 0', () => {
    expect(intensityCeiling([7, 7, 7, 7, 7, 7])).toBe(7);
  });
});

describe('intensityLevel', () => {
  it('keeps empty days at level 0', () => {
    expect(intensityLevel(0, 100, MAX_LEVEL)).toBe(0);
  });

  it('gives any activity at least level 1', () => {
    expect(intensityLevel(1, 100_000, MAX_LEVEL)).toBe(1);
  });

  it('saturates at the ceiling and stays there above it', () => {
    expect(intensityLevel(100, 100, MAX_LEVEL)).toBe(MAX_LEVEL);
    expect(intensityLevel(18_000, 100, MAX_LEVEL)).toBe(MAX_LEVEL);
  });

  it('falls back to level 0 when there is no scale', () => {
    expect(intensityLevel(5, 0, MAX_LEVEL)).toBe(0);
  });

  it('spreads the ramp across the ordinary range', () => {
    const ceiling = 500;

    expect(intensityLevel(50, ceiling, MAX_LEVEL)).toBe(1);
    expect(intensityLevel(200, ceiling, MAX_LEVEL)).toBe(2);
    expect(intensityLevel(300, ceiling, MAX_LEVEL)).toBe(3);
    expect(intensityLevel(450, ceiling, MAX_LEVEL)).toBe(4);
  });

  it('distinguishes a 10-entry day from a 500-entry day despite an 18k import', () => {
    // The regression this whole module exists for: against the raw max both of
    // these rounded to level 1.
    const counts = [...ORDINARY, 18_000];
    const ceiling = intensityCeiling(counts);

    expect(intensityLevel(10, ceiling, MAX_LEVEL)).toBeLessThan(intensityLevel(500, ceiling, MAX_LEVEL));
  });

  it('is monotonic across the ordinary range', () => {
    const ceiling = intensityCeiling([...ORDINARY, 18_000]);
    const levels = ORDINARY.map((count) => intensityLevel(count, ceiling, MAX_LEVEL));

    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1]);
    }
  });
});
