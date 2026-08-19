import {
  computePlacement,
  DEFAULT_ESTIMATED_MINUTES,
  parseWallClock,
  shiftLocalDate,
  type OccupiedSpan,
} from '../computePlacement';

const DAY = '2026-08-18';

function utc(hour: number, minute = 0): Date {
  return new Date(`${DAY}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`);
}

function span(startHour: number, endHour: number, startMin = 0, endMin = 0): OccupiedSpan {
  return { start: utc(startHour, startMin), end: utc(endHour, endMin) };
}

const WORKDAY = {
  workdayStart: utc(9),
  workdayEnd: utc(17),
};

describe('computePlacement', () => {
  it('places at the workday start when the day is empty and now is before it', () => {
    const plan = computePlacement({
      ...WORKDAY,
      occupied: [],
      estimatedMinutes: 45,
      now: utc(8),
    });

    expect(plan).toEqual({ kind: 'placed', start: utc(9), end: utc(9, 45) });
  });

  it('clamps the cursor to now, snapped up to 15 minutes, so a re-pack never lands in the past', () => {
    const plan = computePlacement({
      ...WORKDAY,
      occupied: [],
      estimatedMinutes: 30,
      now: utc(10, 7),
    });

    expect(plan).toEqual({ kind: 'placed', start: utc(10, 15), end: utc(10, 45) });
  });

  it('drops into the first gap that fits, not the largest', () => {
    const plan = computePlacement({
      ...WORKDAY,
      occupied: [span(9, 10), { start: utc(10, 30), end: utc(11) }],
      estimatedMinutes: 30,
      now: utc(8),
    });

    expect(plan).toEqual({ kind: 'placed', start: utc(10), end: utc(10, 30) });
  });

  it('skips a gap that is too short and takes the next one', () => {
    const plan = computePlacement({
      ...WORKDAY,
      occupied: [span(9, 10), { start: utc(10, 15), end: utc(11) }],
      estimatedMinutes: 45,
      now: utc(8),
    });

    expect(plan).toEqual({ kind: 'placed', start: utc(11), end: utc(11, 45) });
  });

  it('merges overlapping occupied spans so a nested meeting does not fake a gap', () => {
    const plan = computePlacement({
      ...WORKDAY,
      occupied: [span(9, 12), span(10, 11)],
      estimatedMinutes: 30,
      now: utc(8),
    });

    expect(plan).toEqual({ kind: 'placed', start: utc(12), end: utc(12, 30) });
  });

  it('returns no_gap when the remaining day cannot fit the estimate', () => {
    const plan = computePlacement({
      ...WORKDAY,
      occupied: [{ start: utc(9), end: utc(16, 45) }],
      estimatedMinutes: 30,
      now: utc(8),
    });

    expect(plan).toEqual({ kind: 'no_gap' });
  });

  it('returns no_gap when now is already past the workday', () => {
    const plan = computePlacement({
      ...WORKDAY,
      occupied: [],
      estimatedMinutes: 30,
      now: utc(17, 1),
    });

    expect(plan).toEqual({ kind: 'no_gap' });
  });

  it('treats a missing estimate as the 30-minute default', () => {
    const plan = computePlacement({
      ...WORKDAY,
      occupied: [],
      estimatedMinutes: 0,
      now: utc(8),
    });

    expect(plan).toEqual({
      kind: 'placed',
      start: utc(9),
      end: utc(9, DEFAULT_ESTIMATED_MINUTES),
    });
  });

  it('clips occupied spans that overhang the workday rather than placing into them', () => {
    const plan = computePlacement({
      ...WORKDAY,
      occupied: [{ start: utc(8), end: utc(10) }],
      estimatedMinutes: 30,
      now: utc(7),
    });

    expect(plan).toEqual({ kind: 'placed', start: utc(10), end: utc(10, 30) });
  });
});

describe('parseWallClock / shiftLocalDate', () => {
  it('accepts HH:MM and HH:MM:SS', () => {
    expect(parseWallClock('09:30')).toBe('09:30');
    expect(parseWallClock('17:00:00')).toBe('17:00');
  });

  it('rejects junk', () => {
    expect(parseWallClock('9am')).toBeNull();
    expect(parseWallClock('')).toBeNull();
    expect(parseWallClock(undefined)).toBeNull();
  });

  it('shifts a calendar date without going through a local timezone', () => {
    expect(shiftLocalDate('2026-08-18', 1)).toBe('2026-08-19');
    expect(shiftLocalDate('2026-08-31', 1)).toBe('2026-09-01');
  });
});
