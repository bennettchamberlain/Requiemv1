import { useState } from 'react';

import { cn, Tooltip } from '@ci/shadcn';

import type { RhythmDay, ScheduleEvent } from '@/api/useScheduleService';
import { CANDIDATE_DRAG_TYPE } from '@/components/TaskSlate';

// ── Constants ─────────────────────────────────────────────────────────────────

const MINUTES_PER_DAY = 24 * 60;
const HOURS_PER_DAY = 24;

/**
 * HBPE bins behaviour into four 6-hour dayparts anchored at UTC midnight
 * (recurrence.py: BUCKETS_PER_PART = 12). Cells are resolved per local hour by
 * looking up the UTC instant that hour actually falls in, so a viewer far from
 * UTC sees their real rhythm rather than a label that assumes "morning" means
 * their morning.
 */
const DAYPART_HOURS = 6;
const DAYPART_NAMES = ['night', 'morning', 'afternoon', 'evening'] as const;

type DaypartName = (typeof DAYPART_NAMES)[number];

/** Below this weight, a rhythm cell is noise rather than signal — leave it blank. */
const RHYTHM_NOISE_FLOOR = 0.05;

/**
 * Ink range for a rhythm cell. The floor keeps a weak-but-real pattern visible;
 * the ceiling keeps the layer ambient so it never competes with committed time.
 * Weight maps linearly across the range rather than being clamped, so a 0.9 cell
 * still reads darker than a 0.6 one.
 */
const MIN_CELL_INK = 0.14;
const MAX_CELL_INK = 0.85;

function cellOpacity(intensity: number): number {
  return MIN_CELL_INK + (MAX_CELL_INK - MIN_CELL_INK) * Math.min(intensity, 1);
}

/**
 * Below this share of the row, a block is too narrow to hold its own title — a
 * 30-minute meeting is 2% of a 24-hour day. Such events render as a tick with
 * the label spilling to the right instead of being truncated to one letter.
 */
const NARROW_SPAN_PCT = 7;

/** Quarter-day guides, so the eye can find noon without counting. */
const GUIDE_HOURS = [6, 12, 18];
const AXIS_HOURS = [0, 4, 8, 12, 16, 20];

/**
 * Dropping snaps to this grain. Finer would imply a precision the suggestion
 * does not have; coarser would fight the user placing something after lunch.
 */
const DROP_SNAP_MINUTES = 15;

/**
 * Local instant for a drop at `ratio` across a day row, snapped to the grain.
 *
 * A non-finite ratio (a drop event carrying no usable coordinate) falls back to
 * the start of the day rather than producing an Invalid Date, which would
 * otherwise travel all the way to the accept mutation.
 */
function dropInstant(dayStart: Date, ratio: number): Date {
  const clamped = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
  const raw = clamped * MINUTES_PER_DAY;
  const snapped = Math.round(raw / DROP_SNAP_MINUTES) * DROP_SNAP_MINUTES;

  return new Date(dayStart.getTime() + Math.min(snapped, MINUTES_PER_DAY - DROP_SNAP_MINUTES) * 60_000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function localMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function startOfLocalDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);

  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);

  return d;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Short hour label ("6 AM"), for the axis. */
function formatHour(hour: number): string {
  return new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric' });
}

/** UTC calendar date of an instant — how forecast days are keyed. */
function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A committed event's placement on one day row, clipped to that day. */
interface EventSpan {
  event: ScheduleEvent;
  leftPct: number;
  widthPct: number;
  /** True when the event began before this day — it ran in from yesterday. */
  continuesFrom: boolean;
  continuesTo: boolean;
}

/**
 * Clip an event to a single local day and express it as percentages of that row.
 *
 * A flight that departs Sunday night and lands Monday morning must appear on
 * both rows; that is why this clips rather than filters. Zero-length and all-day
 * events get a floor width so they stay clickable.
 */
function spanForDay(event: ScheduleEvent, dayStart: Date): EventSpan | null {
  const dayEnd = addDays(dayStart, 1);
  const start = new Date(event.startTime);
  const end = event.endTime ? new Date(event.endTime) : start;

  if (Number.isNaN(start.getTime())) {
    return null;
  }

  if (start >= dayEnd || end < dayStart) {
    return null;
  }

  if (event.isAllDay) {
    return { event, leftPct: 0, widthPct: 100, continuesFrom: false, continuesTo: false };
  }

  const clippedStart = start < dayStart ? dayStart : start;
  const clippedEnd = end > dayEnd ? dayEnd : end;

  const startMin = sameLocalDay(clippedStart, dayStart) ? localMinutes(clippedStart) : 0;
  const endMin = clippedEnd >= dayEnd ? MINUTES_PER_DAY : localMinutes(clippedEnd);

  const widthMin = Math.max(endMin - startMin, 20);

  return {
    event,
    leftPct: (startMin / MINUTES_PER_DAY) * 100,
    widthPct: Math.min((widthMin / MINUTES_PER_DAY) * 100, 100 - (startMin / MINUTES_PER_DAY) * 100),
    continuesFrom: start < dayStart,
    continuesTo: end > dayEnd,
  };
}

