import { describe, expect, it } from 'vitest';

import { formatCount, formatDay, formatHours, formatMinorUnits } from './statsFormat';

describe('statsFormat', () => {
  it('formats minor units as currency', () => {
    expect(formatMinorUnits(2800, 'USD')).toBe('$28.00');
    expect(formatMinorUnits(0)).toBe('$0.00');
  });

  it('formats hours from minutes', () => {
    expect(formatHours(120)).toBe('2h');
    expect(formatHours(90)).toBe('1.5h');
    expect(formatHours(600)).toBe('10h');
  });

  it('formats counts and ISO days', () => {
    expect(formatCount(1234)).toBe('1,234');
    expect(formatDay('2026-05-08T14:00:00.000Z')).toBe('2026-05-08');
    expect(formatDay(null)).toBeNull();
    expect(formatDay('nope')).toBeNull();
  });
});
