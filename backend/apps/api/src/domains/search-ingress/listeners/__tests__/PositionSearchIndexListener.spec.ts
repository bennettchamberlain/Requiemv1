import { formatLocalPositionStamp } from '../PositionSearchIndexListener';

describe('formatLocalPositionStamp', () => {
  it('renders the user-local wall clock, not UTC', () => {
    // 20:00 UTC on 6 Jul 2026 is 13:00 PDT.
    const stamp = formatLocalPositionStamp(new Date('2026-07-06T20:00:00Z'), 'America/Los_Angeles');

    expect(stamp).toBe('2026-07-06 13:00');
  });

  it('falls back to UTC when the zone is missing or invalid', () => {
    const when = new Date('2026-07-06T20:00:00Z');

    expect(formatLocalPositionStamp(when, '')).toBe('2026-07-06 20:00');
    expect(formatLocalPositionStamp(when, 'Not/AZone')).toBe('2026-07-06 20:00');
  });
});
