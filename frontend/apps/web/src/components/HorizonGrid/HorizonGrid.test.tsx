import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { RhythmDay, ScheduleEvent } from '@/api/useScheduleService';

import {
  HorizonGrid,
  spanForDay,
  daypartWeights,
  describes,
  rhythmCells,
  dropInstant,
  movedStart,
  startOfLocalDay,
  addDays,
} from './HorizonGrid';

const MONDAY = startOfLocalDay(new Date(2026, 7, 3));

function event(overrides: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    id: 'e1',
    title: 'Standup',
    description: null,
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
      description: null,
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

describe('describes — whether the event text adds anything to the title', () => {
  it('shows the text when the title is a bare category word', () => {
    // The case that prompted this: candidates minted from ci.actions inherit
    // the action's title verbatim, which is often just "Action" or "Goal",
    // leaving what the thing actually is unread in the description.
    expect(
      describes(event({ title: 'Action', description: 'Send Liam the Q3 numbers before the review' })),
    ).toBe(true);
  });

  it('stays quiet when there is no text', () => {
    expect(describes(event({ description: null }))).toBe(false);
    expect(describes(event({ description: '   ' }))).toBe(false);
  });

  it('stays quiet when the text only restates the title', () => {
    // Several producers copy the title into the description; the same line
    // twice in one tooltip reads as a bug, not as detail.
    expect(describes(event({ title: 'Standup', description: 'Standup' }))).toBe(false);
    expect(describes(event({ title: 'Standup', description: '  standup ' }))).toBe(false);
  });
});

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
describe('dropInstant — where a dragged suggestion lands', () => {
  it('maps the middle of a row to midday', () => {
    expect(dropInstant(MONDAY, 0.5).getHours()).toBe(12);
  });

  it('snaps to a quarter hour rather than implying false precision', () => {
    // 09:07 worth of ratio should land on 09:00, not 09:07.
    const ratio = (9 * 60 + 7) / 1440;

    const at = dropInstant(MONDAY, ratio);
    expect(at.getHours()).toBe(9);
    expect(at.getMinutes() % 15).toBe(0);
  });

  it('rounds to the nearer quarter, not always down', () => {
    const ratio = (9 * 60 + 13) / 1440;

    expect(dropInstant(MONDAY, ratio).getMinutes()).toBe(15);
  });

  it('clamps a drop before the row to the start of the day', () => {
    expect(dropInstant(MONDAY, -0.4).getTime()).toBe(MONDAY.getTime());
  });

  it('never spills a drop past the end of the row into the next day', () => {
    const at = dropInstant(MONDAY, 1.4);

    expect(at.getDate()).toBe(MONDAY.getDate());
    expect(at.getTime()).toBeLessThan(addDays(MONDAY, 1).getTime());
  });

  it('lands on the row it was dropped on, not on today', () => {
    const thursday = addDays(MONDAY, 3);

    expect(dropInstant(thursday, 0.5).getDate()).toBe(thursday.getDate());
  });

  it('falls back to the start of the day rather than an invalid instant', () => {
    // A drop event with no usable coordinate must not send Invalid Date to the
    // accept mutation.
    expect(dropInstant(MONDAY, Number.NaN).getTime()).toBe(MONDAY.getTime());
  });
});

describe('movedStart — dragging a committed event to a new time', () => {
  const NOON_OFFSET = 12 * 60 * 60 * 1000;

  it('moves by the delta between grab and drop, not to the cursor', () => {
    // Grabbed 30 minutes into the event, dropped at 15:00 → starts at 14:30.
    const grabOffsetMs = 30 * 60 * 1000;

    const at = movedStart(MONDAY, 15 / 24, grabOffsetMs);

    expect(at.getHours()).toBe(14);
    expect(at.getMinutes()).toBe(30);
  });

  it('starts the event at the cursor when it was grabbed by its leading edge', () => {
    const at = movedStart(MONDAY, 0.5, 0);

    expect(at.getHours()).toBe(12);
    expect(at.getMinutes()).toBe(0);
  });

  it('snaps the resulting start to the drop grain', () => {
    const at = movedStart(MONDAY, (9 * 60 + 7) / 1440, 0);

    expect(at.getMinutes() % 15).toBe(0);
  });

  it('carries the event onto the row it was dropped on', () => {
    const thursday = addDays(MONDAY, 3);

    expect(movedStart(thursday, 0.5, 0).getDate()).toBe(thursday.getDate());
  });

  it('walks an event back a day when it is grabbed past its own start', () => {
    // The clipped tail of an overnight event: the chip begins at local midnight
    // but the event began the previous evening, so the grab offset exceeds the
    // drop position and the new start lands on the day before.
    const at = movedStart(MONDAY, 0.1, NOON_OFFSET);

    expect(at.getTime()).toBeLessThan(MONDAY.getTime());
  });

  it('falls back to the start of the day on an unusable coordinate', () => {
    expect(movedStart(MONDAY, Number.NaN, 0).getTime()).toBe(MONDAY.getTime());
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
      description: null,
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

describe('HorizonGrid — dropping a slate candidate', () => {
  /** jsdom gives every element a zero-width box; give the lanes a real one. */
  function stubLaneWidths(container: HTMLElement, width = 1000, left = 0) {
    for (const lane of container.querySelectorAll('.relative.min-w-0.flex-1')) {
      lane.getBoundingClientRect = () => ({ width, left, right: left + width }) as DOMRect;
    }
  }

  function dataTransfer(candidateId: string | null) {
    return {
      types: candidateId === null ? [] : ['application/x-ci-candidate'],
      getData: () => candidateId ?? '',
      setData: () => {},
      dropEffect: '',
      effectAllowed: '',
    };
  }

  function lanes(container: HTMLElement) {
    return [...container.querySelectorAll('.relative.min-w-0.flex-1')] as HTMLElement[];
  }

  /**
   * jsdom implements no DragEvent, so React Testing Library falls back to a
   * plain Event and silently drops clientX. Define it by hand.
   */
  function dropAt(lane: HTMLElement, clientX: number, candidateId: string | null) {
    const evt = createEvent.drop(lane, { dataTransfer: dataTransfer(candidateId) });
    Object.defineProperty(evt, 'clientX', { value: clientX });
    fireEvent(lane, evt);
  }

  it('reports the day and time the card was dropped on', () => {
    const onDrop = vi.fn();
    const { container } = render(
      <HorizonGrid start={MONDAY} days={7} events={[]} rhythm={[]} onDropCandidate={onDrop} />,
    );
    stubLaneWidths(container);

    // Wednesday (third row), halfway across → midday.
    dropAt(lanes(container)[2], 500, 'cand-7');

    expect(onDrop).toHaveBeenCalledTimes(1);
    const [id, at] = onDrop.mock.calls[0];
    expect(id).toBe('cand-7');
    expect(at.getDate()).toBe(addDays(MONDAY, 2).getDate());
    expect(at.getHours()).toBe(12);
  });

  it('places the card where it was dropped, not at the start of the day', () => {
    const onDrop = vi.fn();
    const { container } = render(
      <HorizonGrid start={MONDAY} days={7} events={[]} rhythm={[]} onDropCandidate={onDrop} />,
    );
    stubLaneWidths(container);

    // 75% across → 18:00.
    dropAt(lanes(container)[0], 750, 'cand-1');

    expect(onDrop.mock.calls[0][1].getHours()).toBe(18);
  });

  it('ignores a drop carrying no candidate', () => {
    const onDrop = vi.fn();
    const { container } = render(
      <HorizonGrid start={MONDAY} days={7} events={[]} rhythm={[]} onDropCandidate={onDrop} />,
    );
    stubLaneWidths(container);

    dropAt(lanes(container)[0], 500, null);

    expect(onDrop).not.toHaveBeenCalled();
  });

  it('moves a committed event to the row and time it was dragged to', () => {
    const onMove = vi.fn();
    const { container } = render(
      <HorizonGrid start={MONDAY} days={7} events={[event()]} rhythm={[]} onMoveEvent={onMove} />,
    );
    stubLaneWidths(container);

    const evt = createEvent.drop(lanes(container)[3], {
      dataTransfer: {
        types: ['application/x-ci-event'],
        getData: () => JSON.stringify({ id: 'e1', grabOffsetMs: 0 }),
        setData: () => {},
        dropEffect: '',
        effectAllowed: '',
      },
    });
    Object.defineProperty(evt, 'clientX', { value: 500 });
    fireEvent(lanes(container)[3], evt);

    expect(onMove).toHaveBeenCalledTimes(1);
    const [id, at] = onMove.mock.calls[0];
    expect(id).toBe('e1');
    expect(at.getDate()).toBe(addDays(MONDAY, 3).getDate());
    expect(at.getHours()).toBe(12);
  });

  it('makes event chips draggable only when moving is wired up', () => {
    const { container: fixed } = render(
      <HorizonGrid start={MONDAY} days={7} events={[event()]} rhythm={[]} />,
    );
    expect(fixed.querySelector('[draggable="true"]')).toBeNull();

    const { container: movable } = render(
      <HorizonGrid start={MONDAY} days={7} events={[event()]} rhythm={[]} onMoveEvent={() => {}} />,
    );
    expect(movable.querySelector('[draggable="true"]')).not.toBeNull();
  });

  it('ignores an event drag whose payload is not ours', () => {
    const onMove = vi.fn();
    const { container } = render(
      <HorizonGrid start={MONDAY} days={7} events={[event()]} rhythm={[]} onMoveEvent={onMove} />,
    );
    stubLaneWidths(container);

    const evt = createEvent.drop(lanes(container)[0], {
      dataTransfer: {
        types: ['application/x-ci-event'],
        getData: () => 'not json',
        setData: () => {},
        dropEffect: '',
        effectAllowed: '',
      },
    });
    Object.defineProperty(evt, 'clientX', { value: 500 });
    fireEvent(lanes(container)[0], evt);

    expect(onMove).not.toHaveBeenCalled();
  });

  it('does not take an event drop on a grid that only accepts candidates', () => {
    const onDrop = vi.fn();
    const { container } = render(
      <HorizonGrid start={MONDAY} days={7} events={[event()]} rhythm={[]} onDropCandidate={onDrop} />,
    );
    stubLaneWidths(container);

    const evt = createEvent.drop(lanes(container)[0], {
      dataTransfer: {
        types: ['application/x-ci-event'],
        getData: () => JSON.stringify({ id: 'e1', grabOffsetMs: 0 }),
        setData: () => {},
        dropEffect: '',
        effectAllowed: '',
      },
    });
    Object.defineProperty(evt, 'clientX', { value: 500 });
    fireEvent(lanes(container)[0], evt);

    expect(onDrop).not.toHaveBeenCalled();
  });

  it('accepts no drops at all when the grid is read-only', () => {
    const { container } = render(<HorizonGrid start={MONDAY} days={7} events={[]} rhythm={[]} />);
    stubLaneWidths(container);

    // No handler is attached, so this must not throw.
    expect(() => dropAt(lanes(container)[0], 500, 'cand-1')).not.toThrow();
  });
});
