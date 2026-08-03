import { computeFreeBusy, summarizeAvailability } from './availability';

const WINDOW = { from: new Date('2026-08-07T09:00:00Z'), to: new Date('2026-08-07T17:00:00Z') };

function event(start: string, end: string | null, isAllDay = false) {
  return { startTime: new Date(start), endTime: end ? new Date(end) : null, isAllDay };
}

describe('computeFreeBusy', () => {
  it('returns the whole window free when there are no events', () => {
    const result = computeFreeBusy([], WINDOW);

    expect(result.busy).toEqual([]);
    expect(result.free).toEqual([{ start: '2026-08-07T09:00:00.000Z', end: '2026-08-07T17:00:00.000Z' }]);
  });

  it('inverts busy blocks into free gaps', () => {
    const result = computeFreeBusy([event('2026-08-07T10:00:00Z', '2026-08-07T11:00:00Z')], WINDOW);

    expect(result.busy).toEqual([{ start: '2026-08-07T10:00:00.000Z', end: '2026-08-07T11:00:00.000Z' }]);
    expect(result.free).toEqual([
      { start: '2026-08-07T09:00:00.000Z', end: '2026-08-07T10:00:00.000Z' },
      { start: '2026-08-07T11:00:00.000Z', end: '2026-08-07T17:00:00.000Z' },
    ]);
  });

  it('MERGES overlapping and adjacent events so the meeting count cannot be inferred', () => {
    const result = computeFreeBusy(
      [
        event('2026-08-07T10:00:00Z', '2026-08-07T11:00:00Z'),
        event('2026-08-07T10:30:00Z', '2026-08-07T12:00:00Z'), // overlaps
        event('2026-08-07T12:00:00Z', '2026-08-07T13:00:00Z'), // adjacent
      ],
      WINDOW,
    );

    // Three events collapse to ONE busy block: 10:00–13:00.
    expect(result.busy).toEqual([{ start: '2026-08-07T10:00:00.000Z', end: '2026-08-07T13:00:00.000Z' }]);
  });

  it('clamps events to the window and ignores ones outside it', () => {
    const result = computeFreeBusy(
      [
        event('2026-08-07T08:00:00Z', '2026-08-07T09:30:00Z'), // straddles the start
        event('2026-08-06T10:00:00Z', '2026-08-06T11:00:00Z'), // previous day
      ],
      WINDOW,
    );

    expect(result.busy).toEqual([{ start: '2026-08-07T09:00:00.000Z', end: '2026-08-07T09:30:00.000Z' }]);
  });

  it('treats an event with no end as a default-duration block', () => {
    const result = computeFreeBusy([event('2026-08-07T10:00:00Z', null)], WINDOW, {
      defaultDurationMinutes: 45,
    });

    expect(result.busy).toEqual([{ start: '2026-08-07T10:00:00.000Z', end: '2026-08-07T10:45:00.000Z' }]);
  });

  it('makes an all-day event block the whole overlapped span', () => {
    const result = computeFreeBusy([event('2026-08-07T13:00:00Z', null, true)], WINDOW);

    expect(result.busy).toEqual([{ start: '2026-08-07T09:00:00.000Z', end: '2026-08-07T17:00:00.000Z' }]);
    expect(result.free).toEqual([]);
  });

  it('filters free slots shorter than minMinutes ("free for lunch?" needs a real gap)', () => {
    const result = computeFreeBusy(
      [
        event('2026-08-07T09:00:00Z', '2026-08-07T11:50:00Z'),
        event('2026-08-07T12:00:00Z', '2026-08-07T17:00:00Z'),
      ],
      WINDOW,
      { minMinutes: 60 },
    );

    // The only gap is 10 minutes — not lunch.
    expect(result.free).toEqual([]);
  });

  it('returns nothing for an inverted or degenerate window', () => {
    expect(computeFreeBusy([], { from: WINDOW.to, to: WINDOW.from })).toEqual({ busy: [], free: [] });
  });

  it('DISCLOSURE: output carries only interval boundaries, never event detail', () => {
    const result = computeFreeBusy(
      [{ ...event('2026-08-07T10:00:00Z', '2026-08-07T11:00:00Z'), title: 'Therapy' } as never],
      WINDOW,
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('Therapy');
    expect(Object.keys(result.busy[0]).sort()).toEqual(['end', 'start']);
  });
});

describe('summarizeAvailability', () => {
  it('summarizes with counts and the longest slot, naming nothing else', () => {
    const freeBusy = computeFreeBusy([event('2026-08-07T10:00:00Z', '2026-08-07T11:00:00Z')], WINDOW);

    const summary = summarizeAvailability(freeBusy, 'Maya');

    expect(summary).toBe('Maya have 2 free slots in that window (longest 360 min).');
  });

  it('reports no availability plainly', () => {
    expect(summarizeAvailability({ busy: [], free: [] }, 'Maya')).toBe(
      'Maya have no free time in that window.',
    );
  });
});
