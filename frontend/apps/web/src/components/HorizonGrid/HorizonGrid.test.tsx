import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { RhythmDay, ScheduleEvent } from '@/api/useScheduleService';

import { HorizonGrid, spanForDay, bandsForDay, startOfLocalDay, addDays } from './HorizonGrid';

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

describe('bandsForDay — collapsing clusters into rhythm bands', () => {
  function day(clusters: RhythmDay['clusters']): RhythmDay {
    return { date: '2026-08-03', dow: 'Monday', clusters };
  }

  it('produces nothing when there is no forecast for the day', () => {
    expect(bandsForDay(undefined, MONDAY)).toEqual([]);
  });

  it('suppresses bands below the noise floor', () => {
    const bands = bandsForDay(
      day([
        {
          clusterId: 'c1',
          name: 'Gym',
          l0Class: 'EXERCISE',
          pOccur: 0.02,
          scheduled: false,
          daypartProbs: [{ label: 'morning', probability: 0.5 }],
        },
      ]),
      MONDAY,
    );

    expect(bands).toHaveLength(0);
  });

  it('weights a band by occurrence probability times daypart share', () => {
    const bands = bandsForDay(
      day([
        {
          clusterId: 'c1',
          name: 'Gym',
          l0Class: 'EXERCISE',
          pOccur: 0.8,
          scheduled: false,
          daypartProbs: [{ label: 'morning', probability: 0.5 }],
        },
      ]),
      MONDAY,
    );

    const morning = bands.find((b) => b.label === 'morning');
    expect(morning?.intensity).toBeCloseTo(0.4, 2);
  });

  it('saturates at 1 rather than summing past it when behaviours stack', () => {
    const bands = bandsForDay(
      day([
        {
          clusterId: 'c1',
          name: 'Gym',
          l0Class: 'EXERCISE',
          pOccur: 1,
          scheduled: false,
          daypartProbs: [{ label: 'evening', probability: 1 }],
        },
        {
          clusterId: 'c2',
          name: 'Reading',
          l0Class: 'LEISURE',
          pOccur: 1,
          scheduled: false,
          daypartProbs: [{ label: 'evening', probability: 1 }],
        },
      ]),
      MONDAY,
    );

    const evening = bands.find((b) => b.label === 'evening');
    expect(evening?.intensity).toBeLessThanOrEqual(1);
    // Two certainties in the same band stay at ceiling, not 2.0.
    expect(evening?.intensity).toBeCloseTo(1, 5);
  });

  it('preserves ordering between a strong and a weak band', () => {
    const bands = bandsForDay(
      day([
        {
          clusterId: 'c1',
          name: 'Work',
          l0Class: 'WORK',
          pOccur: 0.9,
          scheduled: false,
          daypartProbs: [
            { label: 'afternoon', probability: 0.9 },
            { label: 'night', probability: 0.15 },
          ],
        },
      ]),
      MONDAY,
    );

    const afternoon = bands.find((b) => b.label === 'afternoon');
    const night = bands.find((b) => b.label === 'night');

    expect(afternoon?.intensity).toBeGreaterThan(night?.intensity ?? 1);
  });

  it('keeps every band inside the row', () => {
    const bands = bandsForDay(
      day(
        (['night', 'morning', 'afternoon', 'evening'] as const).map((label, i) => ({
          clusterId: `c${i}`,
          name: label,
          l0Class: 'WORK',
          pOccur: 0.9,
          scheduled: false,
          daypartProbs: [{ label, probability: 0.9 }],
        })),
      ),
      MONDAY,
    );

    expect(bands.length).toBeGreaterThan(0);
    for (const band of bands) {
      expect(band.leftPct).toBeGreaterThanOrEqual(0);
      expect(band.leftPct + band.widthPct).toBeLessThanOrEqual(100.01);
      expect(band.widthPct).toBeGreaterThan(0);
    }
  });

  it('ignores daypart labels it does not recognise', () => {
    const bands = bandsForDay(
      day([
        {
          clusterId: 'c1',
          name: 'Gym',
          l0Class: 'EXERCISE',
          pOccur: 1,
          scheduled: false,
          daypartProbs: [{ label: 'brunch', probability: 1 }],
        },
      ]),
      MONDAY,
    );

    expect(bands).toHaveLength(0);
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
