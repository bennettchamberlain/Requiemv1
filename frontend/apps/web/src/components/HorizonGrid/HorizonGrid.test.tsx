import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { RhythmDay, ScheduleEvent } from '@/api/useScheduleService';

import { HorizonGrid, spanForDay, daypartWeights, rhythmCells, startOfLocalDay, addDays } from './HorizonGrid';

const MONDAY = startOfLocalDay(new Date(2026, 7, 3));

function event(overrides: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    id: 'e1',
    title: 'Standup',
    startTime: new Date(2026, 7, 3, 9, 0).toISOString(),
    endTime: new Date(2026, 7, 3, 9, 30).toISOString(),
    isAllDay: false,
    status: 'confirmed',
    category: 'WORK',
    locationName: null,
    ...overrides,
  };
}

describe('spanForDay — clipping committed events onto a day row', () => {
  it('places a mid-morning event proportionally across the row', () => {
    const span = spanForDay(event(), MONDAY);

    // 09:00 of 1440 minutes = 37.5%
    expect(span?.leftPct).toBeCloseTo(37.5, 1);
    expect(span?.widthPct).toBeCloseTo((30 / 1440) * 100, 1);
  });

  it('omits an event belonging to a different day', () => {
    const span = spanForDay(
      event({ startTime: new Date(2026, 7, 5, 9, 0).toISOString(), endTime: null }),
      MONDAY,
    );

    expect(span).toBeNull();
  });

  it('shows an overnight event on the day it runs into, flagged as continuing from', () => {
    const overnight = event({
      title: 'Flight → SFO',
      startTime: new Date(2026, 7, 2, 22, 0).toISOString(),
      endTime: new Date(2026, 7, 3, 6, 0).toISOString(),
    });

    const span = spanForDay(overnight, MONDAY);

    expect(span).not.toBeNull();
    expect(span?.leftPct).toBe(0);
    expect(span?.continuesFrom).toBe(true);
    // Ends 06:00 → a quarter of the row.
    expect(span?.widthPct).toBeCloseTo(25, 1);
  });

  it('flags an event that runs past midnight into the next day', () => {
    const span = spanForDay(
      event({
        startTime: new Date(2026, 7, 3, 22, 0).toISOString(),
        endTime: new Date(2026, 7, 4, 2, 0).toISOString(),
      }),
      MONDAY,
    );

    expect(span?.continuesTo).toBe(true);
    // Clipped at local midnight, never spilling past the row.
    expect((span?.leftPct ?? 0) + (span?.widthPct ?? 0)).toBeCloseTo(100, 1);
  });

  it('gives an all-day event the whole row', () => {
    const span = spanForDay(event({ isAllDay: true }), MONDAY);

    expect(span?.leftPct).toBe(0);
    expect(span?.widthPct).toBe(100);
  });

  it('gives a zero-length event a floor width so it stays visible', () => {
    const span = spanForDay(
      event({ startTime: new Date(2026, 7, 3, 9, 0).toISOString(), endTime: null }),
      MONDAY,
    );

    expect(span?.widthPct).toBeGreaterThan(0);
  });

  it('ignores an unparseable start instant rather than rendering NaN', () => {
    expect(spanForDay(event({ startTime: 'not-a-date' }), MONDAY)).toBeNull();
  });
});

function day(clusters: RhythmDay['clusters'], date = '2026-08-03'): RhythmDay {
  return { date, dow: 'Monday', clusters };
}

function cluster(
  id: string,
  pOccur: number,
  dayparts: [string, number][],
): RhythmDay['clusters'][number] {
  return {
    clusterId: id,
    name: id,
    l0Class: 'WORK',
    pOccur,
    scheduled: false,
    daypartProbs: dayparts.map(([label, probability]) => ({ label, probability })),
  };
}

describe('daypartWeights — collapsing a day of clusters into four weights', () => {
  it('is all-zero for a day with no forecast', () => {
    expect(daypartWeights(undefined)).toEqual([0, 0, 0, 0]);
  });

  it('weights a daypart by occurrence probability times daypart share', () => {
    const [, morning] = daypartWeights(day([cluster('gym', 0.8, [['morning', 0.5]])]));

    expect(morning).toBeCloseTo(0.4, 5);
  });

  it('takes the strongest claim, not the union — two certainties are still one', () => {
    const weights = daypartWeights(
      day([cluster('gym', 1, [['evening', 1]]), cluster('reading', 1, [['evening', 1]])]),
    );

    expect(weights[3]).toBeCloseTo(1, 5);
  });

  it('is not raised by piling on weak claims', () => {
    const weak = Array.from({ length: 12 }, (_, i) => cluster(`w${i}`, 0.4, [['morning', 0.4]]));

    // Twelve maybes do not add up to a certainty.
    expect(daypartWeights(day(weak))[1]).toBeCloseTo(0.16, 5);
  });

  it('stays differentiated at a realistic cluster count', () => {
    // ~20 near-certain clusters spreading mass over every daypart is what the
    // live account looks like; a noisy-OR union saturates all four to ~1 and the
    // layer stops carrying information.
    const many = Array.from({ length: 20 }, (_, i) =>
      cluster(`c${i}`, 0.99, [
        ['night', 0.23],
        ['morning', 0.23],
        ['afternoon', 0.31],
        ['evening', 0.23],
      ]),
    );
    many.push(
      cluster('discord', 0.99, [
        ['afternoon', 0.75],
        ['evening', 0.25],
      ]),
    );

    const [night, , afternoon] = daypartWeights(day(many));

    expect(afternoon).toBeGreaterThan(0.7);
    expect(night).toBeLessThan(0.3);
    expect(afternoon - night).toBeGreaterThan(0.4);
  });

  it('ignores daypart labels it does not recognise', () => {
    expect(daypartWeights(day([cluster('gym', 1, [['brunch', 1]])]))).toEqual([0, 0, 0, 0]);
  });
});

