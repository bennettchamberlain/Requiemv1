/**
 * Deterministic first-fit placer (roadmap M3).
 *
 * Given a workday window, already-occupied spans, and an estimate, answer one
 * question: where does this task go? No LLM, no two-pass autoplan, no reflow.
 *
 * Invariants this function is responsible for:
 * - Not-before-now: the cursor never starts in the past (clamped + snapped).
 * - Occupied time is sacred: we only land in a gap that fully fits the estimate.
 * - Determinism: same inputs → same PlacementPlan. No clocks of its own.
 */

export const DEFAULT_ESTIMATED_MINUTES = 30;
export const SNAP_MINUTES = 15;

export interface OccupiedSpan {
  start: Date;
  end: Date;
}

export interface PlacementInput {
  workdayStart: Date;
  workdayEnd: Date;
  occupied: readonly OccupiedSpan[];
  estimatedMinutes: number;
  now: Date;
}

export type PlacementPlan = { kind: 'placed'; start: Date; end: Date } | { kind: 'no_gap' };

/** Owner-local `YYYY-MM-DD` arithmetic. Noon UTC avoids DST/date-line drift. */
export function shiftLocalDate(date: string, days: number): string {
  const pivot = new Date(`${date}T12:00:00Z`);
  pivot.setUTCDate(pivot.getUTCDate() + days);

  return pivot.toISOString().slice(0, 10);
}

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)/;

/** Accept `HH:MM` or `HH:MM:SS`; reject anything else. */
export function parseWallClock(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const match = HH_MM.exec(value.trim());

  return match ? `${match[1]}:${match[2]}` : null;
}

function snapUp(ms: number, snapMs: number): number {
  return Math.ceil(ms / snapMs) * snapMs;
}

function mergeSpans(spans: OccupiedSpan[]): OccupiedSpan[] {
  if (spans.length === 0) {
    return [];
  }

  const merged: OccupiedSpan[] = [{ ...spans[0] }];

  for (const span of spans.slice(1)) {
    const last = merged[merged.length - 1];

    if (span.start.getTime() <= last.end.getTime()) {
      if (span.end.getTime() > last.end.getTime()) {
        last.end = span.end;
      }
    } else {
      merged.push({ ...span });
    }
  }

  return merged;
}

export function computePlacement(input: PlacementInput): PlacementPlan {
  const minutes = Math.max(1, Math.round(input.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES));
  const durationMs = minutes * 60_000;
  const snapMs = SNAP_MINUTES * 60_000;
  const windowEndMs = input.workdayEnd.getTime();
  const windowStartMs = Math.max(input.workdayStart.getTime(), snapUp(input.now.getTime(), snapMs));

  if (windowStartMs + durationMs > windowEndMs) {
    return { kind: 'no_gap' };
  }

  const occupied = mergeSpans(
    input.occupied
      .map((span) => ({
        start: new Date(Math.max(span.start.getTime(), windowStartMs)),
        end: new Date(Math.min(span.end.getTime(), windowEndMs)),
      }))
      .filter((span) => span.end.getTime() > span.start.getTime())
      .sort((a, b) => a.start.getTime() - b.start.getTime()),
  );

  let cursor = windowStartMs;

  for (const span of occupied) {
    if (span.start.getTime() - cursor >= durationMs) {
      return {
        kind: 'placed',
        start: new Date(cursor),
        end: new Date(cursor + durationMs),
      };
    }

    cursor = Math.max(cursor, span.end.getTime());
  }

  if (windowEndMs - cursor >= durationMs) {
    return {
      kind: 'placed',
      start: new Date(cursor),
      end: new Date(cursor + durationMs),
    };
  }

  return { kind: 'no_gap' };
}
