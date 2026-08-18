import { describe, expect, it } from 'vitest';

import {
  formatDimensions,
  formatLength,
  formatMass,
  formatVolume,
  lengthFromMm,
  lengthToMm,
  massFromG,
  massToG,
  volumeFromMl,
  volumeToMl,
} from './measurements';

describe('editing round-trip', () => {
  // What a person typed must be what they see when they reopen the form.
  it('returns the number that was typed, in both systems', () => {
    expect(lengthFromMm(lengthToMm(12, 'imperial'), 'imperial')).toBe(12);
    expect(lengthFromMm(lengthToMm(30, 'metric'), 'metric')).toBe(30);
    expect(massFromG(massToG(2.5, 'imperial'), 'imperial')).toBe(2.5);
    expect(massFromG(massToG(1.2, 'metric'), 'metric')).toBe(1.2);
    expect(volumeFromMl(volumeToMl(16, 'imperial'), 'imperial')).toBe(16);
    expect(volumeFromMl(volumeToMl(0.5, 'metric'), 'metric')).toBe(0.5);
  });

  it('agrees with the server on the exact conversion factors', () => {
    expect(lengthToMm(1, 'imperial')).toBe(25.4);
    expect(lengthToMm(1, 'metric')).toBe(10);
    expect(massToG(1, 'imperial')).toBe(453.592);
    expect(volumeToMl(1, 'imperial')).toBe(29.574);
  });

  it('treats non-measurements as unset rather than zero', () => {
    expect(lengthToMm(0, 'metric')).toBeNull();
    expect(lengthToMm(-1, 'metric')).toBeNull();
    expect(lengthToMm(Number.NaN, 'metric')).toBeNull();
    expect(lengthToMm(null, 'metric')).toBeNull();
    expect(lengthFromMm(null, 'metric')).toBeNull();
  });
});

describe('reading', () => {
  it('scales to the unit that keeps the number small', () => {
    expect(formatLength(3200, 'metric')).toBe('3.2 m');
    expect(formatLength(305, 'metric')).toBe('30.5 cm');
    expect(formatLength(4, 'metric')).toBe('4 mm');
    expect(formatLength(304.8, 'imperial')).toBe('1 ft');
    expect(formatLength(254, 'imperial')).toBe('10 in');
  });

  it('scales mass and volume the same way', () => {
    expect(formatMass(1200, 'metric')).toBe('1.2 kg');
    expect(formatMass(80, 'metric')).toBe('80 g');
    expect(formatMass(453.59237, 'imperial')).toBe('1 lb');
    expect(formatMass(28.349523125, 'imperial')).toBe('1 oz');
    expect(formatVolume(1500, 'metric')).toBe('1.5 L');
    expect(formatVolume(250, 'metric')).toBe('250 mL');
  });

  it('renders every axis in one unit so the numbers stay comparable', () => {
    // Formatting each axis independently would give '1.2 m × 40 cm × 8 cm'.
    expect(formatDimensions({ lengthMm: 1200, widthMm: 400, heightMm: 80 }, 'metric')).toBe(
      '1.2 × 0.4 × 0.08 m',
    );
    expect(formatDimensions({ lengthMm: 300, widthMm: 200 }, 'metric')).toBe('30 × 20 cm');
    expect(formatDimensions({ lengthMm: 304.8, widthMm: 152.4 }, 'imperial')).toBe('1 × 0.5 ft');
  });

  it('says nothing when nothing was measured', () => {
    expect(formatDimensions({}, 'metric')).toBeNull();
    expect(formatLength(null)).toBeNull();
    expect(formatMass(undefined)).toBeNull();
  });
});