/**
 * The four daypart weights for one forecast day.
 *
 * A daypart's weight is the STRONGEST single claim on it —
 * `max(pOccur × daypartProb)` — not the union of every claim. The union reads
 * better in theory and is useless in practice: a real user has ~20 discovered
 * clusters, most with pOccur near 1 and mass spread across all four dayparts, so
 * a noisy-OR saturates everything to ~1.0 and the layer degenerates into
 * "everything, always". The max asks the question that carries information: how
 * hard does the most-expected behaviour pull on this part of the day.
 */
function daypartWeights(day: RhythmDay | undefined): number[] {
  const weight = [0, 0, 0, 0];

  if (!day) {
    return weight;
  }

  for (const cluster of day.clusters) {
    for (const entry of cluster.daypartProbs) {
      const idx = DAYPART_NAMES.indexOf(entry.label as DaypartName);

      if (idx >= 0) {
        weight[idx] = Math.max(weight[idx], cluster.pOccur * entry.probability);
      }
    }
  }

  return weight;
}

/**
 * Rhythm intensity for each of the 24 local hours of a day.
 *
 * Rendering per-hour cells rather than four wide bands is what makes the layer
 * legible: 6-hour slabs of near-equal weight fuse into one uniform bar, while
 * a row of discrete cells reads as texture and shows where the day's weight
 * actually sits. It also makes the UTC offset fall out for free — each hour asks
 * which UTC daypart it lands in, so no band has to be split at local midnight.
 */
function rhythmCells(dayStart: Date, lookup: (utcDate: string) => RhythmDay | undefined): number[] {
  const weightCache = new Map<string, number[]>();

  return Array.from({ length: HOURS_PER_DAY }, (_, hour) => {
    const instant = new Date(dayStart.getTime() + hour * 3_600_000);
    const key = utcDateKey(instant);

    if (!weightCache.has(key)) {
      weightCache.set(key, daypartWeights(lookup(key)));
    }

    const idx = Math.floor(instant.getUTCHours() / DAYPART_HOURS);

    return weightCache.get(key)?.[idx] ?? 0;
  });
}

/** Top behaviours for a day, for the row tooltip. */
function topClusters(day: RhythmDay | undefined, limit = 4): RhythmCluster[] {
  return [...(day?.clusters ?? [])].sort((a, b) => b.pOccur - a.pOccur).slice(0, limit);
}

type RhythmCluster = RhythmDay['clusters'][number];

// ── Row ───────────────────────────────────────────────────────────────────────

interface DayRowProps {
  dayStart: Date;
  events: ScheduleEvent[];
  lookup: (utcDate: string) => RhythmDay | undefined;
  isToday: boolean;
  nowPct: number | null;
  onDropCandidate?: (candidateId: string, startTime: Date) => void;
}