describe('rhythmCells — per-hour intensities across a local day', () => {
  const lookupFor = (days: RhythmDay[]) => (utcDate: string) =>
    days.find((d) => d.date === utcDate);

  it('emits one cell per hour of the day', () => {
    expect(rhythmCells(MONDAY, () => undefined)).toHaveLength(24);
  });

  it('is all-zero when no forecast covers the day', () => {
    expect(rhythmCells(MONDAY, () => undefined).every((c) => c === 0)).toBe(true);
  });

  it('carries the weight of whichever UTC daypart each local hour falls in', () => {
    const cells = rhythmCells(
      MONDAY,
      lookupFor([
        day([cluster('a', 1, [['night', 0.9]])], '2026-08-03'),
        day([cluster('b', 1, [['night', 0.9]])], '2026-08-04'),
      ]),
    );

    // Whatever the viewer's offset, every hour resolves to some real daypart
    // weight — no hour is left unresolved by the UTC→local mapping.
    expect(cells.some((c) => c > 0)).toBe(true);
    expect(cells.every((c) => c >= 0 && c <= 1)).toBe(true);
  });

  it('reaches across the UTC date boundary for the tail of a local day', () => {
    // Only the NEXT UTC date carries any weight. A local day that runs past
    // midnight UTC must still pick it up, instead of flatlining.
    const cells = rhythmCells(
      MONDAY,
      lookupFor([
        day([], '2026-08-03'),
        day(
          [
            cluster('late', 1, [
              ['night', 1],
              ['morning', 1],
              ['afternoon', 1],
              ['evening', 1],
            ]),
          ],
          '2026-08-04',
        ),
      ]),
    );

    expect(cells.some((c) => c > 0)).toBe(true);
  });

  it('preserves ordering between a strong and a weak daypart', () => {
    const cells = rhythmCells(
      MONDAY,
      lookupFor([
        day(
          [
            cluster('work', 0.9, [
              ['afternoon', 0.9],
              ['night', 0.1],
            ]),
          ],
          '2026-08-03',
        ),
        day(
          [
            cluster('work', 0.9, [
              ['afternoon', 0.9],
              ['night', 0.1],
            ]),
          ],
          '2026-08-04',
        ),
      ]),
    );

    // Dayparts the clusters never claim stay at 0; among the ones they do, the
    // strong/weak ordering survives.
    const claimed = cells.filter((c) => c > 0);

    expect(Math.max(...claimed)).toBeCloseTo(0.81, 2);
    expect(Math.min(...claimed)).toBeCloseTo(0.09, 2);
  });
});
describe('HorizonGrid', () => {
  it('renders one row per day in the window', () => {
    render(<HorizonGrid start={MONDAY} days={7} events={[]} rhythm={[]} />);

    for (let i = 0; i < 7; i++) {
      const label = addDays(MONDAY, i).toLocaleDateString([], { weekday: 'short' });
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('renders a committed event on its day', () => {
    render(<HorizonGrid start={MONDAY} days={7} events={[event()]} rhythm={[]} />);

    expect(screen.getByText('Standup')).toBeInTheDocument();
  });

  it('renders an overnight event on both days it touches', () => {
    const overnight = event({
      title: 'Red-eye',
      startTime: new Date(2026, 7, 3, 22, 0).toISOString(),
      endTime: new Date(2026, 7, 4, 6, 0).toISOString(),
    });

    render(<HorizonGrid start={MONDAY} days={7} events={[overnight]} rhythm={[]} />);

    expect(screen.getAllByText('Red-eye')).toHaveLength(2);
  });

  it('renders without a rhythm layer — committed time alone is still true', () => {
    render(<HorizonGrid start={MONDAY} days={7} events={[event()]} rhythm={[]} />);

    expect(screen.getByText('Standup')).toBeInTheDocument();
  });
});
