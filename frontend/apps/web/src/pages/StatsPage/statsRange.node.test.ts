import { describe, expect, it } from 'vitest';

import { rangeToBounds } from './statsRange';

describe('rangeToBounds', () => {
  const now = new Date('2026-08-16T12:00:00.000Z');

  it('omits bounds for all-time', () => {
    expect(rangeToBounds('all', now)).toEqual({});
  });

  it('walks back 30 and 90 days', () => {
    expect(rangeToBounds('30d', now)).toEqual({
      from: '2026-07-17T12:00:00.000Z',
      to: '2026-08-16T12:00:00.000Z',
    });
    expect(rangeToBounds('90d', now)).toEqual({
      from: '2026-05-18T12:00:00.000Z',
      to: '2026-08-16T12:00:00.000Z',
    });
  });

  it('walks back one year', () => {
    expect(rangeToBounds('1y', now)).toEqual({
      from: '2025-08-16T12:00:00.000Z',
      to: '2026-08-16T12:00:00.000Z',
    });
  });
});