function DayRow({ dayStart, events, lookup, isToday, nowPct, onDropCandidate }: DayRowProps) {
  /** Where a dragged candidate would land, as a percentage across the row. */
  const [dropPct, setDropPct] = useState<number | null>(null);
  const spans = events
    .map((event) => spanForDay(event, dayStart))
    .filter((span): span is EventSpan => span !== null)
    .sort((a, b) => a.leftPct - b.leftPct);

  const cells = rhythmCells(dayStart, lookup);
  const clusters = topClusters(lookup(utcDateKey(dayStart)));
  const hasRhythm = cells.some((c) => c >= RHYTHM_NOISE_FLOOR);

  /**
   * Room to the right of a narrow block before the next one starts. A tick with
   * its label spilling into empty space is readable; one spilling under the next
   * event is not, so the label is dropped and the tooltip carries it instead.
   */
  const labelRoom = (index: number): number => {
    const current = spans[index];
    const next = spans[index + 1];
    const until = next ? next.leftPct : 100;

    return until - (current.leftPct + current.widthPct);
  };

  const isDropTarget = dropPct !== null;

  /** Ratio across the lane for a pointer event, from the lane's own box. */
  const ratioFor = (event: { clientX: number; currentTarget: HTMLElement }): number => {
    const box = event.currentTarget.getBoundingClientRect();

    return box.width === 0 ? 0 : (event.clientX - box.left) / box.width;
  };

  return (
    <div
      className={cn(
        'flex items-stretch gap-3 rounded-lg px-2 py-2 transition-colors',
        // Today is marked with a rail rather than a wash — a filled row drowns
        // its own rhythm lane, which is the thing you most want to read there.
        isToday ? 'bg-accent/15 ring-1 ring-inset ring-primary/25' : 'hover:bg-accent/15',
        isDropTarget && 'bg-primary/10 ring-1 ring-inset ring-primary/60',
      )}
    >
      <div className="w-10 shrink-0 pt-0.5 text-right">
        <div className={cn('text-xs leading-tight', isToday ? 'font-medium' : 'text-muted-foreground')}>
          {dayStart.toLocaleDateString([], { weekday: 'short' })}
        </div>
        <div className={cn('text-[11px] leading-tight', isToday ? '' : 'text-muted-foreground/70')}>
          {dayStart.getDate()}
        </div>
      </div>

      <div
        className="relative min-w-0 flex-1"
        onDragOver={
          onDropCandidate
            ? (e) => {
                // Only claim the drop when a candidate is what's being dragged;
                // preventDefault is what marks this element as a valid target.
                if (!e.dataTransfer.types.includes(CANDIDATE_DRAG_TYPE)) {
                  return;
                }

                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDropPct(Math.max(0, Math.min(1, ratioFor(e))) * 100);
              }
            : undefined
        }
        onDragLeave={() => setDropPct(null)}
        onDrop={
          onDropCandidate
            ? (e) => {
                const id = e.dataTransfer.getData(CANDIDATE_DRAG_TYPE);
                setDropPct(null);

                if (!id) {
                  return;
                }

                e.preventDefault();
                onDropCandidate(id, dropInstant(dayStart, ratioFor(e)));
              }
            : undefined
        }
      >
        {/* Where it would land, and at what time. */}
        {dropPct !== null && (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-primary"
              style={{ left: `${dropPct}%` }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -top-1 z-20 -translate-x-1/2 rounded bg-primary px-1 py-px text-[10px] text-primary-foreground tabular-nums"
              style={{ left: `${dropPct}%` }}
            >
              {formatClock(dropInstant(dayStart, dropPct / 100))}
            </div>
          </>
        )}

        {/* Quarter-day guides — find noon without counting. */}
        {GUIDE_HOURS.map((hour) => (
          <div
            key={hour}
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-px bg-border/50"
            style={{ left: `${(hour / HOURS_PER_DAY) * 100}%` }}
          />
        ))}

        {/* Now — only on today, and only as a hairline. */}
        {isToday && nowPct !== null && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 z-10 w-px bg-foreground/50"
            style={{ left: `${nowPct}%` }}
          />
        )}

        {/* Committed lane — solid chips. Certainty reads as a filled surface. */}
        <div className="relative h-7">
          {spans.map(({ event, leftPct, widthPct, continuesFrom, continuesTo }, index) => {
            const isNarrow = widthPct < NARROW_SPAN_PCT;
            const showSpilledLabel = isNarrow && labelRoom(index) > NARROW_SPAN_PCT;

            return (
              <Tooltip key={`${event.id}-${dayStart.toDateString()}`}>
                <Tooltip.Trigger asChild>
                  <div
                    className={cn(
                      'absolute top-0 z-[5] h-7 whitespace-nowrap border bg-background text-[11px] leading-[26px]',
                      'border-border text-foreground shadow-sm',
                      isNarrow ? 'overflow-visible' : 'overflow-hidden px-2',
                      event.status === 'tentative' && 'border-dashed bg-background/60 text-muted-foreground',
                      continuesFrom ? 'rounded-l-none border-l-0' : 'rounded-l-md',
                      continuesTo ? 'rounded-r-none border-r-0' : 'rounded-r-md',
                    )}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  >
                    {isNarrow ? (
                      showSpilledLabel && (
                        <span className="pointer-events-none absolute left-[calc(100%+6px)] top-0 text-foreground/80">
                          {event.title}
                        </span>
                      )
                    ) : (
                      <span>{event.title}</span>
                    )}
                  </div>
                </Tooltip.Trigger>
                <Tooltip.Content side="top">
                  <div className="space-y-1 text-left">
                    <p className="text-xs font-medium">{event.title}</p>
                    <p className="text-[10px] opacity-75">
                      {event.isAllDay
                        ? 'All day'
                        : `${formatClock(new Date(event.startTime))}${
                            event.endTime ? ` – ${formatClock(new Date(event.endTime))}` : ''
                          }`}
                    </p>
                    {event.locationName && <p className="text-[10px] opacity-60">{event.locationName}</p>}
                    {event.status === 'tentative' && <p className="text-[10px] opacity-60">Tentative</p>}
                  </div>
                </Tooltip.Content>
              </Tooltip>
            );
          })}
        </div>

        {/* Rhythm lane — what this day usually holds. Ambient, never a task. */}
        <Tooltip>
          <Tooltip.Trigger asChild>
            {/* Discrete cells, not a bar: the gaps are what let the eye read
                density. A continuous fill of near-equal weight looks like a
                slab and says nothing. */}
            <div className="mt-1.5 flex h-2 gap-[2px]" aria-label="Predicted rhythm">
              {cells.map((intensity, hour) => (
                <div
                  key={hour}
                  className={cn(
                    'flex-1 rounded-[2px]',
                    intensity >= RHYTHM_NOISE_FLOOR ? 'bg-primary' : 'bg-foreground/[0.06]',
                  )}
                  style={{
                    opacity: intensity >= RHYTHM_NOISE_FLOOR ? cellOpacity(intensity) : undefined,
                  }}
                />
              ))}
            </div>
          </Tooltip.Trigger>
          {hasRhythm && (
            <Tooltip.Content side="bottom">
              <div className="w-52 space-y-1 text-left">
                <p className="text-xs font-medium">
                  {dayStart.toLocaleDateString([], { weekday: 'long' })} — usually
                </p>
                {clusters.length === 0 ? (
                  <p className="text-[10px] opacity-60">No established pattern yet.</p>
                ) : (
                  clusters.map((cluster) => (
                    <div key={cluster.clusterId} className="flex items-center justify-between gap-2">
                      <span className="truncate text-[10px] opacity-75">{cluster.name}</span>
                      <span className="shrink-0 text-[10px] tabular-nums opacity-60">
                        {Math.round(cluster.pOccur * 100)}%
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Tooltip.Content>
          )}
        </Tooltip>
      </div>
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

interface HorizonGridProps {
  /** First day of the window, local midnight. */
  start: Date;
  days: number;
  events: ScheduleEvent[];
  rhythm: RhythmDay[];
  /**
   * Called when a slate candidate is dropped on a day. Omit to make the grid
   * read-only — drops are then simply not accepted.
   */
  onDropCandidate?: (candidateId: string, startTime: Date) => void;
  className?: string;
}

/**
 * The week, as days-down / time-across.
 *
 * Days are rows rather than columns because a fuzzy time window is a horizontal
 * smear, and because it lets a week, a month, and a year share one geometry.
 *
 * The whole grid sits on its own card: PageContent paints a background texture,
 * and hairline content read directly against it is close to unreadable.
 */
export function HorizonGrid({
  start,
  days,
  events,
  rhythm,
  onDropCandidate,
  className,
}: HorizonGridProps) {
  const now = new Date();
  const today = startOfLocalDay(now);
  const rhythmByDate = new Map(rhythm.map((day) => [day.date, day]));
  const lookup = (utcDate: string) => rhythmByDate.get(utcDate);
  const nowPct = ((now.getHours() * 60 + now.getMinutes()) / MINUTES_PER_DAY) * 100;

  return (
    <div className={cn('rounded-xl border border-border bg-card p-3 md:p-4', className)}>
      {/* Time axis */}
      <div className="flex items-center gap-3 pb-2">
        <div className="w-10 shrink-0" />
        <div className="relative h-4 flex-1">
          {AXIS_HOURS.map((hour) => (
            <span
              key={hour}
              className="absolute text-[10px] text-muted-foreground"
              style={{ left: `${(hour / HOURS_PER_DAY) * 100}%` }}
            >
              {formatHour(hour)}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-0.5">
        {Array.from({ length: days }, (_, i) => {
          const dayStart = addDays(start, i);

          return (
            <DayRow
              key={dayStart.toISOString()}
              dayStart={dayStart}
              events={events}
              lookup={lookup}
              isToday={sameLocalDay(dayStart, today)}
              nowPct={sameLocalDay(dayStart, today) ? nowPct : null}
              onDropCandidate={onDropCandidate}
            />
          );
        })}
      </div>
    </div>
  );
}

export { spanForDay, daypartWeights, rhythmCells, dropInstant, startOfLocalDay, addDays };
